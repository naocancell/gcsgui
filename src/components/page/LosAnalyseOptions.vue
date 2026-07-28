<script setup lang="ts">
import { ref } from 'vue'
import { type FormInst, type FormRules, useMessage } from 'naive-ui'

let emit = defineEmits(['startLosAnalyse', 'cancelLosAnalyse'])
const message = useMessage()
const formRef = ref<FormInst | null>(null)
let losAnalyseParams = ref({
  viewPointLon: 110.093484,
  viewPointLat: 22.395758,
  viewPointAlt: 1800,
  routeInterval: 500,
  losInterval: 200,
  isCalculateRefractionCorrection: true,
})
//传递参数
const rules: FormRules = {
  viewPointLon: {
    type: 'number',
    required: true,
    min: -180,
    max: 180,
    message: '经度范围为 -180° 至 180°',
    trigger: ['input', 'blur'],
  },
  viewPointLat: {
    type: 'number',
    required: true,
    min: -90,
    max: 90,
    message: '纬度范围为 -90° 至 90°',
    trigger: ['input', 'blur'],
  },
  viewPointAlt: {
    type: 'number',
    required: true,
    min: 0.1,
    max: 10000,
    message: '视点高度范围为 0 至 100000 m',
    trigger: ['input', 'blur'],
  },
  routeInterval: {
    type: 'number',
    required: true,
    min: 100,
    max: 10000,
    message: '航线采样间距范围为 10 至 100000 m',
    trigger: ['input', 'blur'],
  },
  losInterval: {
    type: 'number',
    required: true,
    min: 10,
    max: 10000,
    message: '视线采样间距范围为 10 至 10000 m',
    trigger: ['input', 'blur'],
  },
}

const done = async () => {
  try {
    await formRef.value?.validate()
    emit('startLosAnalyse', { ...losAnalyseParams.value })
  } catch {
    message.warning('请检查通视分析参数')
  }
}
const cancel = () => {
  emit('cancelLosAnalyse')
}
</script>

<template>
  <n-modal :mask-closable="false" preset="dialog">
    <template #header>
      <div>航线通视分析参数设置</div>
    </template>
    <div>
      <n-space>
        <n-form
          ref="formRef"
          :model="losAnalyseParams"
          :rules="rules"
          label-placement="left"
          label-width="auto"
          require-mark-placement="right-hanging"
        >
          <!-- 视点经纬度高度设置 -->
          <n-form-item label="视点经度/°" path="viewPointLon">
            <n-input-number
              v-model:value="losAnalyseParams.viewPointLon"
              placeholder="110"
              :min="-180"
              :max="180"
              :step="0.000001"
              :precision="6"
            />
          </n-form-item>

          <n-form-item label="视点纬度/°" path="viewPointLat">
            <n-input-number
              v-model:value="losAnalyseParams.viewPointLat"
              placeholder="23"
              :min="-90"
              :max="90"
              :step="0.000001"
              :precision="6"
            />
          </n-form-item>

          <n-form-item label="视点高度/m" path="viewPointAlt">
            <n-input-number
              v-model:value="losAnalyseParams.viewPointAlt"
              placeholder="1800"
              :step="100"
              :min="0"
              :max="100000"
            />
          </n-form-item>

          <n-form-item label="航线采样间距/m" path="routeInterval">
            <n-input-number
              v-model:value="losAnalyseParams.routeInterval"
              placeholder="500"
              :step="100"
              :min="10"
              :max="100000"
            />
          </n-form-item>

          <n-form-item label="视线采样间距/m" path="losInterval">
            <n-input-number
              v-model:value="losAnalyseParams.losInterval"
              placeholder="200"
              :step="10"
              :min="10"
              :max="10000"
            />
          </n-form-item>
          <!-- 是否考虑大气折射开关 -->
          <!-- <n-form-item label="大气折射">
            <n-switch v-model:value="losAnalyseParams.isCalculateRefractionCorrection">
              <template #checked>是</template>
              <template #unchecked>否</template>
            </n-switch>
          </n-form-item> -->
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
