<template>
  <div class="battery-strip">
    <div v-for="b in batteries" :key="b.label" class="dd-card battery-card">
      <span class="battery-label">{{ b.label }}</span>
      <span class="battery-value dd-mono" :title="b.device">
        {{ fmtFixed(b.value, 1) }}
        <template v-if="b.value !== null">°C</template>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePayloadStore } from '@/store/payloadStore'
import { fmtFixed } from '@/utils/deice/dashboardModel'

const payloadStore = usePayloadStore()

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// 严格按照协议 6.2 节命名的 4 路电池温度采集
const batteries = computed(() => {
  const t1 = payloadStore.currentPayload?.tempSensor1
  const t2 = payloadStore.currentPayload?.tempSensor2
  return [
    {
      label: '电池1温度',
      device: '电池1温度采集 · 采集设备 1',
      value: num(t1?.batteryA),
    },
    {
      label: '电池2温度',
      device: '电池2温度采集 · 采集设备 1',
      value: num(t1?.batteryB),
    },
    {
      label: '电池3温度',
      device: '电池3温度采集 · 采集设备 2',
      value: num(t2?.batteryA),
    },
    {
      label: '电池4温度',
      device: '电池4温度采集 · 采集设备 2',
      value: num(t2?.batteryB),
    },
  ]
})
</script>

<style scoped>
.battery-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.battery-card {
  gap: 4px;
  padding: 10px 14px;
}

.battery-label {
  font-size: 11px;
  color: var(--dd-text-2);
  white-space: nowrap;
}

.battery-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--dd-text);
  white-space: nowrap;
}
</style>
