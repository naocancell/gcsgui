import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

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
  lastUpdatedMs: number
}

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

  // 结冰告警描述
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

  // 启动 Tauri 事件监听
  async function startListening() {
    if (unlisten) return
    try {
      unlisten = await listen<MissionPayloadAggregate[]>('mission-payload-event', (event) => {
        const list = event.payload || []
        for (const item of list) {
          payloadMap.value[item.uavId] = item
        }
      })
      console.log('前端已挂载 MissionPayload 载荷数据监听服务')
    } catch (e) {
      console.error('挂载 MissionPayload 监听失败:', e)
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

  return {
    payloadMap,
    activeUavId,
    currentPayload,
    relayStatus,
    icingDesc,
    startListening,
    stopListening,
    sendRelayControl,
    sendRelayBatch,
    queryRelayStatus,
  }
})
