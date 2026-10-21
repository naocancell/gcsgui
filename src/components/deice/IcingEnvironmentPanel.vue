<template>
  <section class="dd-card">
    <div class="dd-card-head">
      <span class="dd-card-title" title="0xC4-07 温湿度气压传感器">
        结冰气压环境
      </span>
    </div>
    <div class="env-grid">
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
      <div class="dd-tile" title="气压传感器原始读数（kPa 换算为 hPa）">
        <span class="dd-tile-label">气压高度</span>
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
</script>

<style scoped>
.env-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
</style>
