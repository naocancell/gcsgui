<template>
  <n-modal
    :show="show"
    :mask="false"
    :mask-closable="false"
    draggable
    preset="card"
    title="模拟飞机导引"
    style="width: min(440px, calc(100vw - 32px))"
    @update:show="handleShowUpdate"
  >
    <n-form label-placement="left" label-width="auto">
      <template v-if="mode === 'line'">
        <n-form-item label="直线起点">
          <n-space align="center">
            <n-button
              size="small"
              type="primary"
              @click="$emit('pick', 'start')"
            >
              {{ picking === 'start' ? '请点击地图' : '地图选点' }}
            </n-button>
            <span v-if="start">
              {{ start.lon.toFixed(5) }}, {{ start.lat.toFixed(5) }}
            </span>
            <span v-else>未选择</span>
          </n-space>
        </n-form-item>

        <n-form-item label="直线终点">
          <n-space align="center">
            <n-button
              size="small"
              type="primary"
              @click="$emit('pick', 'target')"
            >
              {{ picking === 'target' ? '请点击地图' : '地图选点' }}
            </n-button>
            <span v-if="target">
              {{ target.lon.toFixed(5) }}, {{ target.lat.toFixed(5) }}
            </span>
            <span v-else>未选择</span>
          </n-space>
        </n-form-item>
      </template>

      <template v-else>
        <n-form-item label="盘旋圆心">
          <n-space align="center">
            <n-button
              size="small"
              type="primary"
              @click="$emit('pick', 'center')"
            >
              {{ picking === 'center' ? '请点击地图' : '地图选点' }}
            </n-button>
            <span v-if="center">
              {{ center.lon.toFixed(5) }}, {{ center.lat.toFixed(5) }}
            </span>
            <span v-else>未选择</span>
          </n-space>
        </n-form-item>

        <n-form-item label="半径">
          <n-input-number
            :value="radius"
            :min="50"
            :max="100000"
            :step="50"
            @update:value="$emit('update:radius', $event ?? radius)"
          />
          <span class="guidance-unit">m</span>
        </n-form-item>

        <n-form-item label="盘旋圈数">
          <n-input-number
            :value="laps"
            :min="1"
            :max="20"
            :step="1"
            @update:value="$emit('update:laps', $event ?? laps)"
          />
          <span class="guidance-unit">圈</span>
        </n-form-item>
      </template>

      <n-form-item label="飞行高度（海拔）">
        <n-input-number
          :value="altitude"
          :min="0"
          :max="20000"
          :step="10"
          @update:value="$emit('update:altitude', $event ?? altitude)"
        />
        <span class="guidance-unit">m</span>
      </n-form-item>
    </n-form>

    <template #footer>
      <n-space justify="end">
        <n-button @click="$emit('cancel')">取消</n-button>
        <n-button type="primary" @click="$emit('apply')">开始导引</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import {
  NButton,
  NForm,
  NFormItem,
  NInputNumber,
  NModal,
  NSpace,
} from 'naive-ui'
import type {
  GuidanceMode,
  GuidancePointKind,
} from '@/composables/useSimulatedGuidance'

type GuidanceCoordinate = { lon: number; lat: number }

defineProps<{
  show: boolean
  mode: GuidanceMode | null
  start: GuidanceCoordinate | null
  target: GuidanceCoordinate | null
  center: GuidanceCoordinate | null
  altitude: number
  radius: number
  laps: number
  picking: GuidancePointKind | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'update:altitude', value: number): void
  (e: 'update:radius', value: number): void
  (e: 'update:laps', value: number): void
  (e: 'pick', kind: GuidancePointKind): void
  (e: 'apply'): void
  (e: 'cancel'): void
  (e: 'close'): void
}>()

function handleShowUpdate(value: boolean) {
  emit('update:show', value)
  if (!value) emit('close')
}
</script>

<style scoped>
.guidance-unit {
  margin-left: 6px;
  color: var(--n-text-color-2, #666);
}
</style>
