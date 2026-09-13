import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TILE_PROXY_STORAGE_KEY,
  DEFAULT_TILE_PROXY_URL,
  normalizeTileUrl,
  getTileProxyUrl,
  setTileProxyUrl,
  resetTileProxyUrl,
  testTileProxyConnection,
} from './tileConfig'

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

function stubWindow() {
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: vi.fn(),
      },
    })
  }
}

describe('tileConfig', () => {
  beforeEach(() => {
    stubLocalStorage()
    stubWindow()
    store.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    store.clear()
    vi.restoreAllMocks()
  })

  it('normalizeTileUrl 应去除首尾空格和末尾斜线', () => {
    expect(normalizeTileUrl('  http://192.168.1.100:8088///  ')).toBe(
      'http://192.168.1.100:8088',
    )
    expect(normalizeTileUrl('http://localhost:8088')).toBe('http://localhost:8088')
  })

  it('未设置 localStorage 时应返回默认值', () => {
    expect(getTileProxyUrl()).toBe(normalizeTileUrl(DEFAULT_TILE_PROXY_URL))
  })

  it('setTileProxyUrl 应该更新 localStorage 并分发事件', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    setTileProxyUrl('http://192.168.2.200:8088/')

    expect(store.get(TILE_PROXY_STORAGE_KEY)).toBe(
      'http://192.168.2.200:8088',
    )
    expect(getTileProxyUrl()).toBe('http://192.168.2.200:8088')
    expect(dispatchSpy).toHaveBeenCalled()
  })

  it('resetTileProxyUrl 应该清除 localStorage 并恢复默认值', () => {
    setTileProxyUrl('http://192.168.2.200:8088')
    expect(getTileProxyUrl()).toBe('http://192.168.2.200:8088')

    const res = resetTileProxyUrl()
    expect(res).toBe(normalizeTileUrl(DEFAULT_TILE_PROXY_URL))
    expect(store.get(TILE_PROXY_STORAGE_KEY)).toBeUndefined()
    expect(getTileProxyUrl()).toBe(normalizeTileUrl(DEFAULT_TILE_PROXY_URL))
  })

  it('testTileProxyConnection 测试成功场景', async () => {
    const mockStatus = {
      status: 'running',
      port: 8088,
      cacheRoot: 'D:/cache',
      hitCount: 10,
      missCount: 5,
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockStatus,
    } as any)

    const result = await testTileProxyConnection('http://192.168.1.50:8088')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('连接成功')
    expect(result.details?.hitCount).toBe(10)
  })

  it('testTileProxyConnection 测试失败场景', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as any)

    const result = await testTileProxyConnection('http://192.168.1.50:8088')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('HTTP 500')
  })

  it('testTileProxyConnection 测试网络异常', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const result = await testTileProxyConnection('http://192.168.1.50:8088')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Network error')
  })
})
