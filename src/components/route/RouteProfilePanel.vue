<template>
  <div class="route-tab-panel">
    <n-flex vertical class="route-profile-panel">
      <n-space justify="space-evenly" style="padding: 0 0.5rem">
        <n-ellipsis>采样间隔</n-ellipsis>

        <n-input-number
          :value="interval"
          size="small"
          placeholder="默认1000米"
          style="width: 8rem"
          :min="100"
          :step="100"
          @update:value="$emit('update:interval', $event)"
        />

        <n-button
          type="success"
          size="small"
          :disabled="!hasSelectedRoute"
          @click="$emit('redraw')"
        >
          重新绘图
        </n-button>
      </n-space>

      <div v-show="hasSelectedRoute" id="echarts-profile"></div>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import {
  NFlex,
  NSpace,
  NInputNumber,
  NButton,
  NEllipsis,
} from 'naive-ui'

defineProps<{
  interval: number | null
  hasSelectedRoute: boolean
}>()

defineEmits<{
  (e: 'update:interval', val: number | null): void
  (e: 'redraw'): void
}>()
</script>

<style scoped>
.route-tab-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.route-profile-panel {
  height: 100%;
  min-height: 0;
  margin: 0.5rem 0;
}

#echarts-profile {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
}
</style>
