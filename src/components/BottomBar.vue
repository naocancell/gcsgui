<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  Cartesian2,
  Cartographic,
  EllipsoidGeodesic,
  Math as CesiumMath,
  sampleTerrain,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium'

const longitude = ref('noData')
const latitude = ref('noData')
const seaLevel = ref('noData')
const viewHeight = ref('noData')
const scaleLabel = ref('noData')
const isDecimal = ref(true)

let lastLongitude = ''
let lastLatitude = ''
let viewer: any
let handler: ScreenSpaceEventHandler | undefined
let removeCameraChanged: (() => void) | undefined
let removePostRender: (() => void) | undefined
let retryTimer: number | undefined
let lastScaleUpdate = 0
let pendingScreenPosition: Cartesian2 | undefined
let positionTimer: number | undefined
let lastPositionUpdate = 0
let smoothedScaleDistance: number | undefined
let positionRequestId = 0
const terrainHeightCache = new Map<string, number>()
const terrainHeightRequests = new Map<string, Promise<number | undefined>>()

const SCALE_BAR_PIXELS = 96

function formatCoordinate(value: string) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return 'noData'
  if (isDecimal.value) return `${numericValue.toFixed(6)}°`

  const sign = numericValue < 0 ? '-' : ''
  const absolute = Math.abs(numericValue)
  const degrees = Math.floor(absolute)
  const minutesFloat = (absolute - degrees) * 60
  const minutes = Math.floor(minutesFloat)
  const seconds = (minutesFloat - minutes) * 60
  return `${sign}${degrees}°${String(minutes).padStart(2, '0')}'${seconds.toFixed(2).padStart(5, '0')}''`
}

function formatHeight(value: number) {
  if (!Number.isFinite(value) || value < 0) return 'noData'
  return value < 10_000
    ? `${value.toFixed(0)} m`
    : `${(value / 1000).toFixed(1)} km`
}

function updateViewHeight() {
  viewHeight.value = formatHeight(viewer?.camera?.positionCartographic?.height)
}

function terrainCacheKey(longitude: number, latitude: number) {
  return `${longitude.toFixed(5)}/${latitude.toFixed(5)}`
}

async function getLevel13TerrainHeight(longitude: number, latitude: number) {
  if (!viewer?.terrainProvider) return undefined

  const key = terrainCacheKey(longitude, latitude)
  const cachedHeight = terrainHeightCache.get(key)
  if (cachedHeight !== undefined) return cachedHeight

  const pendingRequest = terrainHeightRequests.get(key)
  if (pendingRequest) return pendingRequest

  const request = sampleTerrain(viewer.terrainProvider, 13, [
    Cartographic.fromDegrees(longitude, latitude),
  ])
    .then(([terrainPosition]) => {
      const height = Number(terrainPosition?.height)
      if (!Number.isFinite(height)) return undefined
      terrainHeightCache.set(key, height)
      return height
    })
    .catch(() => undefined)
    .finally(() => terrainHeightRequests.delete(key))

  terrainHeightRequests.set(key, request)
  return request
}

function pickGroundPoint(x: number, y: number) {
  if (!viewer) return undefined
  const windowPosition = new Cartesian2(x, y)
  const scene = viewer.scene
  const ray = viewer.camera.getPickRay(windowPosition)
  if (!ray) return undefined

  return (
    (scene.pickPositionSupported && scene.pickPosition(windowPosition)) ||
    scene.globe.pick(ray, scene) ||
    viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid)
  )
}

function formatScale(distance: number) {
  if (!Number.isFinite(distance) || distance <= 0) return 'noData'
  if (distance >= 1000) {
    const km = distance / 1000
    const decimals = km >= 100 ? 1 : 2
    return `${km.toFixed(decimals)} km`
  }
  const decimals = distance < 10 ? 2 : distance < 100 ? 1 : 0
  return `${distance.toFixed(decimals)} m`
}

function estimateMetersPerPixel(width: number, height: number) {
  const cameraHeight = Number(viewer?.camera?.positionCartographic?.height)
  const fovy = Number(viewer?.camera?.frustum?.fovy) || CesiumMath.toRadians(60)
  if (!Number.isFinite(cameraHeight) || cameraHeight <= 0 || !height)
    return undefined

  const groundSpan = 2 * cameraHeight * Math.tan(fovy / 2)
  const result = groundSpan / height
  return Number.isFinite(result) && result > 0 ? result : undefined
}

function updateScale() {
  if (!viewer?.scene?.globe) {
    scaleLabel.value = 'noData'
    return
  }

  const now = Date.now()
  if (now - lastScaleUpdate < 50) return
  lastScaleUpdate = now

  const width = viewer.scene.canvas.clientWidth
  const height = viewer.scene.canvas.clientHeight
  if (!width || !height) {
    scaleLabel.value = 'noData'
    return
  }

  const centerX = Math.floor(width / 2)
  const sampleYs = [
    Math.floor(height * 0.68),
    Math.floor(height * 0.78),
    Math.floor(height * 0.55),
    Math.floor(height * 0.42),
  ]
  let metersPerPixel: number | undefined

  for (const sampleY of sampleYs) {
    const left = pickGroundPoint(centerX - SCALE_BAR_PIXELS / 2, sampleY)
    const right = pickGroundPoint(centerX + SCALE_BAR_PIXELS / 2, sampleY)
    if (!left || !right) continue

    const ellipsoid = viewer.scene.globe.ellipsoid
    const geodesic = new EllipsoidGeodesic(
      ellipsoid.cartesianToCartographic(left),
      ellipsoid.cartesianToCartographic(right),
    )
    const distance = geodesic.surfaceDistance
    if (Number.isFinite(distance) && distance > 0) {
      metersPerPixel = distance / SCALE_BAR_PIXELS
      break
    }
  }

  metersPerPixel ??= estimateMetersPerPixel(width, height)
  if (!metersPerPixel) {
    smoothedScaleDistance = undefined
    scaleLabel.value = 'noData'
    return
  }

  const measuredDistance = metersPerPixel * SCALE_BAR_PIXELS
  smoothedScaleDistance =
    smoothedScaleDistance === undefined
      ? measuredDistance
      : smoothedScaleDistance * 0.72 + measuredDistance * 0.28
  scaleLabel.value = formatScale(smoothedScaleDistance)
}

function updatePosition(screenPosition: any) {
  lastPositionUpdate = Date.now()
  const requestId = ++positionRequestId
  updateViewHeight()
  updateScale()
  const position = pickGroundPoint(screenPosition.x, screenPosition.y)
  if (!position) {
    return
  }

  try {
    const cartographic =
      viewer.scene.globe.ellipsoid.cartesianToCartographic(position)
    lastLongitude = CesiumMath.toDegrees(cartographic.longitude).toFixed(6)
    lastLatitude = CesiumMath.toDegrees(cartographic.latitude).toFixed(6)
    longitude.value = formatCoordinate(lastLongitude)
    latitude.value = formatCoordinate(lastLatitude)

    const pickedHeight = Number(Cartographic.fromCartesian(position)?.height)
    if (Number.isFinite(pickedHeight) && pickedHeight >= 0) {
      seaLevel.value = `${pickedHeight.toFixed(2)} m`
    }

    void getLevel13TerrainHeight(
      CesiumMath.toDegrees(cartographic.longitude),
      CesiumMath.toDegrees(cartographic.latitude),
    ).then((terrainHeight) => {
      if (requestId !== positionRequestId || terrainHeight === undefined) return
      seaLevel.value = `${terrainHeight.toFixed(2)} m`
    })
  } catch {
    longitude.value = 'noData'
    latitude.value = 'noData'
    seaLevel.value = 'noData'
  }
}

function toggleCoordinateFormat() {
  isDecimal.value = !isDecimal.value
  longitude.value = formatCoordinate(lastLongitude)
  latitude.value = formatCoordinate(lastLatitude)
}

onMounted(() => {
  viewer = window.viewer
  if (!viewer) {
    retryTimer = window.setTimeout(() => {
      viewer = window.viewer
      if (viewer) initializeViewerListeners()
    }, 100)
    return
  }

  initializeViewerListeners()
})

function initializeViewerListeners() {
  if (!viewer || handler) return

  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((movement: any) => {
    pendingScreenPosition = movement.endPosition
    if (positionTimer !== undefined) return

    const elapsed = Date.now() - lastPositionUpdate
    const delay = Math.max(0, 80 - elapsed)
    positionTimer = window.setTimeout(() => {
      positionTimer = undefined
      if (pendingScreenPosition) updatePosition(pendingScreenPosition)
    }, delay)
  }, ScreenSpaceEventType.MOUSE_MOVE)

  const onCameraChanged = () => {
    updateViewHeight()
    updateScale()
  }
  const onPostRender = () => updateScale()
  viewer.camera.changed.addEventListener(onCameraChanged)
  viewer.scene.postRender.addEventListener(onPostRender)
  removeCameraChanged = () =>
    viewer?.camera?.changed?.removeEventListener(onCameraChanged)
  removePostRender = () =>
    viewer?.scene?.postRender?.removeEventListener(onPostRender)

  updateViewHeight()
  updateScale()
}

onUnmounted(() => {
  if (retryTimer !== undefined) window.clearTimeout(retryTimer)
  if (positionTimer !== undefined) window.clearTimeout(positionTimer)
  if (handler && !handler.isDestroyed()) handler.destroy()
  removeCameraChanged?.()
  removePostRender?.()
  handler = undefined
  viewer = undefined
})
</script>

<template>
  <div id="map-footer" role="status" aria-live="polite">
    <div class="status-content">
      <span class="status-item coordinate-item">
        <span class="status-label">经度：</span>
        <span class="status-value">{{ longitude }}</span>
      </span>
      <span class="status-divider" aria-hidden="true"></span>
      <span class="status-item coordinate-item">
        <span class="status-label">纬度：</span>
        <span class="status-value">{{ latitude }}</span>
      </span>
      <span class="status-divider" aria-hidden="true"></span>
      <span class="status-item">
        <span class="status-label">海拔：</span>
        <span class="status-value">{{ seaLevel }}</span>
      </span>
      <span class="status-divider" aria-hidden="true"></span>
      <span class="status-item">
        <span class="status-label">视角：</span>
        <span class="status-value">{{ viewHeight }}</span>
      </span>
      <span class="status-divider" aria-hidden="true"></span>
      <span class="status-item scale-item">
        <span class="status-label">比例尺：</span>
        <span class="scale-line" aria-hidden="true"></span>
        <span class="status-value">{{ scaleLabel }}</span>
      </span>
      <button
        class="format-button"
        type="button"
        :title="isDecimal ? '切换为度分秒格式' : '切换为十进制度格式'"
        :aria-label="isDecimal ? '切换为度分秒格式' : '切换为十进制度格式'"
        @click="toggleCoordinateFormat"
      >
        {{ isDecimal ? 'DD' : 'DMS' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
#map-footer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  min-height: 38px;
  padding: 0 16px;
  color: rgba(240, 246, 250, 0.94);
  font:
    11px 'Segoe UI',
    'Microsoft YaHei',
    sans-serif;
  background: rgba(15, 24, 32, 0.78);
  border-top: 1px solid rgba(108, 173, 194, 0.28);
  box-shadow: 0 -4px 20px rgba(3, 10, 16, 0.18);
  backdrop-filter: blur(10px);
  box-sizing: border-box;
  pointer-events: none;
}

.status-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 38px;
  width: min(100%, 1240px);
  margin: 0 auto;
  overflow-x: auto;
  scrollbar-width: none;
}

.status-content::-webkit-scrollbar {
  display: none;
}

.status-item {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.coordinate-item {
  gap: 4px;
}

.status-label {
  color: rgba(169, 190, 202, 0.82);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.status-value {
  min-width: 0;
  color: #f3f7f9;
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  text-align: left;
}

.coordinate-item .status-value {
  width: 126px;
  min-width: 126px;
  text-align: left;
}

.scale-item .status-value {
  width: 68px;
  min-width: 68px;
}

.status-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 16px;
  margin: 0;
  background: rgba(157, 190, 202, 0.34);
}

.scale-item {
  gap: 8px;
}

.scale-line {
  display: inline-block;
  flex: 0 0 96px;
  width: 96px;
  height: 6px;
  border-right: 1px solid rgba(117, 205, 220, 0.95);
  border-bottom: 1px solid rgba(117, 205, 220, 0.95);
  border-left: 1px solid rgba(117, 205, 220, 0.95);
}

.format-button {
  flex: 0 0 auto;
  width: 32px;
  height: 24px;
  margin-left: 16px;
  padding: 0;
  color: #b9e8ef;
  font:
    600 10px 'Cascadia Mono',
    'Consolas',
    monospace;
  background: rgba(66, 167, 187, 0.14);
  border: 1px solid rgba(100, 196, 212, 0.46);
  border-radius: 3px;
  cursor: pointer;
  pointer-events: auto;
}

.format-button:hover {
  color: #fff;
  background: rgba(66, 167, 187, 0.3);
  border-color: rgba(141, 226, 237, 0.9);
}

@media (max-width: 900px) {
  #map-footer {
    padding: 0 9px;
  }
  .status-content {
    gap: 8px;
  }
  .coordinate-item .status-value {
    width: 120px;
    min-width: 120px;
  }
  .scale-line {
    flex-basis: 72px;
    width: 72px;
  }
}

@media (max-width: 700px) {
  #map-footer {
    min-height: 32px;
  }
  .status-content {
    min-height: 32px;
    justify-content: flex-start;
  }
  .status-label {
    display: none;
  }
  .status-content {
    gap: 6px;
  }
  .coordinate-item .status-value {
    width: 112px;
    min-width: 112px;
  }
  .scale-line {
    flex-basis: 54px;
    width: 54px;
  }
  .format-button {
    margin-left: 8px;
  }
}
</style>
