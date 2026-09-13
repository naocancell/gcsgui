<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  Cartesian2,
  Cartographic,
  EllipsoidGeodesic,
  EllipsoidTerrainProvider,
  Math as CesiumMath,
  sampleTerrain,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium'
import { resolveElevationSample } from '@/utils/map/elevationDisplay'

const longitude = ref('—')
const latitude = ref('—')
const seaLevel = ref('—')
const elevationSource = ref<'WGS84' | 'DEM' | ''>('')
const viewHeight = ref('—')
const scaleLabel = ref('—')
const isDecimal = ref(true)
const scaleBarRef = ref<HTMLElement>()

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

const DEFAULT_SCALE_BAR_PIXELS = 72

function formatCoordinate(value: string) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return '—'
  if (isDecimal.value) return `${numericValue.toFixed(6)}°`

  const sign = numericValue < 0 ? '-' : ''
  const absolute = Math.abs(numericValue)
  const degrees = Math.floor(absolute)
  const minutesFloat = (absolute - degrees) * 60
  const minutes = Math.floor(minutesFloat)
  const seconds = (minutesFloat - minutes) * 60
  return `${sign}${degrees}°${String(minutes).padStart(2, '0')}'${seconds.toFixed(2).padStart(5, '0')}″`
}

function formatHeight(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—'
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
  if (!Number.isFinite(distance) || distance <= 0) return '—'
  if (distance >= 1000) {
    const km = distance / 1000
    const decimals = km >= 100 ? 1 : 2
    return `${km.toFixed(decimals)} km`
  }
  const decimals = distance < 10 ? 1 : 0
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
    scaleLabel.value = '—'
    return
  }

  const now = Date.now()
  if (now - lastScaleUpdate < 50) return
  lastScaleUpdate = now

  const width = viewer.scene.canvas.clientWidth
  const height = viewer.scene.canvas.clientHeight
  if (!width || !height) {
    scaleLabel.value = '—'
    return
  }

  const centerX = Math.floor(width / 2)
  const scaleBarPixels =
    scaleBarRef.value?.getBoundingClientRect().width || DEFAULT_SCALE_BAR_PIXELS
  const sampleYs = [
    Math.floor(height * 0.68),
    Math.floor(height * 0.78),
    Math.floor(height * 0.55),
    Math.floor(height * 0.42),
  ]
  let metersPerPixel: number | undefined

  for (const sampleY of sampleYs) {
    const left = pickGroundPoint(centerX - scaleBarPixels / 2, sampleY)
    const right = pickGroundPoint(centerX + scaleBarPixels / 2, sampleY)
    if (!left || !right) continue

    const ellipsoid = viewer.scene.globe.ellipsoid
    const geodesic = new EllipsoidGeodesic(
      ellipsoid.cartesianToCartographic(left),
      ellipsoid.cartesianToCartographic(right),
    )
    const distance = geodesic.surfaceDistance
    if (Number.isFinite(distance) && distance > 0) {
      metersPerPixel = distance / scaleBarPixels
      break
    }
  }

  metersPerPixel ??= estimateMetersPerPixel(width, height)
  if (!metersPerPixel) {
    smoothedScaleDistance = undefined
    scaleLabel.value = '—'
    return
  }

  const measuredDistance = metersPerPixel * scaleBarPixels
  smoothedScaleDistance =
    smoothedScaleDistance === undefined
      ? measuredDistance
      : smoothedScaleDistance * 0.72 + measuredDistance * 0.28
  scaleLabel.value = formatScale(smoothedScaleDistance)
}

function isEllipsoidTerrain() {
  return (
    !viewer?.terrainProvider ||
    viewer.terrainProvider instanceof EllipsoidTerrainProvider
  )
}

function applyElevation(sample: ReturnType<typeof resolveElevationSample>) {
  if (!sample) return
  seaLevel.value = sample.text
  elevationSource.value = sample.source
}

function clearCursorPosition() {
  longitude.value = '—'
  latitude.value = '—'
  seaLevel.value = '—'
  elevationSource.value = ''
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

    const rawHeight = Number(Cartographic.fromCartesian(position)?.height)
    const terrainIsEllipsoid = isEllipsoidTerrain()
    applyElevation(
      resolveElevationSample({
        height: rawHeight,
        terrainIsEllipsoid,
        terrainSampleOk: false,
      }),
    )

    if (terrainIsEllipsoid) return

    void getLevel13TerrainHeight(
      CesiumMath.toDegrees(cartographic.longitude),
      CesiumMath.toDegrees(cartographic.latitude),
    ).then((terrainHeight) => {
      if (requestId !== positionRequestId) return
      applyElevation(
        resolveElevationSample({
          height: terrainHeight,
          terrainIsEllipsoid: false,
          terrainSampleOk: terrainHeight !== undefined,
        }),
      )
    })
  } catch {
    clearCursorPosition()
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
  <footer id="map-footer" role="status" aria-live="polite">
    <div class="status-inner">
      <div class="status-section section-coords">
        <span class="tac-badge" title="全球空间坐标参考基准">
          <span class="tac-indicator"></span>
          WGS-84
        </span>

        <div class="tac-field coord-field" title="当前光标所在经度">
          <span class="tac-tag">LON</span>
          <span class="tac-val">{{ longitude }}</span>
        </div>

        <span class="tac-sep" aria-hidden="true"></span>

        <div class="tac-field coord-field" title="当前光标所在纬度">
          <span class="tac-tag">LAT</span>
          <span class="tac-val">{{ latitude }}</span>
        </div>

        <button
          class="tac-mode-btn"
          type="button"
          :title="isDecimal ? '切换至度分秒格式 (DMS)' : '切换至十进制度格式 (DD)'"
          :aria-label="isDecimal ? '切换至度分秒格式' : '切换至十进制度格式'"
          @click="toggleCoordinateFormat"
        >
          {{ isDecimal ? 'DD' : 'DMS' }}
        </button>
      </div>

      <div class="status-section section-elevation">
        <div class="tac-field" title="光标处地表高程 (MSL / 椭球高)">
          <span class="tac-tag">ELEV</span>
          <span class="tac-val">{{ seaLevel }}</span>
          <span
            v-if="elevationSource"
            class="tac-source"
            :class="elevationSource.toLowerCase()"
            :title="elevationSource === 'DEM' ? '高程来源于数字高程模型' : '高程来源于 WGS-84 几何椭球参考面'"
          >
            {{ elevationSource }}
          </span>
        </div>

        <span class="tac-sep" aria-hidden="true"></span>

        <div class="tac-field" title="视点相机高度">
          <span class="tac-tag">CAM</span>
          <span class="tac-val">{{ viewHeight }}</span>
        </div>
      </div>

      <div class="status-section section-scale">
        <div class="tac-field scale-field" title="地面几何比例尺">
          <span class="tac-tag">SCALE</span>
          <div class="tac-ruler-wrap">
            <span ref="scaleBarRef" class="tac-ruler" aria-hidden="true"></span>
          </div>
          <span class="tac-val scale-val">{{ scaleLabel }}</span>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
#map-footer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  height: 36px;
  min-height: 36px;
  padding: 0 16px;
  color: #cbd5e1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  background: #090d13;
  border-top: 1px solid #1e2838;
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
  box-sizing: border-box;
  pointer-events: none;
}

.status-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  width: 100%;
  margin: 0 auto;
}

.status-section {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
}

.section-coords {
  gap: 10px;
}

.section-elevation {
  gap: 14px;
}

.section-scale {
  justify-content: flex-end;
}

.tac-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  color: #94a3b8;
  background: #111722;
  border: 1px solid #233146;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.tac-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 5px rgba(16, 185, 129, 0.7);
}

/* 字段与标签 */
.tac-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.coord-field {
  min-width: 136px;
}

.tac-tag {
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
}

.tac-val {
  color: #ffffff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.2px;
  pointer-events: auto;
  user-select: text;
}

.scale-val {
  min-width: 60px;
}

/* 高程数据源指示 */
.tac-source {
  padding: 1px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.1;
  border-radius: 2px;
  letter-spacing: 0.3px;
}

.tac-source.dem {
  color: #34d399;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.32);
}

.tac-source.wgs84 {
  color: #94a3b8;
  background: rgba(100, 116, 139, 0.14);
  border: 1px solid rgba(100, 116, 139, 0.28);
}

/* 分隔竖线 */
.tac-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 14px;
  background: #233044;
}

.tac-mode-btn {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  color: #cbd5e1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: #141c27;
  border: 1px solid #28374d;
  border-radius: 3px;
  cursor: pointer;
  pointer-events: auto;
  transition: background-color 100ms ease, border-color 100ms ease, color 100ms ease;
}

.tac-mode-btn:hover {
  color: #ffffff;
  background: #1e2a3b;
  border-color: #38bdf8;
}

.tac-mode-btn:active {
  background: #0f1620;
  transform: translateY(1px);
}

.tac-ruler-wrap {
  display: inline-flex;
  align-items: center;
  margin: 0 4px;
}

.tac-ruler {
  display: inline-block;
  flex: 0 0 72px;
  width: 72px;
  height: 5px;
  border-right: 2px solid #cbd5e1;
  border-bottom: 2px solid #cbd5e1;
  border-left: 2px solid #cbd5e1;
  position: relative;
}

.tac-ruler::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 1.5px;
  height: 4px;
  background: #94a3b8;
  transform: translateX(-50%);
}

/* 响应式收敛 */
@media (max-width: 1080px) {
  #map-footer {
    padding: 0 10px;
  }
  .status-section {
    gap: 8px;
  }
  .coord-field {
    min-width: 120px;
  }
  .tac-badge {
    display: none;
  }
}

@media (max-width: 780px) {
  .section-elevation {
    display: none;
  }
  .tac-ruler {
    flex-basis: 54px;
    width: 54px;
  }
}
</style>
