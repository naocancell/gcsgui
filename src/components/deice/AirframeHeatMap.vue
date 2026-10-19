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
          alt="双尾蝎无人机透视图"
          draggable="false"
        />

        <svg
          class="airframe-overlay"
          :viewBox="`0 0 ${STAGE_W} ${STAGE_H}`"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            <filter
              id="airframe-heat-glow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <polygon
            v-for="band in bands"
            :key="band.key"
            :points="band.points"
            class="heat-band"
            :class="[`kind-${band.kind}`, `state-${bandState(band)}`]"
            :filter="
              bandState(band) === 'heating'
                ? 'url(#airframe-heat-glow)'
                : undefined
            "
          />
        </svg>

        <div
          v-for="seg in segments"
          :key="seg.key"
          class="seg-label"
          :class="`state-${stateOf(seg.key)}`"
          :style="labelStyle(LABEL_POS[seg.key])"
          :title="`${seg.name} · CH${String(seg.relayId).padStart(2, '0')} · 电压 ${fmtFixed(seg.voltage, 1)}V · 电流 ${fmtFixed(seg.current, 2)}A`"
        >
          <i class="seg-dot"></i>
          <span class="seg-name">{{ LABEL_TEXT[seg.key] }}</span>
          <span class="seg-temp dd-mono">
            {{ fmtFixed(seg.temp, 1) }}
            <template v-if="seg.temp !== null">°C</template>
          </span>
        </div>

        <div
          class="seg-label kind-const"
          :class="`state-${constState}`"
          :style="labelStyle(CONST_LABEL_POS)"
          :title="constTitle"
        >
          <i class="seg-dot"></i>
          <span class="seg-name">机翼常加热</span>
          <span class="seg-temp dd-mono">
            {{ fmtFixed(constTempAvg, 1) }}
            <template v-if="constTempAvg !== null">°C</template>
          </span>
        </div>
      </div>
    </div>

    <div class="airframe-foot">
      <div class="legend">
        <span class="legend-item">
          <i class="swatch kind-segment state-heating"></i>
          分段加热中（回路闭合）
        </span>
        <span class="legend-item">
          <i class="swatch kind-const state-heating"></i>
          常加热膜通电（CH08）
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
import airframeImg from '@/assets/deice/twin-tail-scorpion-perspective.webp'
import { usePayloadStore } from '@/store/payloadStore'
import { usePayloadRelayControl } from '@/composables/useDeiceDashboard'
import {
  buildHeatSegments,
  fmtFixed,
  type HeatSegmentKey,
} from '@/utils/deice/dashboardModel'

/**
 * 舞台坐标系 = 透视原图像素坐标（2319×1627）。
 * 机头朝左下，故画面右下方机翼为飞机左翼、左上方机翼为右翼；
 * 近处（画面右侧）垂尾为左垂尾。
 * 色带多边形取自原图示意色带（左翼）并按同一透视关系推算其余翼面。
 */
const STAGE_W = 2319
const STAGE_H = 1627

type BandKind = 'segment' | 'const'
type BandState = 'heating' | 'off' | 'nodata'

interface Band {
  key: string
  kind: BandKind
  /** 分段加热带对应的热区 key；常加热带为 null（统一由 CH08 控制） */
  segKey: HeatSegmentKey | null
  points: string
}

function pts(list: [number, number][]): string {
  return list.map(([x, y]) => `${x},${y}`).join(' ')
}

const bands: Band[] = [
  // 常加热膜（CH08，左右机翼前缘后方连续带）——先绘制，位于下层
  {
    key: 'leftConst',
    kind: 'const',
    segKey: null,
    points: pts([
      [1031, 1005],
      [2054, 1536],
      [2096, 1505],
      [1100, 978],
    ]),
  },
  {
    key: 'rightConst',
    kind: 'const',
    segKey: null,
    points: pts([
      [743, 836],
      [274, 499],
      [302, 485],
      [788, 814],
    ]),
  },
  // 左翼前缘三段（画面右下）
  {
    key: 'leftInner',
    kind: 'segment',
    segKey: 'leftInner',
    points: pts([
      [990, 1031],
      [1276, 1190],
      [1290, 1159],
      [1014, 1010],
    ]),
  },
  {
    key: 'leftMid',
    kind: 'segment',
    segKey: 'leftMid',
    points: pts([
      [1321, 1208],
      [1609, 1365],
      [1620, 1336],
      [1343, 1192],
    ]),
  },
  {
    key: 'leftOuter',
    kind: 'segment',
    segKey: 'leftOuter',
    points: pts([
      [1654, 1375],
      [1941, 1533],
      [1949, 1507],
      [1670, 1362],
    ]),
  },
  // 右翼前缘三段（画面左上）
  {
    key: 'rightInner',
    kind: 'segment',
    segKey: 'rightInner',
    points: pts([
      [717, 863],
      [577, 756],
      [600, 744],
      [745, 849],
    ]),
  },
  {
    key: 'rightMid',
    kind: 'segment',
    segKey: 'rightMid',
    points: pts([
      [568, 749],
      [427, 643],
      [447, 633],
      [592, 738],
    ]),
  },
  {
    key: 'rightOuter',
    kind: 'segment',
    segKey: 'rightOuter',
    points: pts([
      [418, 636],
      [277, 530],
      [294, 521],
      [439, 626],
    ]),
  },
  // H 形平尾前缘（左右两半）
  {
    key: 'rightHTail',
    kind: 'segment',
    segKey: 'rightHTail',
    points: pts([
      [1562, 505],
      [1762, 605],
      [1762, 591],
      [1562, 491],
    ]),
  },
  {
    key: 'leftHTail',
    kind: 'segment',
    segKey: 'leftHTail',
    points: pts([
      [1776, 612],
      [1972, 710],
      [1972, 696],
      [1776, 598],
    ]),
  },
  // 垂尾前缘
  {
    key: 'rightVTail',
    kind: 'segment',
    segKey: 'rightVTail',
    points: pts([
      [1649, 186],
      [1539, 462],
      [1552, 462],
      [1662, 186],
    ]),
  },
  {
    key: 'leftVTail',
    kind: 'segment',
    segKey: 'leftVTail',
    points: pts([
      [2053, 368],
      [1998, 600],
      [2011, 600],
      [2066, 368],
    ]),
  },
]

/** 温度标签中心点（舞台坐标），均落在翼面外侧的背景区域 */
const LABEL_POS: Record<HeatSegmentKey, { x: number; y: number }> = {
  leftInner: { x: 1060, y: 1236 },
  leftMid: { x: 1392, y: 1412 },
  leftOuter: { x: 1748, y: 1566 },
  rightInner: { x: 600, y: 884 },
  rightMid: { x: 446, y: 772 },
  rightOuter: { x: 292, y: 662 },
  rightVTail: { x: 1450, y: 300 },
  leftVTail: { x: 1900, y: 380 },
  rightHTail: { x: 1700, y: 660 },
  leftHTail: { x: 1900, y: 500 },
}

const CONST_LABEL_POS = { x: 1640, y: 1150 }

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
const hasRelay = computed(() => Boolean(relayStatus.value?.channels))
const constHeatOn = computed(() => isRelayClosed(8))

const heatingCount = computed(
  () => segments.value.filter((s) => isRelayClosed(s.relayId)).length,
)

const constState = computed<BandState>(() => {
  if (!hasRelay.value) return 'nodata'
  return constHeatOn.value ? 'heating' : 'off'
})

const constTemps = computed(() =>
  segments.value
    .filter((s) => s.constTemp !== null)
    .map((s) => ({ name: s.name, temp: s.constTemp as number })),
)

const constTempAvg = computed<number | null>(() => {
  const list = constTemps.value
  if (!list.length) return null
  return list.reduce((sum, t) => sum + t.temp, 0) / list.length
})

const constTitle = computed(() => {
  const detail = constTemps.value
    .map((t) => `${t.name} ${fmtFixed(t.temp, 1)}°C`)
    .join(' / ')
  return `机翼常加热膜 · CH08 · 平均温度 ${fmtFixed(constTempAvg.value, 1)}°C${detail ? ` · ${detail}` : ''}`
})

function stateOf(key: HeatSegmentKey): BandState {
  if (!hasRelay.value) return 'nodata'
  const seg = segments.value.find((s) => s.key === key)
  if (!seg) return 'nodata'
  return isRelayClosed(seg.relayId) ? 'heating' : 'off'
}

function bandState(band: Band): BandState {
  return band.segKey ? stateOf(band.segKey) : constState.value
}

function labelStyle(p: { x: number; y: number }) {
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
  /* 与透视底图边缘色一致（上 #0c1a40 → 下 #132450），羽化后无明显接缝 */
  background: linear-gradient(to bottom, #0c1a40, #132450);
  border: 1px solid var(--dd-tile-border);
  border-radius: 6px;
  overflow: hidden;
}

.airframe-stage {
  position: relative;
  width: 100%;
  width: min(100cqw, calc(100cqh * 2319 / 1627));
  aspect-ratio: 2319 / 1627;
}

.airframe-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
  pointer-events: none;

  /* 四周羽化，使原图深蓝背景自然过渡到卡片底色 */
  mask-image:
    linear-gradient(to right, transparent, #000 5%, #000 95%, transparent),
    linear-gradient(to bottom, transparent, #000 5%, #000 95%, transparent);
  mask-composite: intersect;
  -webkit-mask-composite: source-in;
}

.airframe-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.heat-band {
  stroke-width: 2;
  stroke-linejoin: round;
  transition:
    fill 0.25s ease,
    stroke 0.25s ease,
    opacity 0.25s ease;
}

.heat-band.kind-segment.state-heating {
  fill: var(--dd-green);
  stroke: rgb(187 247 208 / 70%);
  opacity: 0.9;
  animation: heat-pulse 2.4s ease-in-out infinite;
}

.heat-band.kind-const.state-heating {
  fill: #e11d1d;
  stroke: rgb(254 202 202 / 45%);
  opacity: 0.86;
  animation: heat-pulse 2.4s ease-in-out infinite;
}

.heat-band.state-off {
  fill: var(--dd-amber);
  stroke: rgb(253 230 138 / 45%);
  opacity: 0.62;
}

.heat-band.state-nodata {
  fill: rgb(148 163 184 / 32%);
  stroke: rgb(203 213 225 / 60%);
  stroke-dasharray: 8 6;
  opacity: 1;
}

@keyframes heat-pulse {
  0%,
  100% {
    opacity: 0.92;
  }

  50% {
    opacity: 0.68;
  }
}

@media (prefers-reduced-motion: reduce) {
  .heat-band {
    animation: none !important;
  }
}

.seg-label {
  position: absolute;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  white-space: nowrap;
  border-radius: 4px;
  border: 1px solid rgb(148 163 184 / 22%);
  background: rgb(7 12 26 / 72%);
  backdrop-filter: blur(2px);
  pointer-events: auto;
  cursor: default;
}

.seg-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dd-gray);
}

.seg-name {
  font-size: 11px;
  color: var(--dd-text-2);
}

.seg-temp {
  font-size: 12px;
  font-weight: 600;
  color: var(--dd-text-3);
}

.seg-label.state-heating {
  border-color: rgb(74 222 128 / 45%);
}

.seg-label.state-heating .seg-dot {
  background: var(--dd-green);
  box-shadow: 0 0 6px rgb(74 222 128 / 80%);
}

.seg-label.state-heating .seg-temp {
  color: var(--dd-green);
}

.seg-label.kind-const.state-heating {
  border-color: rgb(239 68 68 / 50%);
}

.seg-label.kind-const.state-heating .seg-dot {
  background: #ef4444;
  box-shadow: 0 0 6px rgb(239 68 68 / 80%);
}

.seg-label.kind-const.state-heating .seg-temp {
  color: #fca5a5;
}

.seg-label.state-off {
  border-color: rgb(245 165 36 / 40%);
}

.seg-label.state-off .seg-dot {
  background: var(--dd-amber);
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
  gap: 16px;
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

.swatch.kind-segment.state-heating {
  background: var(--dd-green);
}

.swatch.kind-const.state-heating {
  background: #e11d1d;
}

.swatch.state-off {
  background: var(--dd-amber);
}

.swatch.state-nodata {
  background: rgb(148 163 184 / 22%);
  border: 1px dashed rgb(148 163 184 / 55%);
}

.legend-note {
  margin-left: 8px;
  color: var(--dd-text-3);
}

.airframe-caption {
  text-align: center;
  font-size: 10.5px;
  color: var(--dd-text-3);
  letter-spacing: 0.3px;
}
</style>
