import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => vi.fn()),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

import { useUavStore } from './uavStore'
import type { SimulatedGuidance } from '@/utils/map/simulatedGuidance'

function validFrame94(sequence?: number) {
  return {
    uavId: 11,
    ...(sequence === undefined ? {} : { frame94Sequence: sequence }),
    frame94: {
      Sub1: {
        addressType: 'ICAO地址',
        sAddress: '780525',
        adsLon: 109.657924,
        adsLat: 18.582261,
        adsAlt: 2903.2,
        adsVl: 154.8,
        adsVu: 8.5,
        adsYaw: 24.1,
        flightNum: [],
        adsAlt2: 0,
        adsSpeed: [0, 0, 0] as [number, number, number],
        adsYaw2: 0,
      },
    },
  }
}

describe('uavStore transponder targets', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clears derived targets when FP95 listening stops', async () => {
    const store = useUavStore()
    store.updateFp95Aggregate(validFrame94())

    expect(store.transponderMap.size).toBe(1)

    await store.stopFp95Service()

    expect(store.transponderMap.size).toBe(0)
  })

  it('expires a target when later aggregate snapshots carry no new frame94 sequence', () => {
    vi.useFakeTimers()
    const store = useUavStore()
    const payload = validFrame94(1)

    store.updateFp95Aggregate(payload)
    vi.advanceTimersByTime(9_000)
    store.updateFp95Aggregate(payload)
    vi.advanceTimersByTime(1_001)
    store.updateFp95Aggregate({ uavId: 11 })

    expect(store.transponderMap.size).toBe(0)
  })

  it('expires a target when FP95 aggregate events stop', () => {
    vi.useFakeTimers()
    const store = useUavStore()

    store.updateFp95Aggregate(validFrame94(1))
    vi.advanceTimersByTime(10_001)

    expect(store.transponderMap.size).toBe(0)
  })

  it('supports concurrent Sub1 (ADS-B) and Sub2 (Deice) without mutual overwriting', () => {
    const store = useUavStore()
    const payload = {
      uavId: 95,
      frame94Sequence: 1,
      frame94: {
        Sub1: {
          addressType: 'ICAO地址',
          sAddress: '780525',
          adsLon: 109.657924,
          adsLat: 18.582261,
          adsAlt: 2903.2,
          adsVl: 154.8,
          adsVu: 8.5,
          adsYaw: 24.1,
          flightNum: [],
          adsAlt2: 0,
          adsSpeed: [0, 0, 0] as [number, number, number],
          adsYaw2: 0,
        },
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: true,
          targetPower: 3200,
          currentPower: 3150,
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
          controllerTemp: 25.5,
          voltage: 28.0,
          current: 112.5,
          frameCount: 88,
          checksum: 0xaa,
          checksumValid: true,
          rawBytes: [],
          reserved: [],
        },
      },
    }

    store.updateFp95Aggregate(payload)

    // 验证 Sub1 与 Sub2 同时可访问
    expect(store.transponderMap.size).toBe(1)
    expect(store.transponderMap.get('780525')?.adsAlt).toBe(2903.2)
    expect(store.fp95Deice).not.toBeNull()
    expect(store.fp95Deice?.targetPower).toBe(3200)
    expect(store.fp95Deice?.workModeDesc).toBe('恒功率模式')
    expect(store.fp95Deice?.controllerTemp).toBe(25.5)
    expect(store.fp95Aggregate?.frame94?.Sub1).toBeDefined()
    expect(store.fp95Aggregate?.frame94?.Sub2).toBeDefined()
  })

  it('supports sequential arrival of Sub1 then Sub2 without overwriting previous subframe', () => {
    const store = useUavStore()

    // 1. 仅推送 Sub1 (ADS-B)
    store.updateFp95Aggregate({
      uavId: 95,
      frame94Sequence: 10,
      frame94: {
        Sub1: {
          addressType: 'ICAO地址',
          sAddress: '654321',
          adsLon: 110.0,
          adsLat: 20.0,
          adsAlt: 3000.0,
          adsVl: 120.0,
          adsVu: 0.0,
          adsYaw: 90.0,
          flightNum: [],
          adsAlt2: 0,
          adsSpeed: [0, 0, 0] as [number, number, number],
          adsYaw2: 0,
        },
      },
    })

    expect(store.transponderMap.get('654321')).toBeDefined()
    expect(store.fp95Aggregate?.frame94?.Sub1).toBeDefined()
    expect(store.fp95Deice).toBeNull()

    // 2. 接着独立推送 Sub2 (Deice) 无 Sub1
    store.updateFp95Aggregate({
      uavId: 95,
      frame94: {
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: true,
          targetPower: 2500,
          currentPower: 2500,
          workMode: 3,
          workModeDesc: '恒温模式',
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
          controllerTemp: 30.0,
          voltage: 28.0,
          current: 89.2,
          frameCount: 99,
          checksum: 0x55,
          checksumValid: true,
          rawBytes: [],
          reserved: [],
        },
      },
    })

    // 核心验证：先前的 Sub1 与新来的 Sub2 均被完整保留！
    expect(store.fp95Aggregate?.frame94?.Sub1).toBeDefined()
    expect(store.fp95Aggregate?.frame94?.Sub1?.sAddress).toBe('654321')
    expect(store.fp95Deice).not.toBeNull()
    expect(store.fp95Deice?.targetPower).toBe(2500)
    expect(store.fp95Deice?.workModeDesc).toBe('恒温模式')

    // 3. 再次仅推送 Sub1 (ADS-B 更新)，即使显式包含 Sub2: undefined，先前的 Sub2 仍不受影响
    store.updateFp95Aggregate({
      uavId: 95,
      frame94: {
        Sub1: {
          addressType: 'ICAO地址',
          sAddress: '654321',
          adsLon: 110.5,
          adsLat: 20.5,
          adsAlt: 3200.0,
          adsVl: 130.0,
          adsVu: 0.0,
          adsYaw: 95.0,
          flightNum: [],
          adsAlt2: 0,
          adsSpeed: [0, 0, 0] as [number, number, number],
          adsYaw2: 0,
        },
        Sub2: undefined,
      },
    })

    expect(store.fp95Aggregate?.frame94?.Sub1?.adsAlt).toBe(3200.0)
    expect(store.fp95Deice).not.toBeNull()
    expect(store.fp95Deice?.targetPower).toBe(2500)
    expect(store.fp95Deice?.workModeDesc).toBe('恒温模式')
  })

  it('resets fp95Aggregate and fp95Deice to null after FP95_TIMEOUT', () => {
    vi.useFakeTimers()
    const store = useUavStore()

    store.updateFp95Aggregate({
      uavId: 95,
      frame94: {
        Sub2: {
          syncCode: [0xeb, 0x90],
          syncValid: true,
          targetPower: 1500,
          currentPower: 1500,
          workMode: 1,
          workModeDesc: '指令调节模式',
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
          controllerTemp: 20.0,
          voltage: 28.0,
          current: 53.5,
          frameCount: 1,
          checksum: 0,
          checksumValid: true,
          rawBytes: [],
          reserved: [],
        },
      },
    })

    expect(store.fp95Deice).not.toBeNull()

    // 快进 1001ms 触发超时
    vi.advanceTimersByTime(1001)

    expect(store.fp95Aggregate).toBeNull()
    expect(store.fp95Deice).toBeNull()

    vi.useRealTimers()
  })
})


describe('uavStore simulated guidance', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('pauses normal motion while selecting and follows the assigned route', () => {
    const store = useUavStore()
    store.toggleMockUavInfoService()
    const key = '981A:1'
    const initial = store.uavInfoMap.get(key)!
    const initialLongitude = initial.longitude
    const initialAltitude = initial.altitude

    expect(store.pauseSimulatedPlane(key)).toBe(true)
    vi.advanceTimersByTime(40)
    expect(store.uavInfoMap.get(key)?.longitude).toBe(initialLongitude)

    const guidance: SimulatedGuidance = {
      mode: 'line',
      points: [
        { lon: initial.longitude, lat: initial.latitude, heading: 90 },
        { lon: initial.longitude + 0.1, lat: initial.latitude, heading: 90 },
      ],
      progress: 0,
      speed: 100,
      lastUpdate: Date.now(),
      altitude: initial.altitude + 50,
      currentAltitude: initial.altitude,
    }

    expect(store.setSimulatedGuidance(key, guidance)).toBe(true)
    vi.advanceTimersByTime(100)

    expect(store.getSimulatedGuidance(key)).toBe(guidance)
    expect(store.uavInfoMap.get(key)?.longitude).toBeGreaterThan(
      initialLongitude,
    )
    expect(store.uavInfoMap.get(key)?.altitude).toBeGreaterThan(initialAltitude)

    store.clearSimulatedGuidance(key)
    store.resumeSimulatedPlane(key)
    expect(store.getSimulatedGuidance(key)).toBeNull()
    store.toggleMockUavInfoService()
  })

  it('rejects guidance when mock flight is not running', () => {
    const store = useUavStore()
    const guidance = {} as SimulatedGuidance

    expect(store.setSimulatedGuidance('981A:1', guidance)).toBe(false)
    expect(store.pauseSimulatedPlane('981A:1')).toBe(false)
  })

  it('starts the same three simulated aircraft as the original project', () => {
    const store = useUavStore()
    store.toggleMockUavInfoService()

    expect([...store.uavInfoMap.keys()]).toEqual(['981A:1', '981C:2', '981C:3'])
    expect(store.uavInfoMap.get('981C:3')).toMatchObject({
      longitude: 116.3912757,
      latitude: 39.906217,
      altitude: 500,
      relativeAltitude: 500,
      groundSpeed: 200,
      groundSpeedDirection: 45,
      verticalSpeed: -0.2,
      airspeed: 200,
      trueAirspeed: 200,
      headingAngle: 43.7,
      currentRouteId: 2,
      nextRouteId: 2,
      nextPoint: 3,
      distanceNext: 8000,
    })

    store.toggleMockUavInfoService()
  })
})
