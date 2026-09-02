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
  <!-- 地图右侧定位按钮（在放大缩小按钮正上方） -->
  <n-tooltip placement="left" trigger="hover">
    <template #trigger>
      <div class="location-btn" @click="flyToInitialLocation">
        <n-icon size="18">
          <LocateOutline />
        </n-icon>
      </div>
    </template>
    回到当前位置
  </n-tooltip>
  <!-- 地图右侧重置视角按钮 -->
  <n-tooltip placement="left" trigger="hover">
    <template #trigger>
      <div class="location-btn global-view-btn" @click="flyToGlobalView">
        <n-icon size="18">
          <GlobeOutline />
        </n-icon>
      </div>
    </template>
    全球视角
  </n-tooltip>
</template>

<script setup lang="ts">
import PlaneInfo from './PlaneInfo.vue'
import { onMounted, onUnmounted, ref } from 'vue'
import {
  Viewer,
  Ion,
  CustomDataSource,
  createWorldTerrainAsync,
  Cartesian3,
  Rectangle,
} from 'cesium'
import { NIcon, NTooltip } from 'naive-ui'
import { LocateOutline, GlobeOutline } from '@vicons/ionicons5'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  initViewer,
  perfViewer,
  showNavigator,
} from '@/utils/map/sceneViewer.ts'
import MeasureViewer from '@/core/gis/MeasureViewer'
import { useLoadPlane } from '@/hooks/useLoadPlane'
import { cacheCommonModelsToDisk } from '@/utils/model/modelCache'
import { clearAdministrativeBoundaries } from '@/utils/map/viewSettings'
import { clearGraticule, setGraticuleVisible } from '@/utils/map/graticule'
import { useViewSettingsStore } from '@/store/viewSettingsStore'

const viewerDivRef = ref<HTMLDivElement>()
let viewer: Viewer
window.CESIUM_BASE_URL = import.meta.env.DEV ? '/Cesium/' : './Cesium/'
Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3YjU4MjJlMS0wMWE4LTRhOWQtYjQ1OC04MTgzMzFhMzQ5ZjAiLCJpZCI6MTE1ODUxLCJpYXQiOjE2NjkyMDM1MzN9.8ajEuv3VKYg8wvFiQlUWWY6Ng6JfY4PuVgRyStL1B-E'
const viewerReady = ref(false)
const viewSettingsStore = useViewSettingsStore()

// 存储软件启动时获取到的初始定位信息
const initialLocation = ref<{
  longitude: number
  latitude: number
  height: number
}>({
  longitude: 107.4191777,
  latitude: 37.855152,
  height: 5000,
})

// 飞往初始定位点
const flyToInitialLocation = () => {
  if (!viewer || !initialLocation.value) return
  const { longitude, latitude, height } = initialLocation.value
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(longitude, latitude, height),
    duration: 1.5,
  })
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

async function loadOnlineTerrain() {
  if (!viewer || viewer.isDestroyed() || !navigator.onLine) return

  try {
    const terrainPromise = createWorldTerrainAsync()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('在线地形请求超时')), 2000),
    )
    const terrainProvider = await Promise.race([terrainPromise, timeoutPromise])
    if (viewer.isDestroyed()) return
    viewer.terrainProvider = terrainProvider
    viewer.scene.requestRender()
  } catch (error) {
    console.warn('在线地形加载跳过，使用默认椭球:', error)
  }
}

onMounted(async () => {
  try {
    //初始化
    viewer = await initViewer(viewerDivRef.value as HTMLElement)
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
        console.warn('常用模型磁盘缓存失败:', error)
      })
    }, 2000)

    // 2. 原生系统地理定位（带 1.5s 快速超时，避免长期阻塞卡顿）
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!viewer || viewer.isDestroyed()) return
          const lon = position.coords.longitude
          const lat = position.coords.latitude
          const alt = 1000
          initialLocation.value = { longitude: lon, latitude: lat, height: alt }
          viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(lon, lat, alt),
            duration: 2,
          })
        },
        () => {
          // 定位失败或超时保持中国全景或默认中心
          initialLocation.value = {
            longitude: 107.4191777,
            latitude: 37.855152,
            height: 5000,
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 1500,
          maximumAge: 60000,
        },
      )
    }
  } catch (err: any) {
    console.error('SceneViewer onMounted 异常:', err)
  }
})

onUnmounted(() => {
  if (modelWarmupTimer) {
    clearTimeout(modelWarmupTimer)
  }
  clearAll(viewer) //清除监听
  if (viewer) {
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
  position: absolute;
  right: 1.8rem;
  top: calc(55vh - 2.5rem);
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

.location-btn:hover {
  background: rgba(204, 204, 204, 0.78);
  color: #ffffff;
}

.location-btn:active {
  background: rgba(100, 100, 100, 0.9);
}

.global-view-btn {
  top: calc(55vh - 5rem);
}
</style>
