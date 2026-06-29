<script setup lang="ts">
import { FormItemRule, useMessage } from 'naive-ui'
import { ref } from 'vue'
import { ByDirectionAndLen } from '@/utils/map/geocomputation.ts'

let showDialog = ref(false)
let message = useMessage()
let DatumPt = ref({
  lon: undefined,
  lat: undefined,
})
const markers = ref([
  {
    direction: undefined,
    distance: undefined,
    alt: undefined,
  },
])
let rule = {
  lon: {
    trigger: ['input', 'blur'],
    required: true,
    validator() {
      if (DatumPt.value.lon == undefined) return new Error('不可为空')

      let v = Number(DatumPt.value.lon)
      if (!v) return new Error('请输入数字')
      if (v > 180 || v < -180) return new Error('范围有误')
      return true
    },
  },
  lat: {
    trigger: ['input', 'blur'],
    required: true,
    validator() {
      if (DatumPt.value.lat == undefined) return new Error('不可为空')

      let v = Number(DatumPt.value.lat)
      if (!v) return new Error('请输入数字')
      if (v > 90 || v < -90) return new Error('范围有误')
      return true
    },
  },
}

function checkItems() {
  if (markers.value.length <= 0) {
    return false
  }
  markers.value.forEach((item) => {
    if (
      Number(item.direction) > 360 ||
      Number(item.direction) < 0 ||
      Number(item.distance) < 0
    ) {
      message.error('数据输入有误，请检查')
      return false
    }
  })
  return true
}
function done() {
  if (rule.lat.validator() === true && rule.lon.validator() === true) {
    if (checkItems()) {
      message.info('数据校验通过！')
      window.measureViewer.addEntitiesByDirectionAndLen(
        DatumPt.value,
        markers.value,
      )
      console.log(markers.value)
      showDialog.value = false
    }
  } else {
    message.error('数据校验不通过！')
  }
}
function cancel() {}
function onCreate() {
  return {
    direction: undefined,
    distance: undefined,
  }
}

defineExpose({
  openDlg: () => {
    showDialog.value = true
  },
})
</script>

<template>
  <n-modal
    v-model:show="showDialog"
    style="width: 30rem"
    preset="card"
    draggable
    title="相对点障碍物"
    :mask-closable="false"
  >
    <template v-slot:default>
      <n-flex>
        <n-row style="justify-content: center; margin-bottom: 0.2rem">
          <n-ellipsis :tooltip="false">基准点经纬度</n-ellipsis>
          <n-form-item :rule="rule.lon" size="small" style="display: block">
            <n-input
              class="lonlat"
              v-model:value="DatumPt.lon"
              placeholder="经度"
            />
          </n-form-item>
          <n-form-item :rule="rule.lat" size="small" style="display: block">
            <n-input
              class="lonlat"
              v-model:value="DatumPt.lat"
              placeholder="纬度"
            />
          </n-form-item>
        </n-row>

        <n-dynamic-input v-model:value="markers" :on-create="onCreate">
          <template #default="{ value }">
            <n-input
              class="item-left"
              v-model:value="value.direction"
              placeholder="方位/正北为0，顺时针"
            />
            <n-input
              class="item-right"
              v-model:value="value.distance"
              placeholder="距离/米"
            />
            <n-input
              class="item-right"
              v-model:value="value.alt"
              placeholder="高度/米"
            />
          </template>
        </n-dynamic-input>
        <n-row justify-content="center" style="margin-top: 0.5rem">
          <n-button
            type="primary"
            style="margin-right: 0.9rem"
            size="medium"
            @click="done"
          >
            确定
          </n-button>
          <n-button type="warning" size="medium" @click="cancel">取消</n-button>
        </n-row>
      </n-flex>
    </template>
  </n-modal>
</template>

<style scoped>
.lonlat {
  width: 10rem;
  margin-left: 0.5rem;
}

.item-right {
  width: 12rem;
  margin-left: 0.3rem;
}

.item-left {
  margin-left: 0.3rem;
}
</style>
