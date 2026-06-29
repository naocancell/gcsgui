<!--
 * @Author: zhaipx
 * @Date: 2024-04-01 13:36:35
 * @Description: 航线选项窗口
-->
<script setup lang="ts">
import { defineEmits, ref } from 'vue'

let emit = defineEmits(['routeDraw', 'cancelDraw'])
let routeParams = ref({
  name: '',
  code: 1,
  isClose: false,
  height: 100,
  routePts: [],
})
let routeCode = [
  {
    label: '任务航线1',
    value: 1,
  },
  {
    label: '任务航线2',
    value: 2,
  },
  {
    label: '任务航线3',
    value: 3,
  },
  {
    label: '任务航线4',
    value: 4,
  },
  {
    label: '任务航线5',
    value: 5,
  },
]
const done = () => {
  emit('routeDraw', routeParams.value)
}
const cancel = () => {
  emit('cancelDraw')
}
</script>

<template>
  <n-modal :mask-closable="false" preset="dialog">
    <template #header>
      <div>航线参数设定</div>
    </template>
    <div>
      <n-space>
        <n-form
          ref="formRef"
          :model="routeParams"
          label-placement="left"
          label-width="auto"
          require-mark-placement="right-hanging"
        >
          <n-form-item label="是否闭合">
            <n-switch v-model:value="routeParams.isClose">
              <template #checked>是</template>
              <template #unchecked>否</template>
            </n-switch>
          </n-form-item>
          <n-form-item label="航线名称">
            <n-input
              v-model:value="routeParams.name"
              placeholder="输入名称"
            ></n-input>
          </n-form-item>
          <n-form-item label="航线类型">
            <n-select v-model:value="routeParams.code" :options="routeCode" />
          </n-form-item>
          <n-form-item label="航线高度/m">
            <n-input-number
              v-model:value="routeParams.height"
              placeholder="500"
              :step="100"
            />
          </n-form-item>
        </n-form>
      </n-space>
      <n-space justify="center">
        <n-button @click="done" type="primary" size="small">确定</n-button>
        <n-button @click="cancel" type="warning" size="small">取消</n-button>
      </n-space>
    </div>
  </n-modal>
</template>

<style scoped></style>
