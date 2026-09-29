import { computed } from 'vue'
import type { useUavStore } from '@/store/uavStore'
import type { FP95Frame94Sub2 } from '@/types/entityoptions'

export interface DeiceAlarmItem {
  key: string
  name: string
  code: string
  active: boolean
  desc: string
}

export function useDeiceMonitor(store: ReturnType<typeof useUavStore>) {
  // 防除冰控制器透传数据 (来自 Pinia useUavStore().fp95Deice)
  const deiceData = computed<FP95Frame94Sub2 | null>(() => store.fp95Deice)
  const hasData = computed(() => deiceData.value !== null)

  // 7 项告警状态提取与定义 (基于 status1)
  const alarmItems = computed<DeiceAlarmItem[]>(() => {
    const s = deiceData.value?.status1
    return [
      {
        key: 'overCurrent',
        name: '过电流告警',
        code: 'OVER_CURRENT',
        active: Boolean(s?.overCurrent),
        desc: '输出工作电流超过额定阈值',
      },
      {
        key: 'overVoltage',
        name: '过电压告警',
        code: 'OVER_VOLTAGE',
        active: Boolean(s?.overVoltage),
        desc: '母线供电电压超出允许上限',
      },
      {
        key: 'underVoltage',
        name: '欠电压告警',
        code: 'UNDER_VOLTAGE',
        active: Boolean(s?.underVoltage),
        desc: '母线供电电压低于正常工作下限',
      },
      {
        key: 'commError',
        name: '2秒通信超时',
        code: 'COMM_ERROR',
        active: Boolean(s?.commError),
        desc: '控制器与上级系统通信中断超过2秒',
      },
      {
        key: 'tempError',
        name: '控制盒超温',
        code: 'TEMP_ERROR',
        active: Boolean(s?.tempError),
        desc: '控制器内部温度传感器超过警戒温度',
      },
      {
        key: 'targetPowerOverflow',
        name: '目标功率超范围',
        code: 'POWER_OVERFLOW',
        active: Boolean(s?.targetPowerOverflow),
        desc: '设定的目标功率超过控制器设计最大功率',
      },
      {
        key: 'targetPowerTimeout',
        name: '目标功率调节超时',
        code: 'ADJUST_TIMEOUT',
        active: Boolean(s?.targetPowerTimeout),
        desc: '目标功率动态闭环调节未在预定周期内收敛',
      },
    ]
  })

  // 是否存在任何告警
  const hasAnyAlarm = computed(() => {
    if (!deiceData.value?.status1) return false
    const s = deiceData.value.status1
    return Boolean(
      s.overCurrent ||
      s.overVoltage ||
      s.underVoltage ||
      s.commError ||
      s.tempError ||
      s.targetPowerOverflow ||
      s.targetPowerTimeout
    )
  })

  // 运行模式样式标签
  const modeBadgeClass = computed(() => {
    if (!hasData.value) return 'mode-offline'
    const mode = deiceData.value?.workMode
    switch (mode) {
      case 0:
        return 'mode-closed'
      case 1:
        return 'mode-command'
      case 2:
        return 'mode-constant-power'
      case 3:
        return 'mode-constant-temp'
      default:
        return 'mode-default'
    }
  })

  // 功率利用率与进度百分比
  const powerRatioPercent = computed(() => {
    if (!deiceData.value) return 0
    const target = deiceData.value.targetPower
    const current = deiceData.value.currentPower
    if (
      typeof target !== 'number' ||
      !Number.isFinite(target) ||
      target <= 0 ||
      typeof current !== 'number' ||
      !Number.isFinite(current)
    ) {
      return 0
    }
    return Math.round((current / target) * 100)
  })

  const powerRatioText = computed(() => {
    if (!deiceData.value) return '—'
    return `${powerRatioPercent.value}%`
  })

  const powerRatioWidth = computed(() => {
    if (!deiceData.value) return '0%'
    const clamped = Math.min(100, Math.max(0, powerRatioPercent.value || 0))
    return `${clamped}%`
  })

  // 功率差值 (实际 - 目标)
  const powerDelta = computed(() => {
    if (!deiceData.value) return null
    const current = deiceData.value.currentPower
    const target = deiceData.value.targetPower
    if (
      typeof current !== 'number' ||
      !Number.isFinite(current) ||
      typeof target !== 'number' ||
      !Number.isFinite(target)
    ) {
      return null
    }
    return current - target
  })

  const powerDeltaText = computed(() => {
    if (powerDelta.value === null) return '—'
    const val = powerDelta.value
    return val > 0 ? `+${val} W` : `${val} W`
  })

  const powerDeltaClass = computed(() => {
    return ''
  })

  // 计算视在功率 (U × I)
  const calculatedPower = computed(() => {
    if (!deiceData.value) return null
    const v = deiceData.value.voltage
    const i = deiceData.value.current
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      typeof i !== 'number' ||
      !Number.isFinite(i)
    ) {
      return null
    }
    return v * i
  })

  const calculatedPowerText = computed(() => {
    if (calculatedPower.value === null) return '—'
    return calculatedPower.value.toFixed(1)
  })

  // 控制器温度状态 (严格依据 94 帧遥测状态位 tempError，无协议门限不按数值变色)
  const isTempHigh = computed(() => {
    if (!deiceData.value) return false
    return Boolean(deiceData.value.status1?.tempError)
  })

  const tempStatusText = computed(() => {
    if (!deiceData.value) return '待机'
    if (deiceData.value.status1?.tempError) return '温度异常'
    return '正常'
  })

  return {
    deiceData,
    hasData,
    alarmItems,
    hasAnyAlarm,
    modeBadgeClass,
    powerRatioPercent,
    powerRatioText,
    powerRatioWidth,
    powerDelta,
    powerDeltaText,
    powerDeltaClass,
    calculatedPower,
    calculatedPowerText,
    isTempHigh,
    tempStatusText,
  }
}
