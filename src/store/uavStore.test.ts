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
