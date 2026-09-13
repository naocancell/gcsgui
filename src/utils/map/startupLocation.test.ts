import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STARTUP_LOCATION_STORAGE_KEY,
  STARTUP_LOCATION_CHANGED_EVENT,
  getStartupLocation,
  setStartupLocation,
  clearStartupLocation,
  hasStartupLocation,
  formatStartupLocationLabel,
  isValidCoordinate,
  type StartupLocation,
} from './startupLocation'

function stubLocalStorage() {
  let store: Record<string, string> = {}
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value)
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    },
    configurable: true,
    writable: true,
  })
}

function stubWindow() {
  if (typeof window === 'undefined') {
    const listeners: Record<string, Function[]> = {}
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: (event: string, fn: Function) => {
          listeners[event] = listeners[event] || []
          listeners[event].push(fn)
        },
        removeEventListener: (event: string, fn: Function) => {
          if (!listeners[event]) return
          listeners[event] = listeners[event].filter((f) => f !== fn)
        },
        dispatchEvent: (event: any) => {
          const type = event.type
          listeners[type]?.forEach((fn) => fn(event))
          return true
        },
      },
    })
  }
}

describe('startupLocation 单元测试', () => {
  beforeEach(() => {
    stubLocalStorage()
    stubWindow()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('坐标合法性校验 isValidCoordinate 正常工作', () => {
    expect(isValidCoordinate(116.39, 39.9)).toBe(true)
    expect(isValidCoordinate(0, 0)).toBe(true)
    expect(isValidCoordinate(-180, -90)).toBe(true)
    expect(isValidCoordinate(180, 90)).toBe(true)

    expect(isValidCoordinate(181, 0)).toBe(false)
    expect(isValidCoordinate(-181, 0)).toBe(false)
    expect(isValidCoordinate(0, 91)).toBe(false)
    expect(isValidCoordinate(0, -91)).toBe(false)
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false)
    expect(isValidCoordinate(0, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('未设置时 getStartupLocation 返回 null，hasStartupLocation 返回 false', () => {
    expect(getStartupLocation()).toBeNull()
    expect(hasStartupLocation()).toBe(false)
  })

  it('setStartupLocation 正常写入并分发全局事件', () => {
    const handler = vi.fn()
    window.addEventListener(STARTUP_LOCATION_CHANGED_EVENT, handler)

    const loc: StartupLocation = {
      longitude: 121.4737,
      latitude: 31.2304,
      height: 15,
      name: '上海据点',
    }

    const ok = setStartupLocation(loc)
    expect(ok).toBe(true)
    expect(hasStartupLocation()).toBe(true)

    const retrieved = getStartupLocation()
    expect(retrieved).not.toBeNull()
    expect(retrieved?.longitude).toBe(121.4737)
    expect(retrieved?.latitude).toBe(31.2304)
    expect(retrieved?.height).toBe(15)
    expect(retrieved?.name).toBe('上海据点')
    expect(retrieved?.updatedAt).toBeTypeOf('number')

    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener(STARTUP_LOCATION_CHANGED_EVENT, handler)
  })

  it('setStartupLocation 传入非法坐标应返回 false 并不写入', () => {
    const invalidLoc: StartupLocation = {
      longitude: 999,
      latitude: 31.2304,
    }
    const ok = setStartupLocation(invalidLoc)
    expect(ok).toBe(false)
    expect(hasStartupLocation()).toBe(false)
  })

  it('clearStartupLocation 能成功清空并触发事件', () => {
    const loc: StartupLocation = {
      longitude: 113.2644,
      latitude: 23.1291,
    }
    setStartupLocation(loc)
    expect(hasStartupLocation()).toBe(true)

    const handler = vi.fn()
    window.addEventListener(STARTUP_LOCATION_CHANGED_EVENT, handler)

    clearStartupLocation()
    expect(hasStartupLocation()).toBe(false)
    expect(getStartupLocation()).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)

    window.removeEventListener(STARTUP_LOCATION_CHANGED_EVENT, handler)
  })

  it('当 localStorage 中数据损坏或格式错误时，应安全降级返回 null', () => {
    localStorage.setItem(STARTUP_LOCATION_STORAGE_KEY, 'invalid-json-str')
    expect(getStartupLocation()).toBeNull()
    expect(hasStartupLocation()).toBe(false)

    localStorage.setItem(
      STARTUP_LOCATION_STORAGE_KEY,
      JSON.stringify({ longitude: 'abc', latitude: 30 }),
    )
    expect(getStartupLocation()).toBeNull()
  })

  it('formatStartupLocationLabel 格式化经纬度文本正确', () => {
    expect(formatStartupLocationLabel({ longitude: 116.3912, latitude: 39.9075 })).toBe(
      '116.391200°E, 39.907500°N',
    )
    expect(formatStartupLocationLabel({ longitude: -73.9851, latitude: -40.7488 })).toBe(
      '73.985100°W, 40.748800°S',
    )
  })
})
