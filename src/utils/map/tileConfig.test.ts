import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TILE_PROXY_STORAGE_KEY,
  DEFAULT_TILE_PROXY_URL,
  normalizeTileUrl,
  isValidTileProxyUrl,
  getTileProxyUrl,
  setTileProxyUrl,
  resetTileProxyUrl,
  applyTileProxyUrlIfChanged,
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

  it('缺少 http/https 协议、空串或非 http 协议视为非法', () => {
    expect(isValidTileProxyUrl('192.168.2.104:8088')).toBe(false)
    expect(isValidTileProxyUrl('ftp://192.168.2.104:8088')).toBe(false)
    expect(isValidTileProxyUrl('')).toBe(false)
    expect(isValidTileProxyUrl('   ')).toBe(false)
    expect(isValidTileProxyUrl('http://192.168.2.104:8088')).toBe(true)
    expect(isValidTileProxyUrl('https://tiles.example.com/path/')).toBe(true)
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

  it('setTileProxyUrl 拒绝非法 URL，不写入也不分发事件', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const ok = setTileProxyUrl('192.168.2.104:8088')
    expect(ok).toBe(false)
    expect(store.get(TILE_PROXY_STORAGE_KEY)).toBeUndefined()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('localStorage 中的空串应回退到默认地址，而不是当成有效缓存', () => {
    store.set(TILE_PROXY_STORAGE_KEY, '')
    expect(getTileProxyUrl()).toBe(normalizeTileUrl(DEFAULT_TILE_PROXY_URL))
  })

  it('applyTileProxyUrlIfChanged 地址未变时不派发事件', () => {
    setTileProxyUrl('http://192.168.2.200:8088')
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const result = applyTileProxyUrlIfChanged('http://192.168.2.200:8088/')
    expect(result.applied).toBe(false)
    expect(result.error).toBeUndefined()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('applyTileProxyUrlIfChanged 非法地址返回错误且不写入', () => {
    const result = applyTileProxyUrlIfChanged('192.168.2.104:8088')
    expect(result.applied).toBe(false)
    expect(result.error).toMatch(/http/i)
    expect(store.get(TILE_PROXY_STORAGE_KEY)).toBeUndefined()
  })

  it('applyTileProxyUrlIfChanged 合法且变化时才持久化', () => {
    const result = applyTileProxyUrlIfChanged('http://10.0.0.8:8088/')
    expect(result.applied).toBe(true)
    expect(getTileProxyUrl()).toBe('http://10.0.0.8:8088')
  })

  it('testTileProxyConnection 缺协议不发请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await testTileProxyConnection('192.168.1.50:8088')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/http/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('testTileProxyConnection 非 JSON 的 200 响应视为失败', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    } as any)

    const result = await testTileProxyConnection('http://192.168.1.50:8088')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/JSON|解析/i)
  })

  it('超时文案使用传入的 timeoutMs，而不是写死 3 秒', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError)

    const result = await testTileProxyConnection('http://192.168.1.50:8088', 1500)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('1.5')
    expect(result.message).not.toContain('3秒')
  })
})
