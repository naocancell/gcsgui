<template>
  <div class="route-tab-panel">
    <div class="route-profile-panel">
      <div class="profile-toolbar">
        <span class="toolbar-label">采样间隔</span>

        <n-input-number
          :value="interval"
          size="small"
          placeholder="默认1000米"
          style="width: 7.5rem"
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
      </div>

      <div v-show="hasSelectedRoute" id="echarts-profile" class="profile-chart-wrap"></div>
      <div v-show="!hasSelectedRoute" class="empty-wrap">
        <n-empty description="请先选择航线以查看地形剖面" style="margin-top: 3rem;" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  NInputNumber,
  NButton,
  NEmpty,
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
  display: flex;
  flex-direction: column;
}

.route-profile-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px;
}

.profile-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  flex-shrink: 0;
}

.toolbar-label {
  font-size: 13px;
  color: var(--n-text-color-2, #aaa);
}

.profile-chart-wrap {
  flex: 1;
  min-height: 220px;
  width: 100%;
  height: 100%;
}

.empty-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
</style>
