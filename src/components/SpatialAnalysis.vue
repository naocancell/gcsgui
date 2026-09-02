<!--
  文件描述：地形剖面图组件
  创建时间：2024/4/23 9:55
  创建人：Zhaipeixiu
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  drawEchartsProfileAnalyse,
  drawEchartsVisibility,
  disposeProfileEChart,
  elevationProfile,
  profileAnalyse,
  visibilityAnalyse2,
} from '@/utils/map/SpatialAnalysis.ts'
import { useStaticStore } from '@/store/staticStore'
import { useMessage } from 'naive-ui'
import { Cartesian3 } from 'cesium'
let showResultModal = ref(false)
let store = useStaticStore()
let message = useMessage()
let showParamsDialog = ref(false)
let ifInputCoords = ref(false)
//TODO: 表单未校验
let formParams = ref({
  interval: 100,
  startClearance: 40, //起点离地高度
  endClearance: 10, //起点离地高度
  curve: true,
})
let isVisible = ref(false)
// 关闭地形分析结果窗口的回调
const handleCloseProfile = () => {
  // 释放 ECharts 图表资源，避免内存泄漏
  disposeProfileEChart()
  //移除图形元素
  window.measureViewer?.clearProfileEntities?.()
  //地形点数组归零
  store.analysisVars.profilePts = []
  store.analysisVars.analysisType = -1
}

onBeforeUnmount(() => {
  disposeProfileEChart()
})

// 执行地形分析
function executeTopographicAnalyse(polyline: Cartesian3[]) {
  // 剖面分析
  if (store.analysisVars.analysisType === 1) {
    // 计算地形剖面
    let res = profileAnalyse(window.viewer, polyline, formParams.value.interval)
    // 弹出图表窗口
    showResultModal.value = true
    nextTick(() => {
      drawEchartsProfileAnalyse(res.distanceArray, res.elevationArray)
    })
  }
  // 通视分析
  else if (store.analysisVars.analysisType === 2) {
    console.log(store.analysisVars.analysisType)
    // 计算地形剖面
    let res = profileAnalyse(window.viewer, polyline, formParams.value.interval)
    // 计算视线起始点距离和高度
    let eyeRes = elevationProfile(window.viewer, polyline[0], polyline[1], -1)

    // 弹出图表窗口
    showResultModal.value = true
    nextTick(() => {
      drawEchartsVisibility(
        res.distanceArray,
        res.elevationArray,
        eyeRes.elevationArray[0] + Number(formParams.value.startClearance),
        eyeRes.elevationArray[1] + Number(formParams.value.endClearance),
      )

      isVisible.value = visibilityAnalyse2(
        res,
        true,
        Number(formParams.value.startClearance),
        Number(formParams.value.endClearance),
      )
    })
  }
}
watch(
  () => store.analysisVars.profilePts,
  (newValue, OldValue): void => {
    console.log('数据变化了', newValue)
    if (newValue.length == 1) {
      message.error('请至少选择两个点')
      return
    }
    if (newValue.length < 1) return
    executeTopographicAnalyse(newValue)
  },
)

function inputCoords() {
  ifInputCoords.value = !ifInputCoords.value
}
function pickPoints() {
  window.measureViewer.profileAnalyse()
  showParamsDialog.value = false
}
defineExpose({
  openParamsDialog: () => {
    showParamsDialog.value = true
  },
})

const pickedCoords = ref([
  {
    lon: null,
    lat: null,
  },
])
const onCreate = () => {
  return { lon: null, lat: null }
}

//输入坐标结束之后，进行地形分析
const afterCoordInput = () => {
  console.log(pickedCoords.value)
  //关闭参数窗口
  showParamsDialog.value = false

  let polyline: Cartesian3[] = []
  pickedCoords.value.forEach((coord) => {
    let lon1, lat1
    lon1 = Number(coord.lon)
    lat1 = Number(coord.lat)
    let Certain3 = Cartesian3.fromDegrees(lon1, lat1)
    polyline.push(Certain3)
  })
  // 执行地形分析
  executeTopographicAnalyse(polyline)
}
</script>

<template>
  <n-modal
    v-model:show="showResultModal"
    style="width: 50rem; height: 38rem"
    preset="card"
    draggable
    :mask-closable="false"
    :on-after-leave="handleCloseProfile"
    :title="
      store.analysisVars.analysisType == 2 ? '通视分析结果' : '剖面分析结果'
    "
  >
    <template v-slot:default>
      <n-row
        justify-content="center"
        :class="isVisible ? 'ResGreen' : 'ResRed'"
        v-show="store.analysisVars.analysisType == 2"
      >
        <span style="font-size: larger; font-weight: bolder">
          {{ isVisible ? '通视' : '不通视' }}
        </span>
      </n-row>
      <div id="profileEChart"></div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="showParamsDialog"
    style="width: 20rem"
    preset="card"
    draggable
    :title="
      store.analysisVars.analysisType == 2
        ? '通视分析参数设置'
        : '剖面分析参数设置'
    "
    :mask-closable="false"
  >
    <template v-slot:default>
      <n-space>
        <n-form
          ref="formRef"
          :model="formParams"
          label-placement="left"
          label-width="auto"
          require-mark-placement="right-hanging"
        >
          <n-form-item label="采样间隔" path="numberParam">
            <n-input round v-model:value="formParams.interval">
              <template #suffix>米</template>
            </n-input>
          </n-form-item>
          <n-form-item
            label="起点离地高度"
            path="numberParam"
            v-show="store.analysisVars.analysisType == 2"
          >
            <n-input round v-model:value="formParams.startClearance">
              <template #suffix>米</template>
            </n-input>
          </n-form-item>
          <n-form-item
            label="终点离地高度"
            path="numberParam"
            v-show="store.analysisVars.analysisType == 2"
          >
            <n-input round v-model:value="formParams.endClearance">
              <template #suffix>米</template>
            </n-input>
          </n-form-item>
          <n-form-item
            label="考虑地球曲率"
            path="numberParam"
            v-show="store.analysisVars.analysisType == 2"
          >
            <n-switch round v-model:value="formParams.curve"></n-switch>
          </n-form-item>
        </n-form>
      </n-space>
      <n-row justify-content="space-around">
        <n-tooltip placement="bottom" trigger="hover">
          <template #trigger>
            <n-button type="info" size="small" @click="pickPoints">
              地图选取
            </n-button>
          </template>
          <span>左键单击选点，右键结束</span>
        </n-tooltip>
        <n-button
          :type="ifInputCoords ? 'warning' : 'info'"
          size="small"
          @click="inputCoords"
        >
          {{ ifInputCoords ? '取消输入' : '输入坐标' }}
        </n-button>
        <!-- <n-button type="info" size="small">导入文件</n-button> -->
      </n-row>
      <n-divider v-show="ifInputCoords" />
      <n-dynamic-input
        v-model:value="pickedCoords"
        :on-create="onCreate"
        v-show="ifInputCoords"
        :min="2"
        :max="store.analysisVars.analysisType == 2 ? 2 : 10"
      >
        <template #default="{ value }">
          <n-input size="tiny" v-model:value="value.lon" placeholder="经度" />
          <n-input size="tiny" v-model:value="value.lat" placeholder="纬度" />
        </template>
      </n-dynamic-input>
      <n-row justify-content="space-around" style="margin-top: 0.5rem">
        <n-button
          type="primary"
          size="small"
          v-show="ifInputCoords"
          @click="afterCoordInput"
          :disabled="pickedCoords.length < 2"
        >
          确定
        </n-button>
      </n-row>
    </template>
  </n-modal>
</template>

<style scoped>
#profileEChart {
  position: relative;
  width: 47rem;
  height: 37rem;
  margin-top: -2rem;
}

.ResGreen {
  color: #26c926;
}

.ResRed {
  color: #f00;
}
</style>
