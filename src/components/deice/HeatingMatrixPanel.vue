<template>
  <section class="dd-card matrix-card">
    <div class="dd-card-head">
      <span class="dd-card-title">覆盖温度 · 压 · 流对照矩阵</span>
      <span class="dd-card-sub">
        {{ segments.length }} 段 · 左设备1 / 右设备2
      </span>
    </div>

    <table class="matrix-table">
      <thead>
        <tr>
          <th class="col-pos"></th>
          <th>温度 (°C)</th>
          <th>供电电压</th>
          <th>电流</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="seg in segments" :key="seg.key">
          <td class="col-pos">
            <span class="pos-name">{{ seg.name }}</span>
            <span class="pos-tag">{{ seg.tag }}</span>
          </td>
          <td>
            <span
              class="temp-pill dd-mono"
              :class="tempClass(seg.relayId, seg.temp)"
              :title="
                seg.constTemp !== null
                  ? `常加热膜温度 ${fmtFixed(seg.constTemp, 1)}°C`
                  : undefined
              "
            >
              {{ fmtFixed(seg.temp, 1) }}
            </span>
          </td>
          <td class="dd-mono">
            {{ fmtFixed(seg.voltage, 1) }}
            <span v-if="seg.voltage !== null" class="unit">V</span>
          </td>
          <td class="dd-mono">
            {{ fmtFixed(seg.current, 2) }}
            <span v-if="seg.current !== null" class="unit">A</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePayloadStore } from '@/store/payloadStore'
import { usePayloadRelayControl } from '@/composables/useDeiceDashboard'
import { buildHeatSegments, fmtFixed } from '@/utils/deice/dashboardModel'

const payloadStore = usePayloadStore()
const { isRelayClosed, relayStatus } = usePayloadRelayControl()

const segments = computed(() => buildHeatSegments(payloadStore.currentPayload))

function tempClass(relayId: number, temp: number | null) {
  if (temp === null) return 'is-empty'
  if (!relayStatus.value?.channels) return 'is-nodata'
  return isRelayClosed(relayId) ? 'is-heating' : 'is-off'
}
</script>

<style scoped>
.matrix-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.matrix-table th {
  font-size: 11px;
  font-weight: 500;
  color: var(--dd-text-3);
  text-align: center;
  padding: 0 4px 2px;
}

.matrix-table td {
  font-size: 11.5px;
  line-height: 15px;
  text-align: center;
  padding: 0 4px 1px;
  color: var(--dd-text);
  white-space: nowrap;
}

.matrix-table .col-pos {
  width: 34%;
  text-align: left;
}

.pos-name {
  color: var(--dd-text);
}

.pos-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 9.5px;
  line-height: 15px;
  border-radius: 3px;
  color: var(--dd-text-2);
  background: rgb(96 165 250 / 12%);
}

.unit {
  color: var(--dd-text-2);
  font-size: 0.9em;
}

.temp-pill {
  display: inline-block;
  min-width: 64px;
  padding: 0;
  line-height: 16px;
  border-radius: 3px;
  font-weight: 600;
}

.temp-pill.is-heating {
  color: var(--dd-green);
  background: rgb(22 101 52 / 35%);
}

.temp-pill.is-off {
  color: #7dd3fc;
  background: rgb(14 116 144 / 28%);
}

.temp-pill.is-nodata {
  color: var(--dd-text);
  background: rgb(148 163 184 / 10%);
}

.temp-pill.is-empty {
  color: var(--dd-text-3);
}
</style>
