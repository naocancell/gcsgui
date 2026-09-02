<template>
  <div class="route-tab-panel">
    <div class="route-weather-panel">
      <div v-if="hasSelectedRoute" class="weather-content-wrap">
        <div class="routePtSelector">
          <n-button
            size="small"
            @click="$emit('prevPt')"
            :disabled="routePtNumber <= 1"
          >
            <template #icon><ArrowBackOutline /></template>
          </n-button>

          <span class="pt-label">航点 {{ routePtNumber }} / {{ totalPoints }}</span>

          <n-button
            size="small"
            @click="$emit('nextPt')"
            :disabled="totalPoints <= routePtNumber"
          >
            <template #icon><ArrowForwardOutline /></template>
          </n-button>
        </div>

        <div class="weather-meta-row">
          <span class="time-label">{{ nowTime }}</span>

          <n-select
            style="width: 9rem"
            size="small"
            :options="levelOptions"
            :value="selectedLevel"
            @update:value="$emit('levelChanged', $event)"
            placeholder="选择高度层"
          />
        </div>

        <n-scrollbar
          x-scrollable
          id="weatherChart"
          class="route-weather-chart"
        />
      </div>

      <div v-else class="empty-wrap">
        <n-empty description="请先选择航线以查看气象信息" style="margin-top: 3rem;" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  NButton,
  NSelect,
  NScrollbar,
  NEmpty,
} from 'naive-ui'
import { ArrowBackOutline, ArrowForwardOutline } from '@vicons/ionicons5'

defineProps<{
  hasSelectedRoute: boolean
  routePtNumber: number
  totalPoints: number
  nowTime: string
  levelOptions: any[]
  selectedLevel: number | null
}>()

defineEmits<{
  (e: 'prevPt'): void
  (e: 'nextPt'): void
  (e: 'levelChanged', val: string | number): void
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

.route-weather-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px;
}

.weather-content-wrap {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.routePtSelector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-weight: bold;
  color: #63e2b7;
  flex-shrink: 0;
}

.pt-label {
  font-size: 13px;
}

.weather-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 8px;
  flex-shrink: 0;
}

.time-label {
  font-size: 12px;
  color: var(--n-text-color-2, #aaa);
}

.route-weather-chart {
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
