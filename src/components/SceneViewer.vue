<!--
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-07 14:15:35
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-16 19:06:50
 * @Description:
-->
<template>
  <div id="cesium-viewer" ref="viewerDivRef"></div>
  <PlaneInfo v-if="viewerReady"/>
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
</template>

<script setup lang="ts">
import PlaneInfo from './PlaneInfo.vue'
import { onMounted, onUnmounted, ref } from 'vue'
import { Viewer, Ion, CustomDataSource,createWorldTerrainAsync } from 'cesium'
import * as Cesium from 'cesium'
import { NIcon, NTooltip } from 'naive-ui'
import { LocateOutline } from '@vicons/ionicons5'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  TDTLayerType,
  TDTProjectionType,
  getTDTProvider,
  getTDTTerrainProvider,
} from '@/utils/map/TDTProvider.ts'
import {
  initViewer,
  perfViewer,
  showNavigator,
} from '@/utils/map/sceneViewer.ts'
import { flyToDefault } from '@/utils/map/camera.ts'
import MeasureViewer from '@/assets/js/measureViewer.js'
import { useLoadPlane } from "@/hooks/useLoadPlane";
import { useMarkObstacle } from "@/hooks/useMarkObstacle";

const viewerDivRef = ref<HTMLDivElement>()
let viewer: Viewer
window.CESIUM_BASE_URL = import.meta.env.DEV ? 'public/Cesium/' : './Cesium/'
Ion.defaultAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3YjU4MjJlMS0wMWE4LTRhOWQtYjQ1OC04MTgzMzFhMzQ5ZjAiLCJpZCI6MTE1ODUxLCJpYXQiOjE2NjkyMDM1MzN9.8ajEuv3VKYg8wvFiQlUWWY6Ng6JfY4PuVgRyStL1B-E'
const viewerReady = ref(false)

// 存储软件启动时获取到的初始定位信息
const initialLocation = ref<{ longitude: number; latitude: number; height: number }>({
  longitude: 107.4191777,
  latitude: 37.855152,
  height: 5000,
})

// 飞往初始定位点
const flyToInitialLocation = () => {
  if (!viewer || !initialLocation.value) return
  const { longitude, latitude, height } = initialLocation.value
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
    duration: 1.5,
  })
}

// 组件加载就监听显示飞机实施的位置
  const {init,clearAll} = useLoadPlane();
onMounted(async () => {
  //初始化
  viewer = initViewer(viewerDivRef.value as HTMLElement)
  // 显示帧率
  viewer.scene.debugShowFramesPerSecond = true;
  //监听飞机模型数据
  init(viewer);

  //显示子组件
  viewerReady.value= true

  // 性能优化
  perfViewer(viewer)
  // 定位到中国
  // flyToDefault(viewer)

  // 1. 初始化时，瞬间将视角切换到中国全貌，彻底避免一开始在地球全景停顿卡顿。
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      104.195397, // 中国中心经度
      35.86166,   // 中国中心纬度
      8000000     // 高度 800 万米，看清中国全景
    )
  });

  // 2. 使用原生系统地理定位（不受代理影响，能拿到真实位置）
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lon = position.coords.longitude
        const lat = position.coords.latitude
        const alt = 1000
        initialLocation.value = { longitude: lon, latitude: lat, height: alt }

        // 获取成功后，从刚才的初始高空平滑飞往你的真实位置，高度降低以获得更大视角
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
          duration: 2,
        });
      },
      (error) => {
        console.warn('获取真实地理位置失败:', error.message);
        // 如果最终获取失败（比如没给权限），则平滑回退到默认大视角
        initialLocation.value = { longitude: 107.4191777, latitude: 37.855152, height: 5000 }
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(107.4191777, 37.855152, 5000),
          duration: 2,
        });
      },
      {
        enableHighAccuracy: true, // 开启高精度，调用系统底层定位
        timeout: 10000,           // 给足 10 秒时间等待系统定位服务“预热”响应
        maximumAge: 0 
      }
    );
  } else {
    initialLocation.value = { longitude: 107.4191777, latitude: 37.855152, height: 5000 }
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(107.4191777, 37.855152, 5000),
      duration: 2,
    });
  }
  // 显示罗盘和比例尺
  showNavigator(viewer)

  // 挂载在window，供全局组件共享
  window.viewer = viewer
  window.measureViewer = new MeasureViewer(viewer)

  //添加天地图影像
  // viewer.imageryLayers.addImageryProvider(
  //   getTDTProvider(TDTLayerType.Img, TDTProjectionType.WebMercator),
  // )
  const imageryProvider = await Cesium.createWorldImageryAsync()
  viewer.imageryLayers.addImageryProvider(imageryProvider)
  //添加天地图影像注记
  viewer.imageryLayers.addImageryProvider(
    getTDTProvider(TDTLayerType.Cia, TDTProjectionType.WebMercator),
  )

  // 检查设备联网状态，添加三维地形服务
  if (window.navigator.onLine) {
    // 如果断网环境执行该语句，航线绘制、三维伴飞等功能出现异常
    // viewer.terrainProvider = getTDTTerrainProvider()
    viewer.terrainProvider = await createWorldTerrainAsync()
  }

  // 标记点图层，存储所有地标点
  const markerLayer = new CustomDataSource('Marker')
  viewer.dataSources.add(markerLayer)

  //加载建筑物图标
  // const markObstacle = useMarkObstacle(viewer)
  // markObstacle.addAllObstacles()

})

onUnmounted(() => {
  clearAll(viewer);//清除监听
  if (viewer) {
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
  transition: background-color 0.2s, color 0.2s;
}

.location-btn:hover {
  background: rgba(204, 204, 204, 0.78);
  color: #ffffff;
}

.location-btn:active {
  background: rgba(100, 100, 100, 0.9);
}
</style>

