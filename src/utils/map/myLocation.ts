/*
 * @Description: 我的位置（IP 城市定位 → 上次缓存 → 默认点）
 * 该模块不依赖 Cesium，便于单元测试；地图标记绘制见 myLocationMarker.ts
 */
import axios from 'axios'
import { reverseGeocoder } from './TDTProvider'
import { logger } from '@/utils/logger'

export type MyLocationSource = 'ip' | 'cache' | 'fallback'

export interface MyLocation {
  longitude: number
  latitude: number
  /** 定位精度（米），IP 定位无精度信息 */
  accuracy?: number
  source: MyLocationSource
  /** 逆地理编码得到的中文地址 */
  address?: string
  timestamp: number
}

/** 全部定位手段都失败时使用的兜底位置（与启动时的默认中心一致） */
export const DEFAULT_MY_LOCATION: Omit<MyLocation, 'timestamp'> = {
  longitude: 107.4191777,
  latitude: 37.855152,
  source: 'fallback',
}

const CACHE_KEY = 'gcsgui:my-location'
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export const SOURCE_LABEL: Record<MyLocationSource, string> = {
  ip: 'IP 定位',
  cache: '上次定位',
  fallback: '默认位置',
}

interface IpGeoResult {
  longitude: number
  latitude: number
  city?: string
}

interface IpGeoProvider {
  name: string
  url: string
  parse: (data: any) => IpGeoResult | null
}

function toFiniteNumber(value: unknown): number | undefined {
  const num = typeof value === 'string' ? Number(value) : (value as number)
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined
}

function joinPlace(...parts: unknown[]): string | undefined {
  const text = parts
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim()
  return text || undefined
}

/** 公网 IP 定位候选服务，按序尝试，任一成功即返回 */
const IP_PROVIDERS: IpGeoProvider[] = [
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    parse: (data) => {
      const longitude = toFiniteNumber(data?.longitude)
      const latitude = toFiniteNumber(data?.latitude)
      if (longitude === undefined || latitude === undefined) return null
      return {
        longitude,
        latitude,
        city: joinPlace(data?.country_name, data?.region, data?.city),
      }
    },
  },
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    parse: (data) => {
      const longitude = toFiniteNumber(data?.longitude)
      const latitude = toFiniteNumber(data?.latitude)
      if (longitude === undefined || latitude === undefined) return null
      return {
        longitude,
        latitude,
        city: joinPlace(data?.country, data?.region, data?.city),
      }
    },
  },
  {
    name: 'ip.sb',
    url: 'https://api.ip.sb/geoip',
    parse: (data) => {
      const longitude = toFiniteNumber(data?.longitude)
      const latitude = toFiniteNumber(data?.latitude)
      if (longitude === undefined || latitude === undefined) return null
      return {
        longitude,
        latitude,
        city: joinPlace(data?.country, data?.region, data?.city),
      }
    },
  },
]

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`请求超时（${timeoutMs}ms）`)),
      timeoutMs,
    )
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

/** 读取上次成功定位结果（本地缓存，断网时仍可用） */
export function readCachedLocation(): MyLocation | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MyLocation
    const { longitude, latitude } = parsed ?? {}
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
    if (
      typeof parsed.timestamp === 'number' &&
      Date.now() - parsed.timestamp > CACHE_MAX_AGE
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveCachedLocation(location: MyLocation): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(location))
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
}

/** 公网 IP 粗定位，返回城市级坐标 */
export async function resolveByIp(
  timeoutMs = 4000,
): Promise<IpGeoResult | null> {
  for (const provider of IP_PROVIDERS) {
    try {
      const response = await withTimeout(
        axios.get(provider.url, { timeout: timeoutMs }),
        timeoutMs,
      )
      const parsed = provider.parse(response?.data)
      if (parsed) return parsed
    } catch (error) {
      logger.warn(`[myLocation] IP 定位失败（${provider.name}）:`, error)
    }
  }
  return null
}

/** 天地图逆地理编码，失败时静默返回 undefined */
export async function lookupAddress(
  longitude: number,
  latitude: number,
  timeoutMs = 5000,
): Promise<string | undefined> {
  try {
    const response = await withTimeout(
      reverseGeocoder(longitude, latitude),
      timeoutMs,
    )
    const data: any = response?.data
    if (data?.status !== undefined && String(data.status) !== '0')
      return undefined
    const result = data?.result
    if (!result) return undefined
    if (result.formatted_address) return String(result.formatted_address)
    const component = result.addressComponent ?? {}
    return joinPlace(
      component.province,
      component.city,
      component.county,
      component.road || component.town,
      component.poi,
    )
  } catch (error) {
    console.warn('[myLocation] 逆地理编码失败:', error)
    return undefined
  }
}

export interface ResolveMyLocationOptions {
  /** 保留字段，已不再使用系统定位，仅为兼容旧调用 */
  timeout?: number
  /** 是否允许回退到 IP 定位 */
  allowIp?: boolean
  /** 是否查询中文地址 */
  withAddress?: boolean
}

/**
 * 解析“我的位置”，按 IP 定位 → 本地缓存 → 默认点 依次降级。
 * 已删除系统定位，避免桌面端 Windows 位置服务返回错误城市误导用户。
 */
export async function resolveMyLocation(
  options: ResolveMyLocationOptions = {},
): Promise<MyLocation> {
  const { allowIp = true, withAddress = true } = options

  let result: MyLocation | undefined

  if (
    allowIp &&
    (typeof navigator === 'undefined' || navigator.onLine)
  ) {
    const ip = await resolveByIp()
    if (ip) {
      result = {
        longitude: ip.longitude,
        latitude: ip.latitude,
        address: ip.city,
        source: 'ip',
        accuracy: 5000,
        timestamp: Date.now(),
      }
    }
  }

  if (!result) {
    const cached = readCachedLocation()
    if (cached) result = { ...cached, source: 'cache' }
  }

  if (!result) result = { ...DEFAULT_MY_LOCATION, timestamp: Date.now() }

  if (withAddress && !result.address) {
    const address = await lookupAddress(result.longitude, result.latitude)
    if (address) result.address = address
  }

  if (result.source === 'ip') {
    saveCachedLocation(result)
  }

  return result
}

/** 坐标显示文本，如 120.981400°E, 31.386500°N */
export function formatLonLat(longitude: number, latitude: number): string {
  const lon = `${Math.abs(longitude).toFixed(6)}°${longitude >= 0 ? 'E' : 'W'}`
  const lat = `${Math.abs(latitude).toFixed(6)}°${latitude >= 0 ? 'N' : 'S'}`
  return `${lon}, ${lat}`
}
