<template>
  <div
    v-if="visible && results.length > 0"
    class="simulated-fence-panel"
  >
    <div class="simulated-fence-panel__header">
      <span>模拟电子围栏检测</span>
      <span class="simulated-fence-panel__radius">
        围栏 {{ fence?.radiusKm?.toFixed(1) ?? '--' }} km / 内
        {{ fence?.innerBufferKm?.toFixed(1) ?? '--' }} km / 外
        {{ fence?.outerBufferKm?.toFixed(1) ?? '--' }} km
      </span>
    </div>
    <div
      v-for="result in results"
      :key="result.id"
      class="simulated-fence-row"
      :class="`simulated-fence-row--${result.status}`"
    >
      <div class="simulated-fence-row__title">
        <strong>{{ result.label }}</strong>
        <span>{{ result.type }}</span>
      </div>
      <div class="simulated-fence-row__metrics">
        <span :class="`simulated-fence-status--${result.status}`">
          {{ result.statusLabel }}
        </span>
        <span>
          距离围栏边界 {{ formatFenceDistance(result.distanceMeters) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  ElectronicFenceResult,
  SimulatedElectronicFence,
} from '@/utils/map/simulatedElectronicFence'
import { formatFenceDistance } from '@/composables/useSimulatedFence'

defineProps<{
  visible: boolean
  results: ElectronicFenceResult[]
  fence: SimulatedElectronicFence | null
}>()
</script>

<style scoped>
.simulated-fence-panel {
  position: absolute;
  left: 12px;
  bottom: 46px;
  z-index: 9999;
  width: min(360px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 8px;
  background: rgb(21 21 21 / 94%);
  color: #fff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
  pointer-events: auto;
}

.simulated-fence-panel__header,
.simulated-fence-row__title,
.simulated-fence-row__metrics {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.simulated-fence-panel__header {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.simulated-fence-panel__radius,
.simulated-fence-row__title span,
.simulated-fence-row__metrics span:last-child {
  color: rgb(255 255 255 / 68%);
  font-size: 12px;
}

.simulated-fence-row {
  padding: 8px 9px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-left: 3px solid #42d392;
  border-radius: 5px;
  background: rgb(255 255 255 / 6%);
}

.simulated-fence-row + .simulated-fence-row {
  margin-top: 6px;
}

.simulated-fence-row--green {
  border-left-color: #67c23a;
  background: rgb(103 194 58 / 12%);
}

.simulated-fence-row--yellow {
  border-left-color: #f0c419;
  background: rgb(240 196 25 / 12%);
}

.simulated-fence-row--orange {
  border-left-color: #f39c12;
  background: rgb(243 156 18 / 12%);
}

.simulated-fence-row--red {
  border-left-color: #f56c6c;
  background: rgb(245 108 108 / 12%);
}

.simulated-fence-row__title {
  margin-bottom: 4px;
  font-size: 13px;
}

.simulated-fence-row__metrics {
  font-size: 12px;
}

.simulated-fence-status--green {
  color: #67c23a;
}

.simulated-fence-status--yellow {
  color: #f0c419;
  font-weight: 600;
}

.simulated-fence-status--orange {
  color: #f39c12;
  font-weight: 600;
}

.simulated-fence-status--red {
  color: #f56c6c;
  font-weight: 600;
}
</style>
