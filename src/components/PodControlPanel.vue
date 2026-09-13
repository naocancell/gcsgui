<template>
  <div class="pod-panel" :style="panelStyle" @mousedown="startDrag">
    <!-- Header -->
    <div
      class="panel-header"
      :data-tauri-drag-region="props.standalone ? '' : undefined"
      @dblclick="onHeaderDblClick"
    >
      <div
        class="title"
        :data-tauri-drag-region="props.standalone ? '' : undefined"
      >
        <span :data-tauri-drag-region="props.standalone ? '' : undefined">
          POD CONTROL
        </span>
        <span
          class="sub-title"
          :data-tauri-drag-region="props.standalone ? '' : undefined"
        >
          光电吊舱控制
        </span>
      </div>
      <div class="header-meta">
        <div
          class="status"
          :class="{ online: isLinkOnline, offline: !isLinkOnline }"
        >
          <span class="status-dot"></span>
          <span>{{ isLinkOnline ? 'LINK' : 'TIMEOUT' }}</span>
        </div>
        <div class="status ack" :class="{ 'ack-ok': ackFresh }">
          <span class="status-dot"></span>
          <span>{{ ackFresh ? 'ACK' : '装订回执' }}</span>
        </div>
        <div
          v-if="props.standalone"
          class="window-controls"
          @mousedown.stop
          @dblclick.stop
        >
          <button
            class="window-control"
            type="button"
            aria-label="最小化吊舱控制窗口"
            title="最小化"
            @click="emit('minimize')"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <path d="M2 8.5h8" />
            </svg>
          </button>
          <button
            class="window-control"
            type="button"
            :aria-label="props.maximized ? '还原吊舱控制窗口' : '最大化吊舱控制窗口'"
            :title="props.maximized ? '还原' : '最大化'"
            @click="emit('maximize')"
          >
            <svg v-if="!props.maximized" aria-hidden="true" viewBox="0 0 12 12">
              <rect x="2.5" y="2.5" width="7" height="7" />
            </svg>
            <svg v-else aria-hidden="true" viewBox="0 0 12 12">
              <rect x="3.5" y="2" width="6" height="6" />
              <rect x="2" y="3.5" width="6" height="6" />
            </svg>
          </button>
          <button
            class="window-control window-control-close"
            type="button"
            aria-label="关闭吊舱控制窗口"
            title="关闭"
            @click="emit('close')"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 双列主容器 -->
    <div class="pod-content-grid">
      <!-- 左列：状态条、工作模式与数字引导 -->
      <div class="pod-column pod-column-left">
        <!-- 状态条 -->
        <div class="pod-status-bar">
          <div class="status-item">
            <span class="status-label">目标</span>
            <span class="status-value">UAV-{{ currentAircraftId }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">俯仰</span>
            <span class="status-value angle">
              {{ formatAngle(podStore.podPitch) }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">方位</span>
            <span class="status-value angle">
              {{ formatAngle(podStore.podYaw) }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">注入</span>
            <span
              class="status-value"
              :class="{
                live:
                  podStore.activeContinuousKey !== null ||
                  podStore.activeStepKey !== null,
              }"
            >
              {{ injectionLabel }}
            </span>
          </div>
          <div
            v-if="podStore.lastError"
            class="status-error"
            :title="podStore.lastError"
          >
            {{ podStore.lastError }}
          </div>
        </div>

        <!-- Section 1: 工作模式 -->
        <section class="pod-section">
          <div class="section-header-title">
            工作模式
            <span class="section-sub">MODE</span>
          </div>
          <div class="btn-grid">
            <button
              v-for="cmd in POD_MODE_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{
                pending: podStore.pendingKey === cmd.key,
                danger: cmd.key === 'reset',
              }"
              :title="cmd.hint"
              @click="onSingle(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
          <div class="btn-grid track-grid">
            <button
              v-for="cmd in POD_TRACK_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{ pending: podStore.pendingKey === cmd.key }"
              :title="cmd.hint"
              @click="onSingle(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
        </section>

        <!-- Section 2: 数字引导 -->
        <section class="pod-section">
          <div class="section-header-title">
            数字引导
            <span class="section-sub">DIGITAL GUIDE · 0x19</span>
          </div>
          <div class="guide-layout">
            <div class="guide-left">
              <div class="angle-display">
                <div class="angle-box">
                  <span class="angle-label">俯仰 PITCH</span>
                  <span class="angle-num">
                    {{ formatAngle(podStore.podPitch) }}°
                  </span>
                  <span class="angle-range">-110.00 ~ +50.00</span>
                </div>
                <div class="angle-box">
                  <span class="angle-label">方位 AZIMUTH</span>
                  <span class="angle-num">
                    {{ formatAngle(podStore.podYaw) }}°
                  </span>
                  <span class="angle-range">-180.00 ~ +180.00</span>
                </div>
              </div>
              <div class="guide-input-row">
                <label class="guide-field">
                  <span class="guide-field-label">俯仰°</span>
                  <input
                    v-model.number="guidePitchInput"
                    type="number"
                    step="0.5"
                    :min="POD_PITCH_MIN"
                    :max="POD_PITCH_MAX"
                  />
                </label>
                <label class="guide-field">
                  <span class="guide-field-label">方位°</span>
                  <input
                    v-model.number="guideYawInput"
                    type="number"
                    step="0.5"
                    :min="POD_YAW_MIN"
                    :max="POD_YAW_MAX"
                  />
                </label>
                <button
                  type="button"
                  class="pod-btn pod-btn-primary"
                  title="将吊舱引导至输入角度"
                  @click="onGuideSubmit"
                >
                  引导
                </button>
              </div>
              <div class="btn-grid">
                <button
                  v-for="cmd in POD_GUIDE_COMMANDS"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{ pending: podStore.pendingKey === cmd.key }"
                  :title="cmd.hint"
                  @click="podStore.sendGuidePreset(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
            <div class="guide-right">
              <div class="step-pad">
                <span class="pad-caption">步进控制 · 长按 1.00°/100ms</span>
                <div class="pad-grid">
                  <span></span>
                  <button
                    type="button"
                    class="pad-btn"
                    :class="{
                      holding: podStore.activeStepKey === 'step-pitch-plus',
                    }"
                    title="俯仰＋ 视线上抬"
                    aria-label="俯仰步进增加"
                    @pointerdown.prevent="
                      onStepDown('step-pitch-plus', 'pitch', 1, $event)
                    "
                    @pointerup="onStepUp"
                    @pointerleave="onStepUp"
                    @pointercancel="onStepUp"
                    @contextmenu.prevent
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M6 2.5 10 9H2z" />
                    </svg>
                  </button>
                  <span></span>
                  <button
                    type="button"
                    class="pad-btn"
                    :class="{
                      holding: podStore.activeStepKey === 'step-yaw-minus',
                    }"
                    title="方位− 视线左转"
                    aria-label="方位步进减小"
                    @pointerdown.prevent="
                      onStepDown('step-yaw-minus', 'yaw', -1, $event)
                    "
                    @pointerup="onStepUp"
                    @pointerleave="onStepUp"
                    @pointercancel="onStepUp"
                    @contextmenu.prevent
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2.5 6 9 2v8z" />
                    </svg>
                  </button>
                  <div class="pad-center" title="吊舱瞄准中心">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 1v6M12 17v6M1 12h6M17 12h6" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    class="pad-btn"
                    :class="{
                      holding: podStore.activeStepKey === 'step-yaw-plus',
                    }"
                    title="方位＋ 视线右转"
                    aria-label="方位步进增加"
                    @pointerdown.prevent="
                      onStepDown('step-yaw-plus', 'yaw', 1, $event)
                    "
                    @pointerup="onStepUp"
                    @pointerleave="onStepUp"
                    @pointercancel="onStepUp"
                    @contextmenu.prevent
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M9.5 6 3 2v8z" />
                    </svg>
                  </button>
                  <span></span>
                  <button
                    type="button"
                    class="pad-btn"
                    :class="{
                      holding: podStore.activeStepKey === 'step-pitch-minus',
                    }"
                    title="俯仰− 视线下压"
                    aria-label="俯仰步进减小"
                    @pointerdown.prevent="
                      onStepDown('step-pitch-minus', 'pitch', -1, $event)
                    "
                    @pointerup="onStepUp"
                    @pointerleave="onStepUp"
                    @pointercancel="onStepUp"
                    @contextmenu.prevent
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M6 9.5 2 3h8z" />
                    </svg>
                  </button>
                  <span></span>
                </div>
              </div>
              <div class="drift-pad">
                <span class="pad-caption">陀螺补漂 · 长按微调</span>
                <div class="drift-grid">
                  <button
                    v-for="cmd in POD_DRIFT_COMMANDS"
                    :key="cmd.key"
                    type="button"
                    class="pod-btn pod-btn-hold"
                    :class="{
                      holding: podStore.activeContinuousKey === cmd.key,
                    }"
                    :title="cmd.hint"
                    @pointerdown.prevent="onContinuousDown(cmd, $event)"
                    @pointerup="onContinuousUp(cmd)"
                    @pointerleave="onContinuousUp(cmd)"
                    @pointercancel="onContinuousUp(cmd)"
                    @contextmenu.prevent
                  >
                    {{ cmd.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 右列：红外图像、照相激光与视频通道 -->
      <div class="pod-column pod-column-right">
        <!-- Section 3: 红外与图像 -->
        <section class="pod-section">
          <div class="section-header-title">
            红外与图像
            <span class="section-sub">IR &amp; IMAGE</span>
          </div>
          <div class="image-row">
            <div class="image-group">
              <span class="group-label">红外极性</span>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in podIrPolarity"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{ pending: podStore.pendingKey === cmd.key }"
                  :title="cmd.hint"
                  @click="onSingle(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
            <div class="image-group">
              <span class="group-label">红外视场</span>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in podIrFov"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{ pending: podStore.pendingKey === cmd.key }"
                  :title="cmd.hint"
                  @click="onSingle(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
            <div class="image-group">
              <span class="group-label">光学变焦 · 长按</span>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in POD_ZOOM_COMMANDS"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn pod-btn-hold"
                  :class="{ holding: podStore.activeContinuousKey === cmd.key }"
                  :title="cmd.hint"
                  @pointerdown.prevent="onContinuousDown(cmd, $event)"
                  @pointerup="onContinuousUp(cmd)"
                  @pointerleave="onContinuousUp(cmd)"
                  @pointercancel="onContinuousUp(cmd)"
                  @contextmenu.prevent
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
          </div>
          <div class="image-row">
            <div class="image-group grow">
              <span class="group-label">画面显示</span>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in POD_IMAGE_COMMANDS"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{ pending: podStore.pendingKey === cmd.key }"
                  :title="cmd.hint"
                  @click="onSingle(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
            <div class="image-group grow">
              <span class="group-label">可见光透雾</span>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in POD_DEFOG_COMMANDS"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{ pending: podStore.pendingKey === cmd.key }"
                  :title="cmd.hint"
                  @click="onSingle(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Section 4: 照相与激光 -->
        <section class="pod-section">
          <div class="task-layout">
            <div class="task-block">
              <div class="section-header-title slim">
                照相任务
                <span class="section-sub">CAMERA</span>
              </div>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in POD_CAMERA_COMMANDS"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{ pending: podStore.pendingKey === cmd.key }"
                  :title="cmd.hint"
                  @click="onSingle(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
            <div class="task-block">
              <div class="section-header-title slim">
                激光测距
                <span class="section-sub">LASER</span>
              </div>
              <div class="btn-grid tight">
                <button
                  v-for="cmd in POD_LASER_COMMANDS"
                  :key="cmd.key"
                  type="button"
                  class="pod-btn"
                  :class="{
                    pending: podStore.pendingKey === cmd.key,
                    active: isLaserActive(cmd.key),
                  }"
                  :title="cmd.hint"
                  @click="onLaser(cmd)"
                >
                  {{ cmd.label }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Section 5: 控制通道 (横向通栏排布) -->
    <section class="pod-section pod-section-vmc">
      <div class="section-header-title">
        控制通道
        <span class="section-sub">VMC CHANNEL · 0xC0-0xCD</span>
      </div>
      <div class="vmc-horizontal-grid">
        <div class="vmc-group">
          <span class="group-label">下行码率</span>
          <div class="btn-grid vmc-btn-grid">
            <button
              v-for="cmd in VMC_RATE_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{
                pending: podStore.pendingKey === cmd.key,
                active: podStore.vmcActiveKey === cmd.key,
              }"
              :title="cmd.hint"
              @click="podStore.sendVmc(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
        </div>
        <div class="vmc-group">
          <span class="group-label">信号源</span>
          <div class="btn-grid vmc-btn-grid">
            <button
              v-for="cmd in VMC_CHANNEL_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{
                pending: podStore.pendingKey === cmd.key,
                active: podStore.vmcActiveKey === cmd.key,
              }"
              :title="cmd.hint"
              @click="podStore.sendVmc(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
        </div>
        <div class="vmc-group">
          <span class="group-label">拼图模式</span>
          <div class="btn-grid vmc-btn-grid">
            <button
              v-for="cmd in VMC_LAYOUT_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{
                pending: podStore.pendingKey === cmd.key,
                active: podStore.vmcActiveKey === cmd.key,
              }"
              :title="cmd.hint"
              @click="podStore.sendVmc(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
        </div>
        <div class="vmc-group">
          <span class="group-label">机载记录</span>
          <div class="btn-grid vmc-btn-grid">
            <button
              v-for="cmd in VMC_RECORD_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{
                pending: podStore.pendingKey === cmd.key,
                active: cmd.key === 'vmc-record' && vmcRecording,
                danger: cmd.key === 'vmc-data-clear',
              }"
              :title="cmd.hint"
              @click="onVmc(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
        </div>
        <div class="vmc-group">
          <span class="group-label">链路输出</span>
          <div class="btn-grid vmc-btn-grid">
            <button
              v-for="cmd in VMC_OUTPUT_COMMANDS"
              :key="cmd.key"
              type="button"
              class="pod-btn"
              :class="{
                pending: podStore.pendingKey === cmd.key,
                active: podStore.vmcActiveKey === cmd.key,
              }"
              :title="cmd.hint"
              @click="podStore.sendVmc(cmd)"
            >
              {{ cmd.label }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <div class="pod-footer">
      13所光电吊舱 · Z45 指令集 · 单次指令注入 100ms 自动复位 · 长按指令 10Hz
      周期发送
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useUavStore } from '@/store/uavStore'
import { usePodStore } from '@/store/podStore'
import {
  POD_DEFOG_COMMANDS,
  POD_DRIFT_COMMANDS,
  POD_GUIDE_COMMANDS,
  POD_IMAGE_COMMANDS,
  POD_IR_COMMANDS,
  POD_LASER_COMMANDS,
  POD_MODE_COMMANDS,
  POD_PITCH_MAX,
  POD_PITCH_MIN,
  POD_TRACK_COMMANDS,
  POD_YAW_MAX,
  POD_YAW_MIN,
  POD_ZOOM_COMMANDS,
  POD_CAMERA_COMMANDS,
  VMC_CHANNEL_COMMANDS,
  VMC_LAYOUT_COMMANDS,
  VMC_OUTPUT_COMMANDS,
  VMC_RATE_COMMANDS,
  VMC_RECORD_COMMANDS,
  type PodContinuousCommand,
  type PodSingleCommand,
  type VmcCommandDef,
} from '@/utils/pod/pod13Command'

const props = defineProps<{
  standalone?: boolean
  maximized?: boolean
}>()

const emit = defineEmits<{
  (e: 'minimize'): void
  (e: 'maximize'): void
  (e: 'close'): void
}>()

function onHeaderDblClick() {
  if (props.standalone) emit('maximize')
}

const uavStore = useUavStore()
const podStore = usePodStore()

// ==================== 遥测状态 ====================

const currentAircraftId = computed(() => uavStore.fp95Aggregate?.uavId ?? 255)
const isLinkOnline = computed(() => uavStore.fp95Aggregate !== null)

// 激光/记录的本地状态跟踪（协议本身无回读，按用户操作显示）
const laserPowerOn = ref(false)
const laserRangeOn = ref(false)
const vmcRecording = ref(false)

// ==================== 装订回执显示 ====================

const ackFresh = ref(false)
let ackTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => podStore.lastAckAt,
  (value) => {
    if (value === null) return
    ackFresh.value = true
    if (ackTimer !== null) clearTimeout(ackTimer)
    ackTimer = setTimeout(() => {
      ackFresh.value = false
    }, 3000)
  },
)

// ==================== 数字引导输入 ====================

const guidePitchInput = ref(0)
const guideYawInput = ref(0)

// 引导输入框跟随内部角度记录（用户可覆盖）
watch(
  () => [podStore.podPitch, podStore.podYaw] as const,
  ([pitch, yaw]) => {
    guidePitchInput.value = Number(pitch.toFixed(2))
    guideYawInput.value = Number(yaw.toFixed(2))
  },
  { immediate: true },
)

async function onGuideSubmit() {
  await podStore.guideTo(
    guidePitchInput.value,
    guideYawInput.value,
    'guide-manual',
  )
}

// ==================== 指令分发 ====================

async function onSingle(command: PodSingleCommand) {
  try {
    if (command.key === 'reset') {
      await podStore.resetPlatform(command)
    } else {
      await podStore.sendSingle(command)
    }
  } catch {
    // 错误已记录到 podStore.lastError，由状态条展示
  }
}

function onLaser(command: PodSingleCommand) {
  if (command.key === 'laser-power-on') laserPowerOn.value = true
  if (command.key === 'laser-power-off') {
    laserPowerOn.value = false
    laserRangeOn.value = false
  }
  if (command.key === 'laser-range-on') laserRangeOn.value = true
  if (command.key === 'laser-range-off') laserRangeOn.value = false
  void onSingle(command)
}

function isLaserActive(key: string): boolean {
  if (key === 'laser-power-on') return laserPowerOn.value
  if (key === 'laser-range-on') return laserRangeOn.value
  return false
}

function onVmc(command: VmcCommandDef) {
  if (command.key === 'vmc-record') vmcRecording.value = true
  if (command.key === 'vmc-record-stop') vmcRecording.value = false
  void podStore.sendVmc(command).catch(() => {})
}

// ==================== 长按（连续）指令 ====================

function capturePointer(event: PointerEvent) {
  const target = event.currentTarget
  if (target instanceof HTMLElement) {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // 指针可能已释放，忽略
    }
  }
}

function onContinuousDown(command: PodContinuousCommand, event: PointerEvent) {
  capturePointer(event)
  void podStore.startContinuous(command)
}

function onContinuousUp(command: PodContinuousCommand) {
  if (podStore.activeContinuousKey === command.key) {
    void podStore.stopContinuous()
  }
}

// ==================== 步进控制 ====================

function onStepDown(
  key: string,
  axis: 'pitch' | 'yaw',
  dir: 1 | -1,
  event: PointerEvent,
) {
  capturePointer(event)
  void podStore.startStepping(key, axis, dir)
}

function onStepUp() {
  void podStore.stopStepping()
}

// ==================== 显示工具 ====================

function formatAngle(value: number): string {
  return value.toFixed(2)
}

const injectionLabel = computed(() => {
  if (podStore.activeContinuousKey !== null) return '连续注入'
  if (podStore.activeStepKey !== null) return '步进引导'
  if (podStore.pendingKey !== null) return '等待回执'
  return '空闲'
})

// ==================== 面板拖拽（浮动模式） ====================

const panelPosition = ref({ x: 16, y: 56 })

const panelStyle = computed(() => {
  if (props.standalone) {
    return {
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      position: 'relative' as const,
      borderRadius: '0px',
      border: 'none',
      boxShadow: 'none',
      boxSizing: 'border-box' as const,
    }
  }
  return {
    left: panelPosition.value.x + 'px',
    top: panelPosition.value.y + 'px',
  }
})

let dragging = false
let startX = 0
let startY = 0
let originX = 0
let originY = 0

function startDrag(e: MouseEvent) {
  if (props.standalone) return
  if (e.button !== 0) return
  dragging = true
  startX = e.clientX
  startY = e.clientY
  originX = panelPosition.value.x
  originY = panelPosition.value.y
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
  e.preventDefault()
}

function onDrag(e: MouseEvent) {
  if (!dragging) return
  if (e.buttons !== 1) {
    stopDrag()
    return
  }
  let x = originX + e.clientX - startX
  let y = originY + e.clientY - startY
  x = Math.max(0, Math.min(window.innerWidth - 790, x))
  y = Math.max(0, Math.min(window.innerHeight - 200, y))
  panelPosition.value.x = x
  panelPosition.value.y = y
}

function stopDrag() {
  dragging = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

// ==================== 生命周期与安全兜底 ====================

// 窗口失焦时立即停止一切连续控制（长按未松开/窗口切走的兜底）
function handleWindowBlur() {
  void podStore.stopAll()
}

onMounted(async () => {
  window.addEventListener('blur', handleWindowBlur)
  await podStore.initAckListener()
})

onBeforeUnmount(() => {
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  if (ackTimer !== null) clearTimeout(ackTimer)
  void podStore.stopAll()
})

// 红外分组拆分（极性 / 视场）
const podIrPolarity = computed(() =>
  POD_IR_COMMANDS.filter(
    (cmd) => cmd.key.startsWith('ir-white') || cmd.key.startsWith('ir-black'),
  ),
)
const podIrFov = computed(() =>
  POD_IR_COMMANDS.filter((cmd) => cmd.key.includes('fov')),
)
</script>

<style scoped>
.pod-panel {
  --surface-primary: #212121;
  --surface-under: #181818;
  --surface-secondary: #282828;
  --text-primary: rgb(255 255 255 / 90%);
  --text-secondary: rgb(255 255 255 / 65%);
  --text-tertiary: rgb(255 255 255 / 45%);
  --border-light: rgb(255 255 255 / 4%);
  --border-default: rgb(255 255 255 / 8%);
  --border-heavy: rgb(255 255 255 / 14%);
  --focus-blue: #339cff;
  --accent-blue: #2563eb;
  --accent-green: #10a37f;
  --accent-red: #ef4444;
  --accent-warning: #f59e0b;

  position: fixed;
  width: 760px;
  max-height: 86vh;
  overflow-y: auto;
  padding: 16px 20px;
  background: rgba(33, 33, 33, 0.96);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 14px;
  backdrop-filter: blur(16px);
  box-shadow:
    0 16px 32px -8px rgba(0, 0, 0, 0.45),
    0 0 0 1px var(--border-light);
  font-size: 13px;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
  z-index: 2000;
  user-select: none;
}

.pod-panel::-webkit-scrollbar {
  width: 6px;
}

.pod-panel::-webkit-scrollbar-track {
  background: transparent;
}

.pod-panel::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 15%);
  border-radius: 3px;
}

.pod-panel::-webkit-scrollbar-thumb:hover {
  background: rgb(255 255 255 / 25%);
}

/* ==================== Header ==================== */

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-default);
}

.header-meta,
.window-controls {
  display: flex;
  align-items: center;
}

.header-meta {
  gap: 10px;
}

.window-controls {
  gap: 2px;
}

.window-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition:
    color 140ms ease,
    background-color 140ms ease;
}

.window-control svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.4;
}

.window-control:hover {
  color: var(--text-primary);
  background: rgb(255 255 255 / 8%);
}

.window-control-close:hover {
  color: #fff;
  background: #c42b1c;
}

.window-control:focus-visible,
.pod-btn:focus-visible,
.pad-btn:focus-visible {
  outline: 2px solid var(--focus-blue);
  outline-offset: 1px;
}

.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.2px;
  display: flex;
  align-items: center;
}

.sub-title {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-tertiary);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.3px;
  padding: 3px 8px;
  border-radius: 9999px;
  background: rgb(255 255 255 / 5%);
  border: 1px solid var(--border-light);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.online {
  color: var(--text-secondary);
}

.online .status-dot {
  background: var(--accent-green);
}

.offline {
  color: var(--accent-red);
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

.offline .status-dot {
  background: var(--accent-red);
}

.status.ack {
  color: var(--text-tertiary);
}

.status.ack.ack-ok {
  color: var(--accent-green);
  background: rgba(16, 163, 127, 0.1);
  border-color: rgba(16, 163, 127, 0.25);
}

.status.ack.ack-ok .status-dot {
  background: var(--accent-green);
}

/* ==================== 状态条 ==================== */

.pod-status-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 0;
  padding: 6px 12px;
  background: var(--surface-under);
  border: 1px solid var(--border-light);
  border-radius: 9px;
  flex-wrap: wrap;
}

.status-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.status-label {
  color: var(--text-tertiary);
  font-size: 10px;
  letter-spacing: 0.4px;
}

.status-value {
  color: #8ec8ff;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.status-value.live {
  color: var(--accent-warning);
  font-weight: 600;
}

.status-error {
  margin-left: auto;
  max-width: 320px;
  padding: 2px 8px;
  color: #f87171;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ==================== 双列主容器与 Section 容器 ==================== */

.pod-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr);
  gap: 12px;
  margin-top: 10px;
}

.pod-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pod-section {
  margin-top: 0;
  padding: 10px 12px;
  background: var(--surface-under);
  border: 1px solid var(--border-default);
  border-radius: 10px;
}

.section-header-title {
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
  padding-bottom: 6px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-light);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
}

.section-header-title.slim {
  margin-bottom: 6px;
  padding-bottom: 4px;
  font-size: 12px;
}

.section-sub {
  margin-left: 8px;
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.45px;
}

/* ==================== 指令按钮 ==================== */

.btn-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}

.btn-grid.tight {
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 6px;
}

.track-grid {
  margin-top: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.pod-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 78px;
  min-height: 32px;
  padding: 6px 10px;
  color: var(--text-primary);
  background: rgb(255 255 255 / 8%);
  border: 1px solid var(--border-default);
  border-radius: 7px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.pod-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 12%);
  border-color: var(--border-heavy);
  color: #fff;
}

.pod-btn:active:not(:disabled) {
  background: rgb(255 255 255 / 16%);
}

.pod-btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.pod-btn-primary {
  color: #fff;
  background: var(--accent-blue);
  border-color: transparent;
}

.pod-btn-primary:hover:not(:disabled) {
  background: #3b82f6;
}

.pod-btn-primary:active:not(:disabled) {
  background: #1d4ed8;
}

.pod-btn.danger {
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
}

.pod-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.16);
  color: #fca5a5;
}

/* 等待装订回执 */
.pod-btn.pending {
  color: var(--accent-warning);
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.08);
  animation: pod-pulse 1s ease-in-out infinite;
}

/* 激活态（VMC 通道 / 激光电源开等） */
.pod-btn.active {
  color: #4ade80;
  border-color: rgba(16, 163, 127, 0.4);
  background: rgba(16, 163, 127, 0.12);
}

/* 长按保持中 */
.pod-btn.holding {
  color: #fff;
  background: var(--accent-blue);
  border-color: transparent;
  box-shadow:
    0 0 0 1px rgba(37, 99, 235, 0.4),
    0 4px 12px -4px rgba(37, 99, 235, 0.6);
}

@keyframes pod-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

/* ==================== 数字引导 ==================== */

.guide-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 18px;
}

.guide-left {
  min-width: 0;
  padding-right: 18px;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.guide-right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.angle-display {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.angle-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--surface-primary);
  border: 1px solid var(--border-light);
  border-radius: 9px;
}

.angle-label {
  color: var(--text-tertiary);
  font-size: 9px;
  letter-spacing: 0.6px;
}

.angle-num {
  color: #8ec8ff;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.1;
}

.angle-range {
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
}

.guide-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}

.guide-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.guide-field-label {
  color: var(--text-tertiary);
  font-size: 10px;
  padding-left: 2px;
}

.guide-field input {
  box-sizing: border-box;
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
  color: var(--text-primary);
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.guide-field input:focus-visible {
  outline: 2px solid var(--focus-blue);
  outline-offset: 1px;
}

.guide-field input:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

/* ==================== 步进键盘 / 补漂 ==================== */

.pad-caption {
  display: block;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: 10px;
  letter-spacing: 0.3px;
}

.pad-grid {
  display: grid;
  grid-template-columns: repeat(3, 44px);
  grid-template-rows: repeat(3, 44px);
  gap: 6px;
  justify-content: center;
}

.pad-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
  color: var(--text-secondary);
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 9px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
  touch-action: none;
}

.pad-btn svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.pad-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: rgb(255 255 255 / 12%);
  border-color: var(--border-heavy);
}

.pad-btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.pad-btn.holding {
  color: #fff;
  background: var(--accent-blue);
  border-color: transparent;
  box-shadow:
    0 0 0 1px rgba(37, 99, 235, 0.4),
    0 4px 12px -4px rgba(37, 99, 235, 0.6);
}

.pad-center {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: var(--surface-primary);
  border: 1px dashed var(--border-heavy);
  border-radius: 9px;
}

.pad-center svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.drift-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

/* ==================== 红外与图像 ==================== */

.image-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 12px;
}

.image-row:last-child {
  margin-bottom: 0;
}

.image-group {
  min-width: 0;
}

.image-group.grow {
  grid-column: auto / span 3;
}

.group-label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 10px;
  letter-spacing: 0.3px;
}

/* ==================== 照相与激光 ==================== */

.task-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.task-block {
  min-width: 0;
}

/* ==================== 控制通道 / VMC ==================== */

.pod-section-vmc {
  margin-top: 10px;
}

.vmc-horizontal-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.vmc-group {
  min-width: 0;
}

.vmc-btn-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(38px, 1fr));
  gap: 4px;
}

.vmc-btn-grid .pod-btn {
  min-width: 0;
  min-height: 28px;
  padding: 4px 6px;
  font-size: 10px;
  border-radius: 6px;
}

/* ==================== Footer ==================== */

.pod-footer {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-light);
  color: var(--text-tertiary);
  font-size: 10px;
  letter-spacing: 0.3px;
  text-align: center;
}
</style>
