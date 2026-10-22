import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/utils/logger'
import type { FP95Frame94Sub2 } from '@/types/entityoptions'

export interface RelayStatus {
  mask: number
  channels: boolean[]
}

export interface BoostModuleData {
  inputVoltage: number
  inputCurrent: number
  outputVoltage: number
  outputCurrent: number
  temperature: number
}

export interface TempSensorGroupData {
  innerWingConst: number
  midWingConst: number
  outerWingConst: number
  innerWingHeat: number
  midWingHeat: number
  outerWingHeat: number
  batteryA: number
  batteryB: number
  verticalTail: number
  horizontalTail: number
}

export interface VoltageSensorData {
  rightInnerWing: number
  rightMidWing: number
  rightOuterWing: number
  rightVerticalTail: number
  rightHorizontalTail: number
  leftInnerWing: number
  leftMidWing: number
  leftOuterWing: number
  leftVerticalTail: number
  leftHorizontalTail: number
  wingConstHeat: number
  v100Input: number
  batteryInput: number
  rectifier1Input: number
  rectifier1PostRelay: number
  regulator1Output: number
  regulator2Output: number
  atmosphereHeat: number
  cloudDropHeat: number
  stepDownModule: number
  rectifier3: number
  v48BoostModule: number
}

export interface CurrentSensorGroup1Data {
  leftVerticalTail: number
  leftHorizontalTail: number
  leftInnerWing: number
  leftMidWing: number
  leftOuterWing: number
  wingConstHeat: number
}

export interface CurrentSensorGroup2Data {
  rightHorizontalTail: number
  rightVerticalTail: number
  rightInnerWing: number
  rightMidWing: number
  rightOuterWing: number
  lowVoltageSupply: number
}

export interface EnvironmentSensorData {
  temperature: number
  humidity: number
  pressure: number
}

export type IcingSeverity =
  | 'NoIce'
  | 'AlertCalculating'
  | 'Light'
  | 'Moderate'
  | 'Severe'
  | 'Extreme'
  | 'Unknown'

export interface IcingSensorData {
  counter: number
  detectorFault: boolean
  icingSeverity: IcingSeverity
  heatingActive: boolean
  versionMajor: number
  versionMinor: number
}

export interface MissionPayloadAggregate {
  uavId: number
  relay: RelayStatus | null
  boostModule: BoostModuleData | null
  tempSensor1: TempSensorGroupData | null
  tempSensor2: TempSensorGroupData | null
  voltageSensor: VoltageSensorData | null
  currentSensor1: CurrentSensorGroup1Data | null
  currentSensor2: CurrentSensorGroup2Data | null
  environmentSensor: EnvironmentSensorData | null
  icingSensor: IcingSensorData | null
  deice?: FP95Frame94Sub2 | null
  lastUpdatedMs: number
  /** 各子设备最近一次成功解析的时间（Unix ms），超时后后端会清空对应数据 */
  deviceUpdatedMs?: Partial<Record<PayloadDeviceKey, number | null>>
}

export type PayloadDeviceKey =
  | 'relay'
  | 'boostModule'
  | 'tempSensor1'
  | 'tempSensor2'
  | 'voltageSensor'
  | 'currentSensor1'
  | 'currentSensor2'
  | 'environmentSensor'
  | 'icingSensor'
  | 'deice'

export const usePayloadStore = defineStore('payloadStore', () => {
  const payloadMap = ref<Record<number, MissionPayloadAggregate>>({})
  const activeUavId = ref<number>(95) // 默认 95 号机
  let unlisten: UnlistenFn | null = null

  const currentPayload = computed<MissionPayloadAggregate | null>(() => {
    return payloadMap.value[activeUavId.value] || null
  })

  // 继电器快捷状态
  const relayStatus = computed<RelayStatus | null>(() => {
    return currentPayload.value?.relay || null
  })

  // 电防冰控制器遥测数据 (0xC6 透传)
  const deiceStatus = computed<FP95Frame94Sub2 | null>(() => {
    return currentPayload.value?.deice || null
  })

  // 结冰告警描述 (0xC5 探测器真实遥测)
  const icingDesc = computed<{ text: string; level: string }>(() => {
    const ice = currentPayload.value?.icingSensor
    if (!ice) return { text: '无结冰数据', level: 'offline' }
    if (ice.detectorFault) return { text: '探测器故障', level: 'danger' }

    switch (ice.icingSeverity) {
      case 'NoIce':
        return { text: '未结冰 (安全)', level: 'normal' }
      case 'AlertCalculating':
        return { text: '结冰告警 (解算速率中)', level: 'warning' }
      case 'Light':
        return { text: '弱结冰', level: 'warning' }
      case 'Moderate':
        return { text: '中度结冰', level: 'danger' }
      case 'Severe':
        return { text: '强结冰', level: 'danger' }
      case 'Extreme':
        return { text: '极强结冰', level: 'danger' }
      default:
        return { text: '未知状态', level: 'offline' }
    }
  })

  // 16 组加热膜最低温度与位置追踪 (严格基于 tempSensor1 / tempSensor2 真实采温)
  const minHeatingMat = computed<{
    temp: number | null
    location: string
  }>(() => {
    const p = currentPayload.value
    if (!p) return { temp: null, location: '等待遥测数据' }

    const s1 = p.tempSensor1
    const s2 = p.tempSensor2
    const mats: { name: string; temp: number | undefined }[] = [
      { name: '左内机翼常加热膜', temp: s1?.innerWingConst },
      { name: '左中机翼常加热膜', temp: s1?.midWingConst },
      { name: '左外机翼常加热膜', temp: s1?.outerWingConst },
      { name: '左内机翼加热膜', temp: s1?.innerWingHeat },
      { name: '左中机翼加热膜', temp: s1?.midWingHeat },
      { name: '左外机翼加热膜', temp: s1?.outerWingHeat },
      { name: '左垂尾加热膜', temp: s1?.verticalTail },
      { name: '左平尾加热膜', temp: s1?.horizontalTail },
      { name: '右内机翼常加热膜', temp: s2?.innerWingConst },
      { name: '右中机翼常加热膜', temp: s2?.midWingConst },
      { name: '右外机翼常加热膜', temp: s2?.outerWingConst },
      { name: '右内机翼加热膜', temp: s2?.innerWingHeat },
      { name: '右中机翼加热膜', temp: s2?.midWingHeat },
      { name: '右外机翼加热膜', temp: s2?.outerWingHeat },
      { name: '右垂尾加热膜', temp: s2?.verticalTail },
      { name: '右平尾加热膜', temp: s2?.horizontalTail },
    ]

    let minVal: number | null = null
    let minLoc = '—'
    for (const item of mats) {
      if (typeof item.temp === 'number' && Number.isFinite(item.temp)) {
        if (minVal === null || item.temp < minVal) {
          minVal = item.temp
          minLoc = item.name
        }
      }
    }

    return {
      temp: minVal,
      location: minLoc,
    }
  })

  // 启动 Tauri 事件监听
  async function startListening() {
    if (unlisten) return
    try {
      unlisten = await listen<MissionPayloadAggregate[]>(
        'mission-payload-event',
        (event) => {
          // 后端每次推送的是完整快照：未出现在列表中的机号说明已被死链剔除，需同步移除
          const list = event.payload || []
          const next: Record<number, MissionPayloadAggregate> = {}
          for (const item of list) {
            next[item.uavId] = item
          }
          payloadMap.value = next
        },
      )
      logger.info('前端已挂载 MissionPayload 载荷数据监听服务')
    } catch (e) {
      logger.error('挂载 MissionPayload 监听失败:', e)
    }
  }

  function stopListening() {
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }

  // 控制指令
  async function sendRelayControl(relayIndex: number, enabled: boolean) {
    return await invoke('send_relay_control', {
      uavId: activeUavId.value,
      relayIndex,
      enabled,
    })
  }

  async function sendRelayBatch(mask: number) {
    return await invoke('send_relay_batch', {
      uavId: activeUavId.value,
      mask,
    })
  }

  async function queryRelayStatus() {
    return await invoke('query_relay_status', {
      uavId: activeUavId.value,
    })
  }

  // 螺旋桨防除冰模式控制指令 (0x00关闭, 0x01调节, 0x02恒功率, 0x03恒温)
  async function sendPropellerDeiceCommand(workMode: number, targetPower: number, targetTemp = 0) {
    return await invoke('send_propeller_deice_command', {
      uavId: activeUavId.value,
      workMode,
      targetPower,
      targetTemp,
    })
  }

  return {
    payloadMap,
    activeUavId,
    currentPayload,
    relayStatus,
    deiceStatus,
    icingDesc,
    minHeatingMat,
    startListening,
    stopListening,
    sendRelayControl,
    sendRelayBatch,
    queryRelayStatus,
    sendPropellerDeiceCommand,
  }
})


