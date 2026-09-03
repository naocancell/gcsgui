<template>
  <div class="route-tab-panel">
    <n-flex vertical class="route-weather-panel">
      <n-space justify="space-around" class="routePtSelector">
        <n-button
          size="small"
          @click="$emit('prevPt')"
          :disabled="routePtNumber <= 1 || !hasSelectedRoute"
        >
          <template #icon><ArrowBackOutline /></template>
        </n-button>

        <n-ellipsis>航点 {{ routePtNumber }}</n-ellipsis>

        <n-button
          size="small"
          @click="$emit('nextPt')"
          :disabled="!hasSelectedRoute || totalPoints <= routePtNumber"
        >
          <template #icon><ArrowForwardOutline /></template>
        </n-button>
      </n-space>

      <n-space justify="center">
        <n-ellipsis>{{ nowTime }}</n-ellipsis>

        <n-select
          style="width: 10rem"
          size="small"
          :options="levelOptions"
          :value="selectedLevel"
          @update:value="$emit('levelChanged', $event)"
          placeholder="选择高度层"
          :disabled="!hasSelectedRoute"
        />
      </n-space>

      <n-scrollbar
        x-scrollable
        id="weatherChart"
        class="route-weather-chart"
      />
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import {
  NFlex,
  NSpace,
  NButton,
  NSelect,
  NScrollbar,
  NEllipsis,
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
}

.route-weather-panel {
  height: 100%;
  min-height: 0;
}

.routePtSelector {
  width: 100%;
  font-weight: bold;
  color: #63e2b7;
}

.route-weather-chart {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.routePtSelector:hover {
  background: rgb(24 24 28);
}
</style>
