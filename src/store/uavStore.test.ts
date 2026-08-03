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
