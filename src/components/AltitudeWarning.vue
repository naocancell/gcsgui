<!--
  高度预警面板组件
  实时显示 UAV 高度与设计航线高度的偏差，并根据偏差级别变色告警
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AltitudeWarningResult } from '@/utils/map/altitudeWarning'
import {
  WarningLevel,
  CAUTION_THRESHOLD,
  WARNING_THRESHOLD,
} from '@/utils/map/altitudeWarning'

const props = defineProps<{
  warningResult: AltitudeWarningResult | null
}>()

// 告警级别对应的颜色
const levelColors = {
  [WarningLevel.NORMAL]: '#18a058',
  [WarningLevel.CAUTION]: '#f0a020',
  [WarningLevel.WARNING]: '#d03050',
}

// 告警级别对应的中文文本
const levelText = {
  [WarningLevel.NORMAL]: '正常',
  [WarningLevel.CAUTION]: '注意',
  [WarningLevel.WARNING]: '告警',
}

const bgColor = computed(() => {
  if (!props.warningResult) return 'rgba(30, 30, 30, 0.85)'
  return levelColors[props.warningResult.level]
})

const isWarning = computed(() => {
  return props.warningResult?.level === WarningLevel.WARNING
})
</script>

<template>
  <div
    v-if="warningResult"
    class="altitude-warning-panel"
    :class="{ 'warning-flash': isWarning }"
    :style="{ '--panel-color': bgColor }"
  >
    <div class="warning-header">
      <span class="warning-icon">⚠</span>
      <span class="warning-title">高度预警</span>
      <span class="warning-badge" :style="{ backgroundColor: bgColor }">
        {{ levelText[warningResult.level] }}
      </span>
    </div>
    <div class="warning-body">
      <div class="warning-row">
        <span class="warning-label">当前高度</span>
        <span class="warning-value">
          {{ Math.round(warningResult.currentAlt) }} m
        </span>
      </div>
      <div class="warning-row">
        <span class="warning-label">设计高度</span>
        <span class="warning-value">
          {{ Math.round(warningResult.designAlt) }} m
        </span>
      </div>
      <div class="warning-row highlight">
        <span class="warning-label">高度偏差</span>
        <span class="warning-value deviation" :style="{ color: bgColor }">
          {{ warningResult.deviation > 0 ? '+' : ''
          }}{{ Math.round(warningResult.deviation) }} m
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.altitude-warning-panel {
  position: absolute;
  top: 60px;
  right: 10px;
  width: 200px;
  background: rgba(20, 20, 20, 0.9);
  border-radius: 8px;
  border-left: 3px solid var(--panel-color);
  padding: 10px 12px;
  color: #e0e0e0;
  font-size: 0.8rem;
  z-index: 10;
  backdrop-filter: blur(4px);
  transition: border-color 0.3s;
}

.warning-flash {
  animation: flash 1s ease-in-out infinite;
}

@keyframes flash {
  0%,
  100% {
    border-left-color: var(--panel-color);
    box-shadow: 0 0 5px rgba(208, 48, 80, 0.3);
  }
  50% {
    border-left-color: #ff4466;
    box-shadow: 0 0 15px rgba(208, 48, 80, 0.6);
  }
}

.warning-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.warning-icon {
  font-size: 1rem;
}

.warning-title {
  font-weight: 600;
  flex: 1;
}

.warning-badge {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  color: #fff;
  font-weight: 600;
}

.warning-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warning-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.warning-label {
  color: #999;
}

.warning-value {
  font-weight: 500;
  font-family: 'Consolas', monospace;
}

.warning-row.highlight {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.deviation {
  font-size: 1rem;
  font-weight: 700;
}
</style>
