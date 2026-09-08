import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import axios from 'axios'
import { reverseGeocoder } from './TDTProvider'

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}))

vi.mock('./TDTProvider', () => ({
  reverseGeocoder: vi.fn(),
}))

const mockedAxiosGet = axios.get as unknown as Mock
const mockedReverse = reverseGeocoder as unknown as Mock

const store = new Map<string, string>()

function stubLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  })
}

function stubNavigatorOnline(onLine = true) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      onLine,
    },
  })
}

describe('myLocation', () => {
  beforeEach(() => {
    store.clear()
    mockedAxiosGet.mockReset()
    mockedReverse.mockReset()
    stubLocalStorage()
    mockedReverse.mockResolvedValue({
      data: { status: '0', result: { formatted_address: '江苏省苏州市昆山市' } },
    } as any)
  })

  it('IP 定位成功时直接返回坐标', async () => {
    const { resolveMyLocation } = await import('./myLocation')
    stubNavigatorOnline(true)
    mockedAxiosGet.mockResolvedValue({
      data: {
        longitude: 120.9814,
        latitude: 31.3865,
        country_name: '中国',
        region: '江苏省',
        city: '苏州市',
      },
    })

    const location = await resolveMyLocation()

    expect(location.source).toBe('ip')
    expect(location.longitude).toBeCloseTo(120.9814, 6)
    expect(location.latitude).toBeCloseTo(31.3865, 6)
    expect(location.address).toContain('苏州')
  })

  it('IP 定位失败时回退到本地缓存', async () => {
    const { resolveMyLocation, saveCachedLocation } = await import('./myLocation')
    stubNavigatorOnline(true)
    mockedAxiosGet.mockRejectedValue(new Error('network down'))
    saveCachedLocation({
      longitude: 116.4074,
      latitude: 39.9042,
      source: 'ip',
      timestamp: Date.now(),
    })

    const location = await resolveMyLocation()

    expect(location.source).toBe('cache')
    expect(location.longitude).toBeCloseTo(116.4074, 6)
  })

  it('全部失败时返回默认位置', async () => {
    const { resolveMyLocation, DEFAULT_MY_LOCATION } = await import('./myLocation')
    stubNavigatorOnline(true)
    mockedAxiosGet.mockRejectedValue(new Error('network down'))

    const location = await resolveMyLocation({ allowIp: false })

    expect(location.source).toBe('fallback')
    expect(location.longitude).toBe(DEFAULT_MY_LOCATION.longitude)
    expect(location.latitude).toBe(DEFAULT_MY_LOCATION.latitude)
  })

  it('格式化经纬度文本', async () => {
    const { formatLonLat } = await import('./myLocation')
    expect(formatLonLat(120.9814, 31.3865)).toBe('120.981400°E, 31.386500°N')
    expect(formatLonLat(-120.5, -31.25)).toBe('120.500000°W, 31.250000°S')
  })
})
