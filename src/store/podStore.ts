import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import {
  POD_GUIDE_CODE,
  POD_STEP_DEG,
  POD_STEP_INTERVAL_MS,
  clampPodAngle,
  type PodContinuousCommand,
  type PodGuideCommand,
  type PodSingleCommand,
  type VmcCommandDef,
} from '@/utils/pod/pod13Command'

/** 单次指令等待装订回执的超时时间（毫秒）。 */
const POD_ACK_TIMEOUT_MS = 2000

/**
 * 13所吊舱控制 store。
 *
 * 发送时序由后端保证：单次指令注入 100ms 后自动复位，
 * 连续指令以 10Hz 持续发送、松开后立即回落。
 * 本 store 负责：指令提交、长按/步进定时器管理、内部角度记录、
 * 装订回执（0x28/0x01 → pod-command-acked）的 UI 状态。
 * 上行机号由后端按通信配置统一填写，前端不再传机号。
 */
export const usePodStore = defineStore('pod', () => {
  // ==================== 响应式状态 ====================
  /** 当前长按中的连续指令键。 */
  const activeContinuousKey = ref<string | null>(null)
  /** 当前步进中的方向键。 */
  const activeStepKey = ref<string | null>(null)
  /** 等待装订回执的单次指令键。 */
  const pendingKey = ref<string | null>(null)
  /** 最近一次装订回执时间戳（毫秒）。 */
  const lastAckAt = ref<number | null>(null)
  /** 最近一次错误信息。 */
  const lastError = ref<string | null>(null)
  /** 内部俯仰角记录（度，向下为负），平台复位时清零。 */
  const podPitch = ref(0)
  /** 内部方位角记录（度）。 */
  const podYaw = ref(0)
  /** 最近成功的 VMC 指令键（用于通道高亮）。 */
  const vmcActiveKey = ref<string | null>(null)

  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let stepTimer: ReturnType<typeof setInterval> | null = null
  let ackUnlisten: UnlistenFn | null = null
  let injectGeneration = 0
  let injectGate: Promise<void> = Promise.resolve()

  function bumpInjectGeneration() {
    injectGeneration += 1
    return injectGeneration
  }

  function runInjectOp(op: () => Promise<void>): Promise<void> {
    const run = injectGate.then(op, op)
    injectGate = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function clearStepTimer() {
    if (stepTimer !== null) {
      clearInterval(stepTimer)
      stepTimer = null
    }
  }

  // ==================== 基础工具 ====================

  /** 装订回执等待中（用于 UI 显示指令在途状态）。 */
  const pendingActive = computed(() => pendingKey.value !== null)

  function clearPendingTimer() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  function armPendingTimeout(key: string) {
    clearPendingTimer()
    pendingKey.value = key
    pendingTimer = setTimeout(() => {
      // 超时未收到装订回执：指令已发出，仅结束等待态
      if (pendingKey.value === key) {
        pendingKey.value = null
      }
      pendingTimer = null
    }, POD_ACK_TIMEOUT_MS)
  }

  function recordError(error: unknown) {
    lastError.value =
      error instanceof Error ? error.message : String(error ?? '未知错误')
  }

  // ==================== 单次 / 引导指令 ====================

  /** 提交一条单次触发指令（100ms 注入窗口，后端自动复位）。 */
  async function sendSingle(command: PodSingleCommand) {
    try {
      await invoke('send_pod_command', {
        request: {
          switchCode: command.code,
          mode: 'single',
          pitchDeg: 0,
          yawDeg: 0,
        },
      })
      armPendingTimeout(command.key)
      lastError.value = null
    } catch (error) {
      recordError(error)
      throw error
    }
  }

  /** 数字引导：将吊舱引导至指定俯仰/方位角（同步更新内部角度记录）。 */
  async function guideTo(pitchDeg: number, yawDeg: number, key = 'guide') {
    const pitch = clampPodAngle(pitchDeg, 'pitch')
    const yaw = clampPodAngle(yawDeg, 'yaw')
    try {
      await invoke('send_pod_command', {
        request: {
          switchCode: POD_GUIDE_CODE,
          mode: 'single',
          pitchDeg: pitch,
          yawDeg: yaw,
        },
      })
      podPitch.value = pitch
      podYaw.value = yaw
      armPendingTimeout(key)
      lastError.value = null
    } catch (error) {
      recordError(error)
      throw error
    }
  }

  /** 平台复位：发 0x1B 并清零内部角度记录。 */
  async function resetPlatform(command: PodSingleCommand) {
    await sendSingle(command)
    podPitch.value = 0
    podYaw.value = 0
  }

  /** 执行引导快捷位定义。 */
  async function sendGuidePreset(command: PodGuideCommand) {
    await guideTo(command.pitchDeg, command.yawDeg, command.key)
  }

  // ==================== 连续 / 长按指令 ====================

  /** 长按开始：以 10Hz 持续发送（后端 UntilClearedPeriodic）。 */
  async function startContinuous(command: PodContinuousCommand) {
    clearStepTimer()
    activeStepKey.value = null
    const generation = bumpInjectGeneration()
    activeContinuousKey.value = command.key
    try {
      await runInjectOp(async () => {
        if (generation !== injectGeneration) return
        await invoke('send_pod_command', {
          request: {
            switchCode: command.code,
            mode: 'continuous',
            pitchDeg: 0,
            yawDeg: 0,
          },
        })
        if (generation !== injectGeneration) {
          await invoke('stop_pod_command')
          return
        }
        lastError.value = null
      })
    } catch (error) {
      if (generation === injectGeneration) {
        activeContinuousKey.value = null
        recordError(error)
      }
    }
  }

  /** 长按结束：立即停止注入并复位。 */
  async function stopContinuous() {
    bumpInjectGeneration()
    activeContinuousKey.value = null
    try {
      await runInjectOp(async () => {
        await invoke('stop_pod_command')
      })
    } catch (error) {
      recordError(error)
    }
  }

  // ==================== 步进控制（0x19 数字引导 ±1°/100ms） ====================

  async function sendStepFrame(axis: 'pitch' | 'yaw', dir: 1 | -1) {
    const nextPitch =
      axis === 'pitch'
        ? clampPodAngle(podPitch.value + dir * POD_STEP_DEG, 'pitch')
        : podPitch.value
    const nextYaw =
      axis === 'yaw'
        ? clampPodAngle(podYaw.value + dir * POD_STEP_DEG, 'yaw')
        : podYaw.value
    await invoke('send_pod_command', {
      request: {
        switchCode: POD_GUIDE_CODE,
        mode: 'continuous',
        pitchDeg: nextPitch,
        yawDeg: nextYaw,
      },
    })
    podPitch.value = nextPitch
    podYaw.value = nextYaw
    lastError.value = null
  }

  /**
   * 步进开始：锁住一次 0x19 连续注入，每 100ms 替换 ±1.00° 载荷。
   * 第一帧即步进；提交成功后才更新本地角度。
   */
  async function startStepping(
    key: string,
    axis: 'pitch' | 'yaw',
    dir: 1 | -1,
  ) {
    if (activeStepKey.value === key) return
    clearStepTimer()
    activeContinuousKey.value = null
    const generation = bumpInjectGeneration()
    activeStepKey.value = key
    try {
      await runInjectOp(async () => {
        if (generation !== injectGeneration) return
        await sendStepFrame(axis, dir)
        if (generation !== injectGeneration) {
          await invoke('stop_pod_command')
          return
        }
        clearStepTimer()
        stepTimer = setInterval(() => {
          void runInjectOp(async () => {
            if (generation !== injectGeneration) return
            try {
              await sendStepFrame(axis, dir)
            } catch {
              // 保持按住，下一拍重试；未成功的角度不写入本地
            }
            if (generation !== injectGeneration) {
              await invoke('stop_pod_command')
            }
          })
        }, POD_STEP_INTERVAL_MS)
      })
    } catch (error) {
      if (generation === injectGeneration) {
        activeStepKey.value = null
        recordError(error)
      }
    }
  }

  /** 步进结束：停定时器并立即清空 0x70 注入。 */
  async function stopStepping() {
    clearStepTimer()
    bumpInjectGeneration()
    activeStepKey.value = null
    try {
      await runInjectOp(async () => {
        await invoke('stop_pod_command')
      })
    } catch (error) {
      recordError(error)
    }
  }

  // ==================== VMC 通道指令 ====================

  /** 发送 VMC 视频通道指令（飞控开关帧三判二）。 */
  async function sendVmc(command: VmcCommandDef) {
    try {
      await invoke('submit_vmc_command', {
        switchCode: command.code,
      })
      vmcActiveKey.value = command.key
      armPendingTimeout(command.key)
      lastError.value = null
    } catch (error) {
      recordError(error)
      throw error
    }
  }

  // ==================== 安全停止 / 生命周期 ====================

  /** 停止全部连续控制（窗口失焦、关窗、组件卸载时调用）。 */
  async function stopAll() {
    clearStepTimer()
    bumpInjectGeneration()
    activeContinuousKey.value = null
    activeStepKey.value = null
    try {
      await runInjectOp(async () => {
        await invoke('stop_pod_command')
      })
    } catch (error) {
      recordError(error)
    }
  }

  /** 订阅吊舱装订回执事件（0x28/0x01）。幂等，可重复调用。 */
  async function initAckListener() {
    if (ackUnlisten !== null) return
    ackUnlisten = await listen<number>('pod-command-acked', () => {
      lastAckAt.value = Date.now()
      clearPendingTimer()
      pendingKey.value = null
    })
  }

  function dispose() {
    void stopAll()
    clearPendingTimer()
    pendingKey.value = null
    if (ackUnlisten !== null) {
      ackUnlisten()
      ackUnlisten = null
    }
  }

  return {
    // 状态
    activeContinuousKey,
    activeStepKey,
    pendingKey,
    pendingActive,
    lastAckAt,
    lastError,
    podPitch,
    podYaw,
    vmcActiveKey,
    // 单次/引导
    sendSingle,
    guideTo,
    resetPlatform,
    sendGuidePreset,
    // 连续
    startContinuous,
    stopContinuous,
    // 步进
    startStepping,
    stopStepping,
    // VMC
    sendVmc,
    // 生命周期
    stopAll,
    initAckListener,
    dispose,
  }
})
