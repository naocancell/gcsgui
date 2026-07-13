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
</template>

<script setup lang="ts">
import PlaneInfo from './PlaneInfo.vue'
import { onMounted, onUnmounted, ref } from 'vue'
import { Viewer, Ion, CustomDataSource } from 'cesium'
import * as Cesium from 'cesium'
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
// 组件加载就监听显示飞机实施的位置
  const {init,clearAll} = useLoadPlane();
onMounted(() => {
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

  viewer.camera.flyTo({
  // 西经, 南纬, 东经, 北纬，大致框住海南岛
    destination: Cesium.Cartesian3.fromDegrees(
            110.376662306,   // 经度
            19.6727238,    // 纬度
            5000     // 高度，米
        ),

    // Cesium.Rectangle.fromDegrees(110.376662306, 19.6727238, 111.1, 20.2),
    duration: 2,
});
  // 显示罗盘和比例尺
  showNavigator(viewer)

  // 挂载在window，供全局组件共享
  window.viewer = viewer
  window.measureViewer = new MeasureViewer(viewer)

  //添加天地图影像
  viewer.imageryLayers.addImageryProvider(
    getTDTProvider(TDTLayerType.Img, TDTProjectionType.WebMercator),
  )
  //添加天地图影像注记
  viewer.imageryLayers.addImageryProvider(
    getTDTProvider(TDTLayerType.Cia, TDTProjectionType.WebMercator),
  )

  // 检查设备联网状态，添加三维地形服务
  if (window.navigator.onLine) {
    // 如果断网环境执行该语句，航线绘制、三维伴飞等功能出现异常
    viewer.terrainProvider = getTDTTerrainProvider()
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
</style>
