/**
 * 瓦片代理服务运行时配置与连通性检测
 */

export const TILE_PROXY_STORAGE_KEY = 'GCS_TILE_PROXY_URL'

/**
 * 默认瓦片代理服务地址，优先读取构建环境变量，保底值为 http://192.168.2.104:8088
 */
export const DEFAULT_TILE_PROXY_URL: string =
  (import.meta.env.VITE_TILE_PROXY_URL as string) || 'http://192.168.2.104:8088'

/**
 * 格式化 URL，去除多余空格以及末尾的斜杠
 */
export function normalizeTileUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.replace(/\/+$/, '')
}

/**
 * 瓦片代理地址必须是 http(s) 绝对 URL，避免相对路径打到 GCS 自身 origin。
 */
export function isValidTileProxyUrl(url: string): boolean {
  const normalized = normalizeTileUrl(url)
  if (!normalized) return false
  try {
    const parsed = new URL(normalized)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 获取当前生效的瓦片代理服务地址
 */
export function getTileProxyUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem(TILE_PROXY_STORAGE_KEY)
    if (cached && cached.trim()) {
      return normalizeTileUrl(cached)
    }
  }
  return normalizeTileUrl(DEFAULT_TILE_PROXY_URL)
}

/**
 * 设置并持久化瓦片代理服务地址
 */
export function setTileProxyUrl(url: string): boolean {
  if (!isValidTileProxyUrl(url)) return false
  const normalized = normalizeTileUrl(url)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TILE_PROXY_STORAGE_KEY, normalized)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('gcs-tile-proxy-url-changed', {
        detail: { url: normalized },
      }),
    )
  }
  return true
}

export interface ApplyTileProxyUrlResult {
  applied: boolean
  error?: string
}

/**
 * 仅在规范化后的地址相对当前生效值发生变化时才持久化并热更新。
 */
export function applyTileProxyUrlIfChanged(url: string): ApplyTileProxyUrlResult {
  const normalized = normalizeTileUrl(url)
  if (!isValidTileProxyUrl(normalized)) {
    return {
      applied: false,
      error: '瓦片服务地址须以 http:// 或 https:// 开头',
    }
  }
  if (normalized === getTileProxyUrl()) {
    return { applied: false }
  }
  setTileProxyUrl(normalized)
  return { applied: true }
}

/**
 * 恢复为默认的瓦片代理地址
 */
export function resetTileProxyUrl(): string {
  const defaultUrl = normalizeTileUrl(DEFAULT_TILE_PROXY_URL)
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TILE_PROXY_STORAGE_KEY)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('gcs-tile-proxy-url-changed', {
        detail: { url: defaultUrl },
      }),
    )
  }
  return defaultUrl
}

export interface TileTestResult {
  ok: boolean
  message: string
  details?: {
    status?: string
    hitCount?: number
    missCount?: number
    cacheRoot?: string
  }
}

/**
 * 测试目标瓦片服务的连通性
 * @param url 待测试的服务根地址（如 http://192.168.2.104:8088）
 * @param timeoutMs 超时时间，默认 3000ms
 */
export async function testTileProxyConnection(
  url: string,
  timeoutMs = 3000,
): Promise<TileTestResult> {
  const targetUrl = normalizeTileUrl(url)
  if (!targetUrl) {
    return { ok: false, message: '瓦片服务地址不能为空' }
  }
  if (!isValidTileProxyUrl(targetUrl)) {
    return { ok: false, message: '瓦片服务地址须以 http:// 或 https:// 开头' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const endpoint = `${targetUrl}/status`
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return {
        ok: false,
        message: `服务响应异常 (HTTP ${res.status})`,
      }
    }

    let data: {
      status?: string
      hitCount?: number
      missCount?: number
      cacheRoot?: string
    }
    try {
      data = await res.json()
    } catch {
      return { ok: false, message: '服务响应不是有效的 JSON' }
    }
    return {
      ok: true,
      message: '连接成功，瓦片服务正在运行中',
      details: {
        status: data.status,
        hitCount: data.hitCount,
        missCount: data.missCount,
        cacheRoot: data.cacheRoot,
      },
    }
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      const seconds = timeoutMs / 1000
      return {
        ok: false,
        message: `连接超时（${seconds}秒内未收到响应），请检查 IP 与网络`,
      }
    }
    return {
      ok: false,
      message: `无法连接到服务: ${err.message || '请检查服务是否启动或防火墙设置'}`,
    }
  }
}
