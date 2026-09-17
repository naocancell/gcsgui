import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUavStore } from '@/store/uavStore'
import { useDeiceMonitor } from './useDeiceMonitor'
import type { FP95Frame94Sub2 } from '@/types/entityoptions'

describe('useDeiceMonitor 业务逻辑与状态告警测试', () => {
  let store: ReturnType<typeof useUavStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useUavStore()
  })

  it('无遥测数据时优雅降级为待机占位状态', () => {
    const monitor = useDeiceMonitor(store)

    expect(monitor.hasData.value).toBe(false)
    expect(monitor.deiceData.value).toBeNull()
    expect(monitor.hasAnyAlarm.value).toBe(false)
    expect(monitor.modeBadgeClass.value).toBe('mode-offline')
    expect(monitor.powerRatioText.value).toBe('—')
    expect(monitor.powerRatioWidth.value).toBe('0%')
    expect(monitor.powerDeltaText.value).toBe('—')
    expect(monitor.calculatedPowerText.value).toBe('—')
    expect(monitor.isTempHigh.value).toBe(false)
    expect(monitor.tempStatusText.value).toBe('STANDBY')

    // 验证 7 项告警项结构完整且均为未激活
    expect(monitor.alarmItems.value).toHaveLength(7)
    for (const item of monitor.alarmItems.value) {
      expect(item.active).toBe(false)
    }
  })

  it('正常遥测数据下正确计算各项工程量', () => {
    const monitor = useDeiceMonitor(store)

    const mockSub2: FP95Frame94Sub2 = {
      syncCode: [0xeb, 0x90],
      syncValid: true,
      targetPower: 3000,
      currentPower: 2950,
      workMode: 2,
      workModeDesc: '恒功率模式',
      status1: {
        overCurrent: false,
        overVoltage: false,
        underVoltage: false,
        commError: false,
        tempError: false,
        targetPowerOverflow: false,
        targetPowerTimeout: false,
      },
      rawStatus1: 0x00,
      status2: 0x00,
      controllerTemp: 42.0,
      voltage: 28.0,
      current: 105.0,
      frameCount: 10,
      checksum: 0x12,
      checksumValid: true,
      rawBytes: [],
      reserved: [],
    }

    store.updateFp95Aggregate({
      uavId: 1,
      frame94: {
        Sub2: mockSub2,
      },
    })

    expect(monitor.hasData.value).toBe(true)
    expect(monitor.deiceData.value?.targetPower).toBe(3000)
    expect(monitor.deiceData.value?.currentPower).toBe(2950)
    expect(monitor.hasAnyAlarm.value).toBe(false)
    expect(monitor.modeBadgeClass.value).toBe('mode-constant-power')

    // 功率计算
    expect(monitor.powerRatioPercent.value).toBe(98)
    expect(monitor.powerRatioText.value).toBe('98%')
    expect(monitor.powerRatioWidth.value).toBe('98%')
    expect(monitor.powerDelta.value).toBe(-50)
    expect(monitor.powerDeltaText.value).toBe('-50 W')
    expect(monitor.powerDeltaClass.value).toBe('delta-warning')

    // 电气计算 (28 * 105 = 2940.0)
    expect(monitor.calculatedPower.value).toBe(2940)
    expect(monitor.calculatedPowerText.value).toBe('2940.0')

    // 温度
    expect(monitor.isTempHigh.value).toBe(false)
    expect(monitor.tempStatusText.value).toBe('NORMAL')
  })

  it('工作模式代码正确映射对应样式类名', () => {
    const monitor = useDeiceMonitor(store)

    const createModeData = (mode: number, desc: string): FP95Frame94Sub2 => ({
      syncCode: [0xeb, 0x90],
      syncValid: true,
      targetPower: 1000,
      currentPower: 1000,
      workMode: mode,
      workModeDesc: desc,
      status1: {
        overCurrent: false,
        overVoltage: false,
        underVoltage: false,
        commError: false,
        tempError: false,
        targetPowerOverflow: false,
        targetPowerTimeout: false,
      },
      rawStatus1: 0,
      status2: 0,
      controllerTemp: 30,
      voltage: 24,
      current: 40,
      frameCount: 1,
      checksum: 0,
      checksumValid: true,
      rawBytes: [],
      reserved: [],
    })

    // 0: 关闭模式
    store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: createModeData(0, '关闭模式') } })
    expect(monitor.modeBadgeClass.value).toBe('mode-closed')

    // 1: 指令调节模式
    store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: createModeData(1, '指令调节模式') } })
    expect(monitor.modeBadgeClass.value).toBe('mode-command')

    // 2: 恒功率模式
    store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: createModeData(2, '恒功率模式') } })
    expect(monitor.modeBadgeClass.value).toBe('mode-constant-power')

    // 3: 恒温模式
    store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: createModeData(3, '恒温模式') } })
    expect(monitor.modeBadgeClass.value).toBe('mode-constant-temp')

    // 其它未知模式
    store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: createModeData(9, '保留模式') } })
    expect(monitor.modeBadgeClass.value).toBe('mode-default')
  })

  it('7 项告警矩阵逐项检测与健康状态判决', () => {
    const monitor = useDeiceMonitor(store)

    const baseData: FP95Frame94Sub2 = {
      syncCode: [0xeb, 0x90],
      syncValid: true,
      targetPower: 2000,
      currentPower: 2000,
      workMode: 2,
      workModeDesc: '恒功率模式',
      status1: {
        overCurrent: false,
        overVoltage: false,
        underVoltage: false,
        commError: false,
        tempError: false,
        targetPowerOverflow: false,
        targetPowerTimeout: false,
      },
      rawStatus1: 0,
      status2: 0,
      controllerTemp: 35,
      voltage: 28,
      current: 70,
      frameCount: 1,
      checksum: 0,
      checksumValid: true,
      rawBytes: [],
      reserved: [],
    }

    const alarmKeys = [
      'overCurrent',
      'overVoltage',
      'underVoltage',
      'commError',
      'tempError',
      'targetPowerOverflow',
      'targetPowerTimeout',
    ] as const

    for (const key of alarmKeys) {
      const copy = JSON.parse(JSON.stringify(baseData)) as FP95Frame94Sub2
      copy.status1[key] = true

      store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: copy } })

      expect(monitor.hasAnyAlarm.value).toBe(true)
      const targetItem = monitor.alarmItems.value.find((a) => a.key === key)
      expect(targetItem).toBeDefined()
      expect(targetItem?.active).toBe(true)

      // 验证其它未触发项仍为 false
      for (const other of alarmKeys) {
        if (other !== key) {
          const otherItem = monitor.alarmItems.value.find((a) => a.key === other)
          expect(otherItem?.active).toBe(false)
        }
      }
    }
  })

  it('控制器超温时正确给出高危报警指示', () => {
    const monitor = useDeiceMonitor(store)

    const highTempData: FP95Frame94Sub2 = {
      syncCode: [0xeb, 0x90],
      syncValid: true,
      targetPower: 2000,
      currentPower: 2000,
      workMode: 2,
      workModeDesc: '恒功率模式',
      status1: {
        overCurrent: false,
        overVoltage: false,
        underVoltage: false,
        commError: false,
        tempError: true,
        targetPowerOverflow: false,
        targetPowerTimeout: false,
      },
      rawStatus1: 0x10,
      status2: 0,
      controllerTemp: 88.5,
      voltage: 28,
      current: 70,
      frameCount: 1,
      checksum: 0,
      checksumValid: true,
      rawBytes: [],
      reserved: [],
    }

    store.updateFp95Aggregate({ uavId: 1, frame94: { Sub2: highTempData } })

    expect(monitor.isTempHigh.value).toBe(true)
    expect(monitor.tempStatusText.value).toBe('CRITICAL OVERTEMP')
  })

  it('边界工况：目标功率为0或负数、反拖吸收工况时安全截断处理', () => {
    const monitor = useDeiceMonitor(store)

    // 目标功率为0时，达成率应安全归零且不抛出除以0错误
    store.updateFp95Aggregate({
      uavId: 1,
      frame94: {
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: true,
          targetPower: 0,
          currentPower: 120,
          workMode: 0,
          workModeDesc: '关闭模式',
          status1: {
            overCurrent: false,
            overVoltage: false,
            underVoltage: false,
            commError: false,
            tempError: false,
            targetPowerOverflow: false,
            targetPowerTimeout: false,
          },
          rawStatus1: 0,
          status2: 0,
          controllerTemp: 22,
          voltage: 28,
          current: 4.2,
          frameCount: 2,
          checksum: 0,
          checksumValid: true,
          rawBytes: [],
          reserved: [],
        },
      },
    })

    expect(monitor.powerRatioPercent.value).toBe(0)
    expect(monitor.powerRatioText.value).toBe('0%')
    expect(monitor.powerRatioWidth.value).toBe('0%')
    expect(monitor.powerDelta.value).toBe(120)
    expect(monitor.powerDeltaText.value).toBe('+120 W')
  })

  it('防御性：异常/缺失 status1 或非法数值时不发生未捕获异常', () => {
    const monitor = useDeiceMonitor(store)

    // 传入 status1 为 undefined 或包含 NaN
    store.updateFp95Aggregate({
      uavId: 1,
      frame94: {
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: false,
          targetPower: NaN,
          currentPower: NaN,
          workMode: 16,
          workModeDesc: '自定义模式',
          status1: undefined as any,
          rawStatus1: 0,
          status2: 0,
          controllerTemp: NaN,
          voltage: NaN,
          current: NaN,
          frameCount: 3,
          checksum: 0,
          checksumValid: false,
          rawBytes: [],
          reserved: [],
        },
      },
    })

    expect(monitor.hasData.value).toBe(true)
    expect(monitor.powerRatioPercent.value).toBe(0)
    expect(monitor.powerDelta.value).toBeNull()
    expect(monitor.powerDeltaText.value).toBe('—')
    expect(monitor.calculatedPower.value).toBeNull()
    expect(monitor.calculatedPowerText.value).toBe('—')
    expect(monitor.isTempHigh.value).toBe(false)
    expect(monitor.tempStatusText.value).toBe('NORMAL')
    expect(monitor.hasAnyAlarm.value).toBe(false)
  })

  it('严苛防御：当数值字段为 null 时，杜绝强制转为 0 的假阳性计算', () => {
    const monitor = useDeiceMonitor(store)

    store.updateFp95Aggregate({
      uavId: 1,
      frame94: {
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: true,
          targetPower: null as any,
          currentPower: null as any,
          workMode: null as any,
          workModeDesc: '',
          status1: null as any,
          rawStatus1: null as any,
          status2: null as any,
          controllerTemp: null as any,
          voltage: null as any,
          current: 10,
          frameCount: null as any,
          checksum: null as any,
          checksumValid: false,
          rawBytes: [],
          reserved: [],
        },
      },
    })

    expect(monitor.hasData.value).toBe(true)
    // 验证 voltage 为 null 时，calculatedPower 不会把 null 转为 0 导致 0*10=0W
    expect(monitor.calculatedPower.value).toBeNull()
    expect(monitor.calculatedPowerText.value).toBe('—')

    // 验证 targetPower 为 null 时，powerRatioPercent 和 powerDelta 安全兜底
    expect(monitor.powerRatioPercent.value).toBe(0)
    expect(monitor.powerRatioText.value).toBe('0%')
    expect(monitor.powerDelta.value).toBeNull()
    expect(monitor.powerDeltaText.value).toBe('—')

    // 温度
    expect(monitor.isTempHigh.value).toBe(false)
    expect(monitor.tempStatusText.value).toBe('NORMAL')
    expect(monitor.hasAnyAlarm.value).toBe(false)
  })

  it('严格类型契约：hasAnyAlarm 在字段包含 undefined/缺失时保证布尔类型，且告警名称与 R2 规范严格一致', () => {
    const monitor = useDeiceMonitor(store)

    store.updateFp95Aggregate({
      uavId: 1,
      frame94: {
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: true,
          targetPower: 1000,
          currentPower: 1000,
          workMode: 1,
          workModeDesc: '指令调节模式',
          status1: {
            overCurrent: false,
            overVoltage: false,
            underVoltage: false,
            commError: false,
            tempError: false,
            targetPowerOverflow: false,
            targetPowerTimeout: undefined as any,
          },
          rawStatus1: 0,
          status2: 0,
          controllerTemp: -42.5,
          voltage: 28,
          current: 35,
          frameCount: 12,
          checksum: 0,
          checksumValid: true,
          rawBytes: [],
          reserved: [],
        },
      },
    })

    // 验证布尔类型且未触发
    expect(monitor.hasAnyAlarm.value).toBe(false)
    expect(typeof monitor.hasAnyAlarm.value).toBe('boolean')

    // 验证 targetPowerTimeout 明确命名为 '目标功率调节超时'
    const timeoutAlarm = monitor.alarmItems.value.find(
      (a) => a.key === 'targetPowerTimeout',
    )
    expect(timeoutAlarm).toBeDefined()
    expect(timeoutAlarm?.name).toBe('目标功率调节超时')

    // 验证极寒超下限温度标签为 LOW TEMPERATURE
    expect(monitor.tempStatusText.value).toBe('LOW TEMPERATURE')
  })
})
