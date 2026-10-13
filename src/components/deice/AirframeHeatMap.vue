<template>
  <section class="dd-card airframe-card">
    <div class="dd-card-head">
      <span class="dd-card-title">翼面防冰状态 · 温-压-流对照（双尾蝎）</span>
      <span class="dd-card-sub c-green">
        加热段 {{ heatingCount }}/{{ segments.length }} · 常加
        {{ hasRelay ? (constHeatOn ? '通电' : '断开') : '—' }}
      </span>
    </div>

    <div class="airframe-canvas">
      <div class="airframe-stage">
        <img
          class="airframe-img"
          :src="airframeImg"
          alt="双尾蝎无人机俯视图"
          draggable="false"
        />

        <svg
          class="airframe-overlay"
          :viewBox="`0 0 ${STAGE_W} ${STAGE_H}`"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <line
            v-for="s in strips"
            :key="s.key"
            :x1="s.x1"
            :y1="s.y1"
            :x2="s.x2"
            :y2="s.y2"
            class="heat-strip"
            :class="`state-${stateOf(s.key)}`"
          />
        </svg>

        <div
          v-for="seg in labeledSegments"
          :key="seg.key"
          class="seg-label"
          :class="`state-${stateOf(seg.key)}`"
          :style="labelStyle(seg.key)"
          :title="`${seg.name} · CH${String(seg.relayId).padStart(2, '0')} · 电压 ${fmtFixed(seg.voltage, 1)}V · 电流 ${fmtFixed(seg.current, 2)}A`"
        >
          <span class="seg-name">{{ LABEL_TEXT[seg.key] }}</span>
          <span class="seg-temp dd-mono">
            {{ fmtFixed(seg.temp, 1) }}
            <template v-if="seg.temp !== null">°C</template>
          </span>
        </div>
      </div>
    </div>

    <div class="airframe-foot">
      <div class="legend">
        <span class="legend-item">
          <i class="swatch state-heating"></i>
          加热中（回路闭合）
        </span>
        <span class="legend-item">
          <i class="swatch state-off"></i>
          未加热（回路断开）
        </span>
        <span class="legend-item">
          <i class="swatch state-nodata"></i>
          无回路状态
        </span>
        <span class="legend-note">数值 = 翼面加热膜采集温度</span>
      </div>
      <div class="airframe-caption">
        双尾蝎布局 · 上单翼 + 双尾撑 · H 形尾翼 · 16 路加热膜供电回路
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import airframeImg from '@/assets/deice/twin-tail-scorpion.webp'
import { usePayloadStore } from '@/store/payloadStore'
import { usePayloadRelayControl } from '@/composables/useDeiceDashboard'
import {
  buildHeatSegments,
  fmtFixed,
  type HeatSegmentKey,
} from '@/utils/deice/dashboardModel'

/**
 * 舞台坐标系：飞机俯视图原图 1479×827，底部额外预留尾翼标注区域。
 * 加热条坐标取自原图机翼前缘 / 尾撑轮廓的像素位置。
 */
const STAGE_W = 1479
const STAGE_H = 990

const strips: {
  key: HeatSegmentKey
  x1: number
  y1: number
  x2: number
  y2: number
}[] = [
  { key: 'leftOuter', x1: 60, y1: 360, x2: 328, y2: 338 },
  { key: 'leftMid', x1: 336, y1: 337, x2: 498, y2: 324 },
  { key: 'leftInner', x1: 506, y1: 323, x2: 666, y2: 311 },
  { key: 'rightInner', x1: 813, y1: 311, x2: 973, y2: 323 },
  { key: 'rightMid', x1: 981, y1: 324, x2: 1143, y2: 337 },
  { key: 'rightOuter', x1: 1151, y1: 338, x2: 1419, y2: 360 },
  { key: 'leftHTail', x1: 584, y1: 699, x2: 712, y2: 699 },
  { key: 'rightHTail', x1: 767, y1: 699, x2: 895, y2: 699 },
  { key: 'leftVTail', x1: 517, y1: 694, x2: 517, y2: 814 },
  { key: 'rightVTail', x1: 952, y1: 694, x2: 952, y2: 814 },
]

const LABEL_POS: Record<HeatSegmentKey, { x: number; y: number }> = {
  leftOuter: { x: 195, y: 250 },
  leftMid: { x: 417, y: 250 },
  leftInner: { x: 586, y: 250 },
  rightInner: { x: 893, y: 250 },
  rightMid: { x: 1062, y: 250 },
  rightOuter: { x: 1284, y: 250 },
  leftVTail: { x: 550, y: 872 },
  rightVTail: { x: 920, y: 872 },
  leftHTail: { x: 652, y: 948 },
  rightHTail: { x: 828, y: 948 },
}

const LABEL_TEXT: Record<HeatSegmentKey, string> = {
  leftOuter: '左翼外侧',
  leftMid: '左翼中间',
  leftInner: '左翼内侧',
  rightInner: '右翼内侧',
  rightMid: '右翼中间',
  rightOuter: '右翼外侧',
  leftHTail: '左平尾',
  rightHTail: '右平尾',
  leftVTail: '左垂尾',
  rightVTail: '右垂尾',
}

const payloadStore = usePayloadStore()
const { isRelayClosed, relayStatus } = usePayloadRelayControl()

const segments = computed(() => buildHeatSegments(payloadStore.currentPayload))
const labeledSegments = segments
const hasRelay = computed(() => Boolean(relayStatus.value?.channels))
const constHeatOn = computed(() => isRelayClosed(8))

const heatingCount = computed(
  () => segments.value.filter((s) => isRelayClosed(s.relayId)).length,
)

function stateOf(key: HeatSegmentKey): 'heating' | 'off' | 'nodata' {
  if (!hasRelay.value) return 'nodata'
  const seg = segments.value.find((s) => s.key === key)
  if (!seg) return 'nodata'
  return isRelayClosed(seg.relayId) ? 'heating' : 'off'
}

function labelStyle(key: HeatSegmentKey) {
  const p = LABEL_POS[key]
  return {
    left: `${(p.x / STAGE_W) * 100}%`,
    top: `${(p.y / STAGE_H) * 100}%`,
  }
}
</script>

<style scoped>
.airframe-card {
  flex: 1;
  min-height: 0;
}

.airframe-canvas {
  flex: 1;
  min-height: 0;
  container-type: size;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 50% 45%, rgb(56 189 248 / 6%), transparent 65%),
    linear-gradient(rgb(148 163 184 / 3%) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, rgb(148 163 184 / 3%) 1px, transparent 1px) 0 0 /
      40px 40px,
    var(--dd-tile);
  border: 1px solid var(--dd-tile-border);
  border-radius: 6px;
  overflow: hidden;
}

.airframe-stage {
  position: relative;
  width: 92%;
  width: min(92cqw, calc(92cqh * 1479 / 990));
  aspect-ratio: 1479 / 990;
}

.airframe-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: auto;
  user-select: none;
  pointer-events: none;
  filter: drop-shadow(0 18px 30px rgb(0 0 0 / 45%));
}

.airframe-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.heat-strip {
  stroke-width: 11;
  stroke-linecap: round;
  transition: stroke 0.2s ease;
}

.heat-strip.state-heating {
  stroke: var(--dd-green);
  filter: drop-shadow(0 0 6px rgb(74 222 128 / 55%));
}

.heat-strip.state-off {
  stroke: var(--dd-amber);
}

.heat-strip.state-nodata {
  stroke: var(--dd-gray);
}

.seg-label {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
  pointer-events: auto;
  cursor: default;
}

.seg-name {
  font-size: 11px;
  color: var(--dd-text-2);
}

.seg-temp {
  font-size: 13px;
  font-weight: 600;
  color: var(--dd-text-3);
}

.seg-label.state-heating .seg-temp {
  color: var(--dd-green);
}

.seg-label.state-off .seg-temp {
  color: #7dd3fc;
}

.airframe-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 11px;
  color: var(--dd-text-2);
  flex-wrap: wrap;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 14px;
  height: 6px;
  border-radius: 3px;
}

.swatch.state-heating {
  background: var(--dd-green);
}

.swatch.state-off {
  background: var(--dd-amber);
}

.swatch.state-nodata {
  background: var(--dd-gray);
}

.legend-note {
  margin-left: 12px;
  color: var(--dd-text-3);
}

.airframe-caption {
  text-align: center;
  font-size: 10.5px;
  color: var(--dd-text-3);
  letter-spacing: 0.3px;
}
</style>
