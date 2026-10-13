<template>
  <div class="trend-chart">
    <svg
      v-if="hasSeries"
      class="trend-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      aria-label="目标功率与实际输出功率趋势"
    >
      <polyline
        v-if="targetPoints"
        class="line-target"
        :points="targetPoints"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        v-if="currentPoints"
        class="line-current"
        :points="currentPoints"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <span
      v-if="lastDot"
      class="trend-dot"
      :style="{ left: `${lastDot.x}%`, top: `${lastDot.y}%` }"
    ></span>
    <div v-if="!hasSeries" class="trend-empty">等待防除冰功率遥测…</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PowerSample } from '@/composables/useDeiceDashboard'
import { buildSparklinePoints } from '@/utils/deice/dashboardModel'

const props = defineProps<{ samples: PowerSample[] }>()

const W = 300
const H = 80
const PAD = 8

const range = computed(() => {
  const vals: number[] = []
  for (const s of props.samples) {
    if (s.target !== null) vals.push(s.target)
    if (s.current !== null) vals.push(s.current)
  }
  if (vals.length === 0) return null
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  const span = Math.max(max - min, Math.abs(max) * 0.05, 1)
  min -= span * 0.6
  max += span * 0.6
  return { min, max }
})

const hasSeries = computed(() => range.value !== null)

const targetPoints = computed(() =>
  range.value
    ? buildSparklinePoints(
        props.samples.map((s) => s.target),
        W,
        H,
        range.value.min,
        range.value.max,
        PAD,
      )
    : '',
)

const currentPoints = computed(() =>
  range.value
    ? buildSparklinePoints(
        props.samples.map((s) => s.current),
        W,
        H,
        range.value.min,
        range.value.max,
        PAD,
      )
    : '',
)

const lastDot = computed(() => {
  const r = range.value
  const n = props.samples.length
  if (!r || n === 0) return null
  const last = props.samples[n - 1].current
  if (last === null) return null
  const ratio = (last - r.min) / (r.max - r.min)
  const yPx = H - PAD - ratio * (H - PAD * 2)
  return { x: n > 1 ? 100 : 0, y: (yPx / H) * 100 }
})
</script>

<style scoped>
.trend-chart {
  position: relative;
  height: 100%;
  min-height: 64px;
  background: var(--dd-tile);
  border: 1px solid var(--dd-tile-border);
  border-radius: 6px;
  overflow: hidden;
}

.trend-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.line-target {
  fill: none;
  stroke: var(--dd-amber);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0.7;
}

.line-current {
  fill: none;
  stroke: var(--dd-green);
  stroke-width: 2;
  stroke-linejoin: round;
}

.trend-dot {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: var(--dd-green);
  box-shadow: 0 0 0 3px rgb(74 222 128 / 20%);
  transform: translateX(-3px);
}

.trend-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--dd-text-3);
}
</style>
