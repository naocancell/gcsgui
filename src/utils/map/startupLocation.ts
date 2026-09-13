/**
 * @Description: 软件启动基准定位点管理、持久化存储、场景标记与鼠标选点控制器
 */
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CustomDataSource,
  Entity,
  HeightReference,
  HorizontalOrigin,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
} from 'cesium'
import type { Viewer } from 'cesium'
import { getMapAssetsFile } from '@/utils/getAssets'

export const STARTUP_LOCATION_STORAGE_KEY = 'GCS_STARTUP_LOCATION'
export const STARTUP_LOCATION_CHANGED_EVENT = 'gcs-startup-location-changed'

const DATA_SOURCE_NAME = 'StartupLocation'
const MARKER_ENTITY_ID = 'startup-location-marker'

export interface StartupLocation {
  longitude: number
  latitude: number
  height?: number
  name?: string
  updatedAt?: number
}

/**
 * 校验经纬度坐标是否合法
 */
export function isValidCoordinate(longitude: number, latitude: number): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false
  if (longitude < -180 || longitude > 180) return false
  if (latitude < -90 || latitude > 90) return false
  return true
}

/**
 * 格式化经纬度显示文本，例如：116.391200°E, 39.907500°N
 */
export function formatStartupLocationLabel(coord: {
  longitude: number
  latitude: number
}): string {
  const lngDir = coord.longitude >= 0 ? 'E' : 'W'
  const latDir = coord.latitude >= 0 ? 'N' : 'S'
  const lngAbs = Math.abs(coord.longitude).toFixed(6)
  const latAbs = Math.abs(coord.latitude).toFixed(6)
  return `${lngAbs}°${lngDir}, ${latAbs}°${latDir}`
}

/**
 * 获取本地持久化的启动定位点
 */
export function getStartupLocation(): StartupLocation | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(STARTUP_LOCATION_STORAGE_KEY)
  if (!raw) return null

  try {
    const data = JSON.parse(raw) as StartupLocation
    if (
      data &&
      typeof data.longitude === 'number' &&
      typeof data.latitude === 'number' &&
      isValidCoordinate(data.longitude, data.latitude)
    ) {
      return data
    }
  } catch (err) {
    console.warn('[startupLocation] 解析存储的启动点位失败，已忽略:', err)
  }
  return null
}

/**
 * 设置并持久化启动定位点
 */
export function setStartupLocation(loc: StartupLocation): boolean {
  if (!isValidCoordinate(loc.longitude, loc.latitude)) {
    console.warn('[startupLocation] 尝试保存非法的坐标:', loc)
    return false
  }

  const payload: StartupLocation = {
    longitude: Number(loc.longitude.toFixed(6)),
    latitude: Number(loc.latitude.toFixed(6)),
    height: Number.isFinite(loc.height) ? Number(loc.height?.toFixed(2)) : 0,
    name: loc.name || '启动基准点',
    updatedAt: Date.now(),
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STARTUP_LOCATION_STORAGE_KEY, JSON.stringify(payload))
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(STARTUP_LOCATION_CHANGED_EVENT, { detail: payload }),
    )
  }
  return true
}

/**
 * 清除已保存的启动定位点
 */
export function clearStartupLocation(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STARTUP_LOCATION_STORAGE_KEY)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(STARTUP_LOCATION_CHANGED_EVENT, { detail: null }),
    )
  }
}

/**
 * 是否已经配置了自定义启动定位点
 */
export function hasStartupLocation(): boolean {
  return getStartupLocation() !== null
}

/**
 * 获取或创建启动点图层数据源
 */
function ensureStartupDataSource(viewer: Viewer): CustomDataSource {
  const existing = viewer.dataSources.getByName(DATA_SOURCE_NAME)[0] as
    | CustomDataSource
    | undefined
  if (existing) return existing

  const dataSource = new CustomDataSource(DATA_SOURCE_NAME)
  viewer.dataSources.add(dataSource)
  return dataSource
}

/**
 * 在三维场景中绘制（或更新）启动基准点标记
 */
export function showStartupLocationMarker(
  viewer: Viewer,
  location: StartupLocation,
): boolean {
  if (!viewer || viewer.isDestroyed()) return false

  const dataSource = ensureStartupDataSource(viewer)
  dataSource.entities.removeAll()

  const position = Cartesian3.fromDegrees(
    location.longitude,
    location.latitude,
    location.height || 0,
  )

  dataSource.entities.add(
    new Entity({
      id: MARKER_ENTITY_ID,
      name: '启动基准点',
      position,
      billboard: {
        image: getMapAssetsFile('marker.svg'),
        width: 32,
        height: 32,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }),
  )

  viewer.scene.requestRender()
  return true
}

/**
 * 清除地图上的启动点标记
 */
export function clearStartupLocationMarker(viewer: Viewer): void {
  if (!viewer || viewer.isDestroyed()) return
  const dataSources = viewer.dataSources.getByName(DATA_SOURCE_NAME)
  dataSources.forEach((ds) => {
    viewer.dataSources.remove(ds, true)
  })
}

/**
 * 相机平滑飞往启动定位点（默认高度 3500 米俯视，俯仰角 -75°）
 */
export function flyToStartupLocation(
  viewer: Viewer,
  location: StartupLocation,
  duration = 2,
): void {
  if (!viewer || viewer.isDestroyed()) return

  const targetHeight = (location.height || 0) + 3500

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      location.longitude,
      location.latitude,
      targetHeight,
    ),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-75),
      roll: 0,
    },
    duration,
  })
}

/**
 * 从鼠标点击屏幕坐标拾取地面三维点
 */
export function pickGroundPosition(
  viewer: Viewer,
  windowPosition: Cartesian2,
): Cartesian3 | undefined {
  if (!viewer || viewer.isDestroyed()) return undefined

  const ray = viewer.camera.getPickRay(windowPosition)
  if (!ray) return undefined

  return (
    viewer.scene.globe.pick(ray, viewer.scene) ||
    viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid)
  )
}

export interface PickStartupPointCallbacks {
  onPicked: (coord: { longitude: number; latitude: number; height?: number }) => void
  onCancel?: () => void
}

/**
 * 启动鼠标选点交互控制器
 * @returns 取消并清理该选点操作的函数
 */
export function startPickingStartupLocation(
  viewer: Viewer,
  callbacks: PickStartupPointCallbacks,
): () => void {
  if (!viewer || viewer.isDestroyed()) {
    callbacks.onCancel?.()
    return () => {}
  }

  const canvas = viewer.scene.canvas
  const originalCursor = canvas.style.cursor
  canvas.style.cursor = 'crosshair'

  const handler = new ScreenSpaceEventHandler(canvas)

  const cleanup = () => {
    if (!handler.isDestroyed()) {
      handler.destroy()
    }
    if (viewer && !viewer.isDestroyed()) {
      canvas.style.cursor = originalCursor
    }
    window.removeEventListener('keydown', handleKeyDown)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      cleanup()
      callbacks.onCancel?.()
    }
  }

  // 左键点击确定选点
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    const cartesian = pickGroundPosition(viewer, movement.position)
    if (!cartesian) return

    const cartographic = Cartographic.fromCartesian(cartesian)
    const longitude = Number(
      CesiumMath.toDegrees(cartographic.longitude).toFixed(6),
    )
    const latitude = Number(
      CesiumMath.toDegrees(cartographic.latitude).toFixed(6),
    )
    const height = Number.isFinite(cartographic.height)
      ? Number(cartographic.height.toFixed(1))
      : 0

    cleanup()
    callbacks.onPicked({ longitude, latitude, height })
  }, ScreenSpaceEventType.LEFT_CLICK)

  // 右键点击取消选点
  handler.setInputAction(() => {
    cleanup()
    callbacks.onCancel?.()
  }, ScreenSpaceEventType.RIGHT_CLICK)

  window.addEventListener('keydown', handleKeyDown)

  return cleanup
}
