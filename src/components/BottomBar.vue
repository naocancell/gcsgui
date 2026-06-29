<!--
  文件描述：地图底部信息条
  创建时间：2024/3/29 8:53
  创建人：Zhaipeixiu
-->
<script setup lang="ts">
import { Angle } from '@/utils/map/angle.ts'
import {
  ScreenSpaceEventHandler,
  Math,
  ScreenSpaceEventType,
  Cartographic,
} from 'cesium'
import { onMounted, ref } from 'vue'
import { cartesian2ToCartesian3 } from '@/utils/map/coordinate.ts'
let nowLatStr: string, nowLonStr: string
let lonlatStr = ref('')
let isDecimal = ref(true)

onMounted(() => {
  bindMouseEvent()
})

function bindMouseEvent() {
  let _viewer = window.viewer
  let canvas = _viewer.scene.canvas
  const handler = new ScreenSpaceEventHandler(canvas)
  handler.setInputAction((e: any) => {
    //捕获椭球体，将笛卡尔二维平面坐标转为椭球体的笛卡尔三维坐标，返回球体表面的点
    let position = cartesian2ToCartesian3(_viewer, e.endPosition)
    if (position) {
      //将笛卡尔三维坐标转为地图坐标（弧度）
      let cartographic =
        _viewer.scene.globe.ellipsoid.cartesianToCartographic(position)
      try {
        // 将地图坐标（弧度）转为十进制的度数
        nowLatStr = Math.toDegrees(cartographic.latitude).toFixed(7) // 纬度
        nowLonStr = Math.toDegrees(cartographic.longitude).toFixed(7) // 经度
        let camera_alt = _viewer.camera.positionCartographic.height / 1000 // 视高
        // 相机低于250、俯仰角小于-80度时才计算海拔高度（否则误差大）
        let needElevation: boolean =
          camera_alt < 250 && _viewer.camera.pitch < -(Math.PI / 180) * 80
        let elevStr = needElevation
          ? (Cartographic.fromCartesian(position)?.height?.toFixed(2) ?? '') +
            'm'
          : '高度过高'

        if (isDecimal.value) {
          //如果是十进制度
          lonlatStr.value = `经度: ${nowLonStr}°, 纬度: ${nowLatStr}°, 高度: ${elevStr}`
        } else {
          lonlatStr.value = `经度: ${Angle.DecimalDegree2DMS(nowLonStr)}, 纬度: ${Angle.DecimalDegree2DMS(nowLatStr)},
          高度: ${elevStr}`
        }
      } catch (e) {}
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
}
function lonlatClick() {
  bindMouseEvent()
  let elevStr = lonlatStr.value.split('高度')[1]
  if (isDecimal.value) {
    lonlatStr.value =
      `经度: ${Angle.DecimalDegree2DMS(nowLonStr)}, 纬度: ${Angle.DecimalDegree2DMS(nowLatStr)}, 高度` +
      elevStr
  } else {
    lonlatStr.value = `经度: ${nowLonStr}°, 纬度: ${nowLatStr}°, 高度` + elevStr
  }
  isDecimal.value = !isDecimal.value
}
</script>

<template>
  <div id="map-footer">
    <button id="lonlatText" @click="lonlatClick">
      {{ lonlatStr }}
    </button>
  </div>
</template>

<style scoped>
#map-footer {
  position: absolute;
  bottom: 1px;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 1.7rem;
  padding: 0;
  font-size: 0.7rem;
  color: #fff;
  text-align: center;
  background-color: rgb(47 53 60 / 80%);
}

#lonlatText {
  font-size: 0.8rem;
  color: #fff;
  background: none;
  border: none;
}

#lonlatText:hover {
  cursor: pointer;
}
</style>
