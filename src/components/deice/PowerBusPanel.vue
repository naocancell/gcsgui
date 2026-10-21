<template>
  <section class="dd-card power-bus-card">
    <div class="dd-card-head">
      <span class="dd-card-title" title="0xC4 · 6.1 / 6.5 / 6.3">
        电源与系统总线遥测
      </span>
    </div>

    <!-- 6.1 升压模块 -->
    <div class="dd-section-label" title="ID: 01">6.1 升压模块</div>
    <div class="dd-grid-2">
      <div class="dd-tile">
        <span class="dd-tile-label">输入电压</span>
        <span class="dd-tile-value c-cyan">
          {{ fmtFixed(boost?.inputVoltage, 1) }}
          <span class="dd-unit">V</span>
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">输入电流</span>
        <span class="dd-tile-value c-green">
          {{ fmtFixed(boost?.inputCurrent, 1) }}
          <span class="dd-unit">A</span>
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">输出电压</span>
        <span class="dd-tile-value c-cyan">
          {{ fmtFixed(boost?.outputVoltage, 1) }}
          <span class="dd-unit">V</span>
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">输出电流</span>
        <span class="dd-tile-value c-green">
          {{ fmtFixed(boost?.outputCurrent, 1) }}
          <span class="dd-unit">A</span>
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">温度</span>
        <span class="dd-tile-value c-amber">
          {{ fmtFixed(boost?.temperature, 1) }}
          <span class="dd-unit">°C</span>
        </span>
      </div>
      <div class="dd-tile" title="6.3 电压采集模块 · 电池输入电压">
        <span class="dd-tile-label">电池输入电压</span>
        <span class="dd-tile-value c-green">
          {{ fmtFixed(batteryInput, 1) }}
          <span class="dd-unit">V</span>
        </span>
      </div>
      <div class="dd-tile dd-span-2" title="6.5 温湿度气压传感器">
        <span class="dd-tile-label">大气压</span>
        <span class="dd-tile-value">
          {{ pressureHpa }}
          <span class="dd-unit">hPa</span>
        </span>
      </div>
    </div>

    <!-- 6.5 温湿度气压传感器 & 结冰环境 -->
    <div class="dd-section-label">6.5 温湿度气压传感器 &amp; 结冰环境</div>
    <div class="dd-grid-2">
      <div class="dd-tile">
        <span class="dd-tile-label">结冰探测状态</span>
        <span class="dd-tile-value status-text" :class="detectorClass">
          {{ detectorText }}
        </span>
      </div>
      <div class="dd-tile">
        <span class="dd-tile-label">加热状态</span>
        <span class="dd-tile-value status-text" :class="heatingClass">
          {{ heatingText }}
        </span>
      </div>
    </div>

    <!-- 6.3 电压采集模块 -->
    <div class="dd-section-label" title="ID: 04 · 电源与特种载荷供电电压">
      6.3 电压采集模块
    </div>
    <div class="volt-list">
      <div v-for="ch in voltageRows" :key="ch.key" class="volt-row">
        <span class="volt-name" :title="ch.name">{{ ch.name }}</span>
        <span class="volt-track">
          <span
            class="volt-bar"
            :class="`tier-${ch.tier}`"
            :style="{ width: `${ch.percent}%` }"
          ></span>
        </span>
        <span class="volt-val dd-mono">
          {{ ch.text }}
          <template v-if="ch.text !== '—'">V</template>
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePayloadStore } from '@/store/payloadStore'
import {
  SYSTEM_VOLTAGE_CHANNELS,
  fmtFixed,
  voltageBarPercent,
  voltageTier,
} from '@/utils/deice/dashboardModel'

const payloadStore = usePayloadStore()
const boost = computed(() => payloadStore.currentPayload?.boostModule ?? null)
const env = computed(
  () => payloadStore.currentPayload?.environmentSensor ?? null,
)
const icing = computed(() => payloadStore.currentPayload?.icingSensor ?? null)

// 协议原始单位为 kPa，大屏按航空习惯显示 hPa
const pressureHpa = computed(() => {
  const p = env.value?.pressure
  return typeof p === 'number' && Number.isFinite(p) ? (p * 10).toFixed(0) : '—'
})

const detectorText = computed(() => {
  if (!icing.value) return '—'
  return icing.value.detectorFault ? '故障' : '正常'
})
const detectorClass = computed(() => {
  if (!icing.value) return 'c-muted'
  return icing.value.detectorFault ? 'c-red' : 'c-green'
})

const heatingText = computed(() => {
  if (!icing.value) return '—'
  return icing.value.heatingActive ? '加热中' : '未加热'
})
const heatingClass = computed(() => {
  if (!icing.value) return 'c-muted'
  return icing.value.heatingActive ? 'c-green' : 'c-amber'
})

const batteryInput = computed(() => {
  const v = payloadStore.currentPayload?.voltageSensor?.batteryInput
  return typeof v === 'number' && Number.isFinite(v) ? v : null
})

// 电池输入电压已在 6.1 区域单独展示，电压条列表不再重复
const voltageRows = computed(() => {
  const vs = payloadStore.currentPayload?.voltageSensor
  return SYSTEM_VOLTAGE_CHANNELS.filter((ch) => ch.key !== 'batteryInput').map(
    (ch) => {
      const raw = vs?.[ch.key]
      const val = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
      return {
        ...ch,
        text: fmtFixed(val, 1),
        percent: voltageBarPercent(val),
        tier: voltageTier(val),
      }
    },
  )
})
</script>

<style scoped>
.power-bus-card {
  gap: 5px;
}

.status-text {
  font-family: var(--dd-sans);
  font-size: 13px;
}

.volt-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 3px;
  padding-top: 1px;
}

.volt-row {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 2fr) 52px;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}

.volt-name {
  color: var(--dd-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.volt-track {
  height: 6px;
  border-radius: 3px;
  background: rgb(148 163 184 / 5%);
  overflow: hidden;
}

.volt-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.volt-bar.tier-high {
  background: #22d3ee;
}

.volt-bar.tier-mid {
  background: var(--dd-green);
}

.volt-bar.tier-low {
  background: var(--dd-amber);
}

.volt-val {
  text-align: right;
  color: var(--dd-text);
}
</style>
