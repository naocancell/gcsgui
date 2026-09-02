// stores/useTelemetryStore.ts
import { defineStore } from 'pinia'
import { shallowRef, ref, markRaw } from 'vue'

export interface UavTelemetry {
  timestamp: number

  longitude: number
  latitude: number
  altitude: number

  heading: number
  pitch: number
  roll: number
  yaw: number

  groundSpeed: number
  verticalSpeed: number

  battery: number
  gpsSatellites: number

  flightMode: string
  armed: boolean

  signalStrength?: number
  voltage?: number
  current?: number

  homeDistance?: number
  flightTime?: number
}

const defaultTelemetry: UavTelemetry = {
  timestamp: 0,

  longitude: 0,
  latitude: 0,
  altitude: 0,

  heading: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,

  groundSpeed: 0,
  verticalSpeed: 0,

  battery: 0,
  gpsSatellites: 0,

  flightMode: '未知',
  armed: false,

  signalStrength: 0,
  voltage: 0,
  current: 0,

  homeDistance: 0,
  flightTime: 0,
}

export const useTelemetryStore = defineStore('telemetry', () => {
  // 使用 shallowRef + markRaw 处理高频遥测数据，消除深度代理遍历与 GC 压力
  const telemetry = shallowRef<UavTelemetry | null>(markRaw({ ...defaultTelemetry }))
  const connected = ref(false)
  const lastUpdateTime = ref(0)
  const stale = ref(false)
  const TIMEOUT = 2000 // 2秒没有数据认为数据超时

  function setConnected(value: boolean) {
    connected.value = value
  }

  function checkTimeout() {
    if (!lastUpdateTime.value) {
      return
    }
    const now = Date.now()
    if (now - lastUpdateTime.value > TIMEOUT) {
      stale.value = true
    }
  }

  function updateTelemetry(data: UavTelemetry) {
    telemetry.value = markRaw(data)
    lastUpdateTime.value = Date.now()
    stale.value = false
  }

  function markStale() {
    stale.value = true
  }

  function clearTelemetry() {
    telemetry.value = null
    lastUpdateTime.value = 0
    stale.value = true
  }

  return {
    telemetry,
    connected,
    lastUpdateTime,
    stale,
    TIMEOUT,
    setConnected,
    checkTimeout,
    updateTelemetry,
    markStale,
    clearTelemetry,
  }
})