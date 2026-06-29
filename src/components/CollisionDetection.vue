<script setup lang="ts">
import {
  drawEcharts_CollisionDetection,
  drawEcharts_CollisionDetection2,
  profileAnalyse,
} from '@/utils/map/SpatialAnalysis.ts'
import { Cartesian3 } from 'cesium'
import { defineEmits, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { EChartsType } from 'echarts'
import { useLayerStore } from '@/store/layerManagerStore.ts'
let l_store = useLayerStore()
let myChart: EChartsType | undefined = undefined
let myChart1: EChartsType | undefined = undefined
let uavDisArr: number[] = []
let uavHeightArr: number[] = []
let terrainArr: number[] = []
defineEmits(['shutdown'])

function onResize() {
  myChart?.resize()
  myChart1?.resize()
}

onMounted(() => {
  myChart = echarts.init(document.getElementById('detection-chart'))
  myChart1 = echarts.init(document.getElementById('terrain-chart'))
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  myChart?.dispose()
  myChart1?.dispose()
  myChart = undefined
  myChart1 = undefined
})
const props = defineProps(['groundHeight'])
/**
 * 绘制地形碰撞检测折线图，差值间隔为1km
 * @param height 飞机高度，作为检测线
 * @param currentPos 当前飞机经纬度，作为原点
 * @param nextPos 下一航点经纬度，作为目标点
 * @param max_dis 预先探测距离 m
 */
const drawTerrain = (
  height: number,
  currentPos: Cartesian3,
  nextPos: Cartesian3,
  max_dis: number,
) => {
  // 计算地形剖面，默认采样间隔为1km
  let res = profileAnalyse(window.viewer, [currentPos, nextPos], 1000)
  // 弹出图表窗口
  drawEcharts_CollisionDetection(
    myChart1,
    res.distanceArray,
    res.elevationArray,
    height,
    max_dis,
  )
}

/**
 * 绘制地形碰撞检测折线图
 * @param uavH 飞机高度
 * @param uavDis 飞机当前位置与上一位置的距离 米
 * @param terrainH 飞机当前地面投影点的地形高度
 */
const drawDetection = (uavH: number, uavDis: number, terrainH: number) => {
  if (uavDisArr.length == 0) {
    uavDisArr.push(Math.round(uavDis))
  } else {
    uavDisArr.push(Math.round(uavDis + uavDisArr[uavDisArr.length - 1]))
  }

  uavHeightArr.push(Math.round(uavH))
  terrainArr.push(Math.round(terrainH))

  // 更新ECharts图表
  drawEcharts_CollisionDetection2(myChart, uavDisArr, terrainArr, uavHeightArr)
}

defineExpose({
  drawDetection,
  drawTerrain,
})
</script>

<template>
  <div class="chart" id="detection-chart"></div>
  <div class="chart" id="terrain-chart"></div>
</template>

<style scoped>
.chart {
  width: 33rem;
  height: 25vh;
  margin: 0;
}
</style>
