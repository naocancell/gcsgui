<template>
  <div v-if="active" class="terrain-warning-panel">
    <div class="terrain-warning-panel__header">
      <div>
        <div class="terrain-warning-panel__title">
          高度预警: {{ targetLabel }}
        </div>
      </div>

      <n-tag :type="isDanger ? 'error' : 'success'" size="small">
        {{ isDanger ? '预警' : '正常' }}
      </n-tag>
    </div>

    <div class="terrain-warning-panel__header">
      {{ statusText }}
    </div>

    <div class="terrain-warning-panel__metrics">
      <div>
        <span>飞机高度</span>
        <strong>{{ aircraftHeight }}</strong>
      </div>
      <div>
        <span>预警离地高度</span>
        <strong>{{ clearance }} m</strong>
      </div>
    </div>

    <div class="terrain-warning-panel__controls">
      <label>
        <span>预警长度</span>
        <n-input-number
          :value="distanceInput"
          :min="1000"
          :max="10000"
          :step="100"
          size="small"
          @update:value="$emit('updateDistance', $event)"
          @blur="$emit('restoreInputs')"
        >
          <template #suffix>m</template>
        </n-input-number>
      </label>
      <label>
        <span>预警离地高度</span>
        <n-input-number
          :value="clearanceInput"
          :min="100"
          :max="2000"
          :step="10"
          size="small"
          @update:value="$emit('updateClearance', $event)"
          @blur="$emit('restoreInputs')"
        >
          <template #suffix>m</template>
        </n-input-number>
      </label>
    </div>

    <svg
      class="terrain-profile-svg"
      :viewBox="`0 0 ${profileWidth} ${profileHeight}`"
    >
      <!-- 坐标轴 -->
      <line
        :x1="profilePadding"
        :y1="profileHeight - profilePadding"
        :x2="profileWidth - profilePadding"
        :y2="profileHeight - profilePadding"
        class="profile-axis"
      />
      <line
        :x1="profilePadding"
        :y1="profilePadding"
        :x2="profilePadding"
        :y2="profileHeight - profilePadding"
        class="profile-axis"
      />

      <!-- 地形线 -->
      <polyline
        v-if="terrainPolylinePoints"
        :points="terrainPolylinePoints"
        class="profile-terrain-line"
      />

      <!-- 飞机预计飞行轨迹线 -->
      <polyline
        v-if="flightPolylinePoints"
        :points="flightPolylinePoints"
        class="profile-flight-line"
      />

      <!-- 文本标注 -->
      <text :x="profilePadding" :y="profileHeight - 6" class="profile-label">
        0m
      </text>

      <text
        :x="profileWidth - profilePadding - 34"
        :y="profileHeight - 6"
        class="profile-label"
      >
        {{ distance }}m
      </text>

      <text :x="4" :y="profilePadding + 4" class="profile-label">
        {{ maxAltitudeLabel }}m
      </text>

      <text :x="4" :y="profileHeight - profilePadding" class="profile-label">
        {{ minAltitudeLabel }}m
      </text>
    </svg>

    <div class="terrain-warning-panel__legend">
      <span>
        <i class="legend-line legend-line--flight"></i>
        预计轨迹
      </span>

      <span>
        <i
          class="legend-line"
          :class="
            isDanger
              ? 'legend-line--terrain-danger'
              : 'legend-line--terrain-safe'
          "
        ></i>
        地形剖面
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NTag, NInputNumber } from 'naive-ui'
import {
  profileWidth,
  profileHeight,
  profilePadding,
} from '@/composables/useTerrainWarningProfile'

defineProps<{
  active: boolean
  targetLabel: string
  isDanger: boolean
  statusText: string
  aircraftHeight: string
  distance: number
  clearance: number
  distanceInput: number | null
  clearanceInput: number | null
  terrainPolylinePoints: string
  flightPolylinePoints: string
  minAltitudeLabel: string
  maxAltitudeLabel: string
}>()

defineEmits<{
  (e: 'updateDistance', val: number | null): void
  (e: 'updateClearance', val: number | null): void
  (e: 'restoreInputs'): void
}>()
</script>

<style scoped>
.terrain-warning-panel {
  position: absolute;
  top: 60px;
  left: 12px;
  z-index: 9999;
  width: 380px;
  padding: 12px;
  border-radius: 8px;
  background: rgb(21 21 21 / 94%);
  color: #fff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
}

.terrain-warning-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.terrain-warning-panel__title {
  font-size: 16px;
  font-weight: bold;
}

.terrain-warning-panel__metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.terrain-warning-panel__metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 6px;
  background: rgb(255 255 255 / 6%);
}

.terrain-warning-panel__metrics span,
.terrain-warning-panel__controls label > span {
  font-size: 12px;
  color: rgb(255 255 255 / 65%);
}

.terrain-warning-panel__metrics strong {
  font-size: 14px;
  color: #fff;
}

.terrain-warning-panel__controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.terrain-warning-panel__controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.terrain-profile-svg {
  width: 100%;
  height: 180px;
  border-radius: 6px;
  background: rgb(255 255 255 / 8%);
}

.profile-axis {
  stroke: rgb(255 255 255 / 45%);
  stroke-width: 1;
}

.profile-terrain-line {
  fill: none;
  stroke: #67c23a;
  stroke-width: 2.5;
}

.terrain-warning-panel:has(.n-tag--error) .profile-terrain-line {
  stroke: #f56c6c;
}

.profile-flight-line {
  fill: none;
  stroke: #00d5ff;
  stroke-width: 2.5;
  stroke-dasharray: 6 4;
}

.profile-label {
  fill: rgb(255 255 255 / 70%);
  font-size: 10px;
}

.terrain-warning-panel__legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: rgb(255 255 255 / 78%);
}

.terrain-warning-panel__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-line {
  display: inline-block;
  width: 22px;
  height: 0;
  border-top: 3px solid;
}

.legend-line--flight {
  border-color: #00d5ff;
  border-style: dashed;
}

.legend-line--terrain-safe {
  border-color: #67c23a;
}

.legend-line--terrain-danger {
  border-color: #f56c6c;
}
</style>
