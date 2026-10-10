<!--
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-07 14:15:35
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-16 19:06:50
 * @Description:
-->
<template>
  <div id="cesium-viewer" ref="viewerDivRef"></div>
  <PlaneInfo v-if="viewerReady" />
  <div class="map-view-actions">
    <n-tooltip placement="left" trigger="hover">
      <template #trigger>
        <button
          type="button"
          class="location-btn"
          aria-label="全球视角"
          @click="flyToGlobalView"
        >
          <n-icon size="18">
            <GlobeOutline />
          </n-icon>
        </button>
      </template>
      全球视角
    </n-tooltip>

    <n-tooltip placement="left" trigger="hover">
      <template #trigger>
        <button
          type="button"
          class="location-btn"
          :class="{ 'is-locating': locating }"
          :disabled="locating"
          aria-label="回到当前位置"
          @click="locateAndShowMyLocation"
        >
          <n-icon size="18">
            <RefreshOutline v-if="locating" class="spin-icon" />
            <LocateOutline v-else />
          </n-icon>
        </button>
      </template>
      {{ locating ? '正在定位…' : '回到当前位置' }}
    </n-tooltip>

    <!-- 启动基准定位点 -->
    <n-tooltip placement="left" trigger="hover">
      <template #trigger>
        <button
          type="button"
          class="location-btn"
          :class="{
            'is-picking': isPickingStartup,
            'has-target': Boolean(currentStartupLoc),
          }"
          aria-label="启动定位点"
          @click="handleStartupBtnClick"
          @contextmenu.prevent="handleStartupContextMenu"
        >
          <n-icon size="18">
            <PinOutline />
          </n-icon>
        </button>
      </template>
      {{ startupTooltipText }}
    </n-tooltip>
  </div>

  <!-- 启动点右键管理菜单 -->
  <n-dropdown
    placement="bottom-start"
    trigger="manual"
    :x="dropdownX"
    :y="dropdownY"
    :options="startupDropdownOptions"
    :show="showStartupDropdown"
    :on-clickoutside="() => (showStartupDropdown = false)"
    @select="handleStartupDropdownSelect"
  />
</template>

<script setup lang="ts">
import PlaneInfo from './PlaneInfo.vue'
import { onMounted, onUnmounted, ref, computed, nextTick } from 'vue'
import {
  Viewer,
  Ion,
  CustomDataSource,
  createWorldTerrainAsync,
  Cartesian2,
  Cartesian3,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium'
import { NIcon, NTooltip, NDropdown, useMessage } from 'naive-ui'
import {
  LocateOutline,
  GlobeOutline,
  RefreshOutline,
  PinOutline,
} from '@vicons/ionicons5'
import {
  flyToMyLocation,
  clearMyLocationMarker,
  showMyLocationMarker,
} from '@/utils/map/myLocationMarker'
import {
  SOURCE_LABEL,
  formatLonLat,
  resolveMyLocation,
} from '@/utils/map/myLocation'
import {
  getStartupLocation,
  setStartupLocation,
  clearStartupLocation,
  showStartupLocationMarker,
  clearStartupLocationMarker,
  flyToStartupLocation,
  startPickingStartupLocation,
  formatStartupLocationLabel,
  STARTUP_LOCATION_CHANGED_EVENT,
  type StartupLocation,
} from '@/utils/map/startupLocation'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  initViewer,
  perfViewer,
  showNavigator,
  unbindTileProxyUrlListener,
} from '@/utils/map/sceneViewer.ts'
import MeasureViewer from '@/core/gis/MeasureViewer'
import { useLoadPlane } from '@/hooks/useLoadPlane'
import { cacheCommonModelsToDisk } from '@/utils/model/modelCache'
import { clearAdministrativeBoundaries } from '@/utils/map/viewSettings'
import { clearGraticule, setGraticuleVisible } from '@/utils/map/graticule'
import { useViewSettingsStore } from '@/store/viewSettingsStore'
import { logger } from '@/utils/logger'

const viewerDivRef = ref<HTMLDivElement>()
let viewer: Viewer
let renderErrorListener: ((scene: any, error: any) => void) | null = null
let hasLoggedRenderError = false
let onlineReloadInFlight = false
let onlineReloadGeneration = 0
let onlineReloadTimer: ReturnType<typeof setTimeout> | undefined
let terrainLoadGeneration = 0
window.CESIUM_BASE_URL = import.meta.env.DEV ? '/Cesium/' : './Cesium/'
Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3YjU4MjJlMS0wMWE4LTRhOWQtYjQ1OC04MTgzMzFhMzQ5ZjAiLCJpZCI6MTE1ODUxLCJpYXQiOjE2NjkyMDM1MzN9.8ajEuv3VKYg8wvFiQlUWWY6Ng6JfY4PuVgRyStL1B-E'
const viewerReady = ref(false)
const viewSettingsStore = useViewSettingsStore()
const message = useMessage()

// 定位中状态，避免重复点击触发并发定位
const locating = ref(false)

/**
 * 点击“回到当前位置”：重新定位 → 地图上打点标记 → 飞行到该点。
 * 定位手段按 IP 定位 → 上次缓存 → 默认点 依次降级（已删除系统定位）。
 */
const locateAndShowMyLocation = async () => {
  if (!viewer || viewer.isDestroyed()) return
  if (locating.value) return

  locating.value = true
  try {
    const location = await resolveMyLocation()
    showMyLocationMarker(viewer, location)
    flyToMyLocation(viewer, location)

    const where =
      location.address || formatLonLat(location.longitude, location.latitude)
    if (location.source === 'fallback') {
      message.warning(
        `定位失败，已回到默认位置（${where}）。请检查网络连接。`,
      )
    } else {
      message.success(`${SOURCE_LABEL[location.source]}：${where}`)
    }
  } catch (error: any) {
    logger.error('定位失败:', error)
    message.error(`定位失败：${error?.message ?? error}`)
  } finally {
    locating.value = false
  }
}

// 启动定位点状态
const currentStartupLoc = ref<StartupLocation | null>(getStartupLocation())
const isPickingStartup = ref(false)
let stopPickingFn: (() => void) | null = null

// 右键管理菜单状态
const showStartupDropdown = ref(false)
const dropdownX = ref(0)
const dropdownY = ref(0)

const startupTooltipText = computed(() => {
  if (isPickingStartup.value) return '选点中…（按 ESC 取消）'
  if (currentStartupLoc.value) return '回到启动点位（右键管理）'
  return '设置启动点位'
})

const startupDropdownOptions = computed(() => {
  if (!currentStartupLoc.value) {
    return [{ label: '设置启动点位', key: 'pick' }]
  }
  return [
    { label: '飞往启动点', key: 'fly' },
    { label: '重新选点', key: 'repick' },
    { label: '清除启动点', key: 'clear' },
  ]
})

function openStartupMenu(clientX: number, clientY: number) {
  showStartupDropdown.value = false
  nextTick(() => {
    dropdownX.value = clientX
    dropdownY.value = clientY
    showStartupDropdown.value = true
  })
}

function handleStartupBtnClick(e: MouseEvent) {
  if (isPickingStartup.value) {
    cancelPickLocation()
    return
  }
  if (currentStartupLoc.value) {
    // 已设置启动点时，左键点击直接在按钮位置弹出菜单（包含飞往、重选、清除）
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openStartupMenu(rect.left - 10, rect.bottom + 4)
  } else {
    startPickLocation()
  }
}

function handleStartupContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (isPickingStartup.value) {
    cancelPickLocation()
    return
  }
  openStartupMenu(e.clientX, e.clientY)
}

function handleStartupDropdownSelect(key: string) {
  showStartupDropdown.value = false
  if (key === 'fly') {
    handleFlyToStartup()
  } else if (key === 'pick' || key === 'repick') {
    startPickLocation()
  } else if (key === 'clear') {
    handleClearStartupLocation()
  }
}

function startPickLocation() {
  if (!viewer || viewer.isDestroyed()) {
    message.warning('地图尚未初始化')
    return
  }
  if (isPickingStartup.value) {
    cancelPickLocation()
    return
  }

  isPickingStartup.value = true
  message.info('请在地图上单击选取启动点位，按 Esc 或右键取消')

  stopPickingFn = startPickingStartupLocation(viewer, {
    onPicked: (coord) => {
      isPickingStartup.value = false
      stopPickingFn = null
      const loc: StartupLocation = {
        longitude: coord.longitude,
        latitude: coord.latitude,
        height: coord.height,
        name: '启动基准点',
      }
      setStartupLocation(loc)
      currentStartupLoc.value = loc
      showStartupLocationMarker(viewer, loc)
      flyToStartupLocation(viewer, loc, 1.8)
      message.success('已保存启动定位点')
    },
    onCancel: () => {
      isPickingStartup.value = false
      stopPickingFn = null
      message.info('已取消选点')
    },
  })
}

function cancelPickLocation() {
  if (stopPickingFn) {
    stopPickingFn()
    stopPickingFn = null
  }
  isPickingStartup.value = false
}

function handleFlyToStartup() {
  if (!viewer || viewer.isDestroyed()) return
  if (currentStartupLoc.value) {
    flyToStartupLocation(viewer, currentStartupLoc.value, 1.8)
    message.info('正在飞往启动点位')
  } else {
    startPickLocation()
  }
}

function handleClearStartupLocation() {
  clearStartupLocation()
  currentStartupLoc.value = null
  if (viewer) {
    clearStartupLocationMarker(viewer)
  }
  message.success('已清除启动点位')
}

// 飞往完整地球范围，避免复用定位按钮的局部视角。
const flyToGlobalView = () => {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(30, -20, 180, 80),
    duration: 1.5,
  })
}
//延时
let modelWarmupTimer: ReturnType<typeof setTimeout> | undefined
// 组件加载就监听显示飞机实施的位置
const { init, clearAll } = useLoadPlane()

function waitForLocalFirstFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function loadOnlineTerrain(timeoutMs = 10000) {
  if (!viewer || viewer.isDestroyed() || !navigator.onLine) return

  const generation = ++terrainLoadGeneration
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const terrainPromise = createWorldTerrainAsync()
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(
        () => reject(new Error('在线地形请求超时')),
        timeoutMs,
      )
    })
    const terrainProvider = await Promise.race([terrainPromise, timeoutPromise])
    if (
      generation !== terrainLoadGeneration ||
      !viewer ||
      viewer.isDestroyed() ||
      !navigator.onLine
    ) {
      return
    }
    viewer.terrainProvider = terrainProvider
    viewer.scene.requestRender()
  } catch (error) {
    logger.warn('在线地形加载跳过或超时，降级为天地图地形晕渲:', error)
    fallbackToTiandituTerrain()
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }
}

/** 若在线三维 DEM 加载失败或超时，自动切换底图为“天地图地形”以显示地形地貌 */
function fallbackToTiandituTerrain() {
  if (!viewer || viewer.isDestroyed() || !viewer.baseLayerPicker) return
  const vm = viewer.baseLayerPicker.viewModel
  if (!vm || !vm.imageryProviderViewModels) return
  // 仅在当前使用的是天地图影像时自动降级切换
  if (vm.selectedImagery?.name === '天地图影像') {
    const terrainImagery = vm.imageryProviderViewModels.find(
      (item) => item.name === '天地图地形',
    )
    if (terrainImagery) {
      vm.selectedImagery = terrainImagery
      viewer.scene.requestRender()
      message.warning('在线三维高程服务连接超时，已自动切换为天地图地形晕渲底图')
    }
  }
}

/** 网络恢复后重建当前底图 Provider，并重新创建在线地形 Provider。 */
async function reloadOnlineResources() {
  if (!viewer || viewer.isDestroyed() || !navigator.onLine) return
  if (onlineReloadInFlight) return

  onlineReloadInFlight = true
  const generation = ++onlineReloadGeneration
  try {
    const baseLayerPicker = viewer.baseLayerPicker?.viewModel
    const selectedImagery = baseLayerPicker?.selectedImagery

    if (baseLayerPicker && selectedImagery) {
      // 先清空再恢复选择，强制 Cesium 丢弃断网时失效的影像 Provider。
      const mutablePicker = baseLayerPicker as unknown as {
        selectedImagery: typeof selectedImagery | undefined
      }
      mutablePicker.selectedImagery = undefined
      mutablePicker.selectedImagery = selectedImagery
      viewer.scene.requestRender()
    }

    // 网络刚恢复时资源服务可能尚未完全可用，给地形请求更宽松的超时时间。
    await loadOnlineTerrain(10000)
  } catch (error) {
    logger.warn('网络恢复后重载影像或地形失败:', error)
  } finally {
    if (generation === onlineReloadGeneration) onlineReloadInFlight = false
  }
}

function handleOnline() {
  // 合并短时间内连续触发的 online 事件，并给系统网络栈一点恢复时间。
  if (onlineReloadTimer) clearTimeout(onlineReloadTimer)
  onlineReloadTimer = setTimeout(() => {
    onlineReloadTimer = undefined
    void reloadOnlineResources()
  }, 300)
}

onMounted(async () => {
  try {
    //初始化
    viewer = await initViewer(viewerDivRef.value as HTMLElement)
    // 监听 Cesium WebGL 场景渲染致命异常（防熔断：仅记录首发致命错误，避免 60Hz 刷屏冲垮 20MB 轮转日志）
    renderErrorListener = (_scene: any, error: any) => {
      if (!hasLoggedRenderError) {
        hasLoggedRenderError = true
        logger.error('Cesium WebGL 场景渲染异常 (显卡驱动重置或上下文丢失):', error)
        message.error('三维地图渲染异常，显卡驱动可能重置或显存不足')
      }
    }
    viewer.scene.renderError.addEventListener(renderErrorListener)
    // 显示帧率
    viewer.scene.debugShowFramesPerSecond = true
    //监听飞机模型数据
    init(viewer)

    //显示子组件
    viewerReady.value = true

    // 性能优化
    perfViewer(viewer)

    // 1. 初始化时，瞬间将视角切换到中国全貌
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        104.195397, // 中国中心经度
        35.86166, // 中国中心纬度
        8000000, // 高度 800 万米，看清中国全景
      ),
    })

    // 显示罗盘和比例尺
    showNavigator(viewer)

    // 挂载在window，供全局组件共享
    window.viewer = viewer
    setGraticuleVisible(viewer, viewSettingsStore.showCoordinates)
    window.measureViewer = new MeasureViewer(viewer)
    window.addEventListener('online', handleOnline)

    // 先让本地底图完成首帧，再在后台请求在线资源，断网启动时也能尽快看到地球。
    await waitForLocalFirstFrame()

    // 标记点图层立即完成初始化
    const markerLayer = new CustomDataSource('Marker')
    viewer.dataSources.add(markerLayer)

    // 触发首帧重绘
    viewer.scene.requestRender()

    void loadOnlineTerrain()

    // 等地图完成首帧显示后，再后台检查模型缓存
    modelWarmupTimer = setTimeout(() => {
      if (!navigator.onLine) return

      void cacheCommonModelsToDisk().catch((error) => {
        logger.warn('常用模型磁盘缓存失败:', error)
      })
    }, 2000)

    // 2. 启动时后台解析“我的位置”做缓存预热，不自动飞行，
    //    避免 IP 城市级定位把视角拉到粗精度位置。
    void resolveMyLocation()
      .catch((error) => {
        logger.warn('启动时定位失败:', error)
      })

    const savedStartup = getStartupLocation()
    if (savedStartup) {
      currentStartupLoc.value = savedStartup
      showStartupLocationMarker(viewer, savedStartup)
      setTimeout(() => {
        if (!viewer || viewer.isDestroyed()) return
        flyToStartupLocation(viewer, savedStartup, 2.0)
      }, 500)
    }

    const canvas = viewer.scene.canvas
    canvas.addEventListener('contextmenu', handleCanvasContextMenu)

    markerScreenHandler = new ScreenSpaceEventHandler(canvas)
    // 左键点击地图图钉标记也直接弹出管理菜单
    markerScreenHandler.setInputAction((movement: { position: Cartesian2 }) => {
      if (isPickingStartup.value || !viewer || viewer.isDestroyed()) return
      const picked = viewer.scene.pick(movement.position)
      if (picked && picked.id && picked.id.id === 'startup-location-marker') {
        const canvasRect = viewer.scene.canvas.getBoundingClientRect()
        openStartupMenu(
          canvasRect.left + movement.position.x,
          canvasRect.top + movement.position.y,
        )
      }
    }, ScreenSpaceEventType.LEFT_CLICK)

    window.addEventListener(
      STARTUP_LOCATION_CHANGED_EVENT,
      handleStartupLocationEvent,
    )
  } catch (err: any) {
    logger.error('SceneViewer onMounted 异常:', err)
  }
})

let markerScreenHandler: ScreenSpaceEventHandler | undefined

function handleCanvasContextMenu(e: MouseEvent) {
  if (isPickingStartup.value) {
    e.preventDefault()
    return
  }
  if (!viewer || viewer.isDestroyed()) return
  const canvasRect = viewer.scene.canvas.getBoundingClientRect()
  const windowPosition = new Cartesian2(
    e.clientX - canvasRect.left,
    e.clientY - canvasRect.top,
  )
  const picked = viewer.scene.pick(windowPosition)
  if (picked && picked.id && picked.id.id === 'startup-location-marker') {
    e.preventDefault()
    openStartupMenu(e.clientX, e.clientY)
  }
}

function handleStartupLocationEvent(e: Event) {
  const customEvent = e as CustomEvent<StartupLocation | null>
  currentStartupLoc.value = customEvent.detail
}

onUnmounted(() => {
  cancelPickLocation()
  unbindTileProxyUrlListener()
  if (viewer && viewer.scene && renderErrorListener) {
    try {
      viewer.scene.renderError.removeEventListener(renderErrorListener)
    } catch {
      // 忽略场景已销毁异常
    }
    renderErrorListener = null
  }
  hasLoggedRenderError = false
  if (viewer && viewer.scene && viewer.scene.canvas) {
    viewer.scene.canvas.removeEventListener('contextmenu', handleCanvasContextMenu)
  }
  if (markerScreenHandler && !markerScreenHandler.isDestroyed()) {
    markerScreenHandler.destroy()
    markerScreenHandler = undefined
  }
  window.removeEventListener(
    STARTUP_LOCATION_CHANGED_EVENT,
    handleStartupLocationEvent,
  )
  window.removeEventListener('online', handleOnline)
  if (onlineReloadTimer) {
    clearTimeout(onlineReloadTimer)
    onlineReloadTimer = undefined
  }
  onlineReloadGeneration += 1
  terrainLoadGeneration += 1
  onlineReloadInFlight = false
  if (modelWarmupTimer) {
    clearTimeout(modelWarmupTimer)
  }
  clearAll(viewer) //清除监听
  if (viewer) {
    clearStartupLocationMarker(viewer)
    clearMyLocationMarker(viewer)
    clearAdministrativeBoundaries(viewer)
    clearGraticule(viewer)
    viewSettingsStore.showProvince = false
    viewSettingsStore.showCity = false
    viewSettingsStore.showCounty = false
    viewer.destroy()
    viewer = null
  }
})
</script>

<!--样式修改-->
<style scoped>
#cesium-viewer {
  width: 100%;
  height: 100%;
}

.location-btn {
  padding: 0;
  width: 2rem;
  height: 2rem;
  background: rgba(47, 53, 60, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 0.3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #ffffff;
  z-index: 10;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.map-view-actions {
  position: absolute;
  right: 1.8rem;
  top: calc(55vh + 5rem);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 10;
}

.location-btn:hover {
  background: rgba(204, 204, 204, 0.78);
  color: #ffffff;
}

.location-btn:active {
  background: rgba(100, 100, 100, 0.9);
}

.location-btn:disabled {
  cursor: progress;
  opacity: 0.85;
}

.spin-icon {
  animation: my-location-spin 1s linear infinite;
}

@keyframes my-location-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.location-btn.has-target {
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.75);
}

.location-btn.is-picking {
  color: #38bdf8;
  background: rgba(14, 165, 233, 0.28);
  border-color: #38bdf8;
}

@media screen and (max-width: 700px), screen and (max-height: 420px) {
  .map-view-actions {
    display: none;
  }
}
</style>
