<template>
  <section class="dd-card">
    <div class="dd-card-head">
      <span class="dd-card-title">结冰探测与温湿露气压环境</span>
      <span class="dd-card-sub">0xC5 · 0xC4-07</span>
    </div>
    <div class="env-grid">
      <div class="dd-tile">
        <span class="dd-tile-label">结冰探头</span>
        <span class="dd-tile-value icing-text" :class="icingClass">
          {{ icingText }}
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">大气温度</span>
        <span class="dd-tile-value c-cyan">
          {{ fmtFixed(env?.temperature, 1) }}
          <template v-if="env">°C</template>
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">相对湿度</span>
        <span class="dd-tile-value c-cyan">
          {{ fmtFixed(env?.humidity, 0) }}
          <template v-if="env">%RH</template>
        </span>
      </div>
      <div class="dd-tile" title="由大气温度与相对湿度按 Magnus 公式推算">
        <span class="dd-tile-label">露点温度</span>
        <span class="dd-tile-value c-cyan">
          {{ fmtFixed(dew, 1) }}
          <template v-if="dew !== null">°C</template>
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">大气压</span>
        <span class="dd-tile-value c-amber">
          {{ pressureHpa }}
          <template v-if="pressureHpa !== '—'">hPa</template>
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePayloadStore } from '@/store/payloadStore'
import { dewPoint, fmtFixed } from '@/utils/deice/dashboardModel'

const payloadStore = usePayloadStore()
const env = computed(
  () => payloadStore.currentPayload?.environmentSensor ?? null,
)
const dew = computed(() =>
  dewPoint(env.value?.temperature, env.value?.humidity),
)

const pressureHpa = computed(() => {
  const p = env.value?.pressure
  return typeof p === 'number' && Number.isFinite(p) ? (p * 10).toFixed(0) : '—'
})

const SHORT_ICING_TEXT: Record<string, string> = {
  NoIce: '无结冰',
  AlertCalculating: '结冰告警',
  Light: '弱结冰',
  Moderate: '中度结冰',
  Severe: '强结冰',
  Extreme: '极强结冰',
}

const icingText = computed(() => {
  const ice = payloadStore.currentPayload?.icingSensor
  if (!ice) return '—'
  if (ice.detectorFault) return '探测器故障'
  return SHORT_ICING_TEXT[ice.icingSeverity] ?? '未知'
})

const icingClass = computed(() => {
  const level = payloadStore.icingDesc.level
  if (level === 'normal') return 'c-green'
  if (level === 'warning') return 'c-amber'
  if (level === 'danger') return 'c-red'
  return 'c-muted'
})
</script>

<style scoped>
.env-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.icing-text {
  font-family: var(--dd-sans);
}
</style>
