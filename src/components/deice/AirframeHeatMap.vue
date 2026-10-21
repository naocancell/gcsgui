<template>
  <section class="dd-card airframe-card">
    <div class="dd-card-head">
      <span class="dd-card-title">翼面防冰状态 · 温-压-流对照（双尾蝎）</span>
      <span class="dd-card-sub c-green">
        加热条 {{ heatingStripCount }}/{{ stripRows.length }} · 遥测
        {{ telemetryRate !== null ? `${telemetryRate.toFixed(0)}Hz` : '—' }}
      </span>
    </div>

    <!-- 结冰 / 大气环境速览 -->
    <div class="env-strip">
      <div class="env-tile icing-tile" :class="icingClass">
        <span class="env-label">
          结冰探头
          <span v-if="manualJudge" class="judge-tag">人工判定</span>
        </span>
        <span class="env-value icing-value">
          <i class="icing-dot"></i>
          {{ icingText }}
        </span>
      </div>
      <div class="env-tile">
        <span class="env-label">大气温度</span>
        <span class="env-value dd-mono c-cyan">
          {{ fmtFixed(env?.temperature, 1) }}
          <span v-if="env" class="env-unit">°C</span>
        </span>
      </div>
      <div class="env-tile">
        <span class="env-label">相对湿度</span>
        <span class="env-value dd-mono c-green">
          {{ fmtFixed(env?.humidity, 0) }}
          <span v-if="env" class="env-unit">%RH</span>
        </span>
      </div>
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
          >
            <title>{{ bandTitle(band) }}</title>
          </polygon>
        </svg>
      </div>

      <div class="legend">
        <span class="legend-item">
          <i class="swatch kind-segment state-heating"></i>
          加热中
        </span>
        <span class="legend-item">
          <i class="swatch kind-const state-heating"></i>
          常加热
        </span>
        <span class="legend-item">
          <i class="swatch state-off"></i>
          未加热
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import airframeImg from '@/assets/deice/twin-tail-scorpion-perspective.webp'
import { usePayloadStore } from '@/store/payloadStore'
import { useUavStore } from '@/store/uavStore'
import {
  useManualIcingJudgement,
  usePayloadRelayControl,
  useTelemetryRate,
} from '@/composables/useDeiceDashboard'
import {
  buildHeatSegments,
  buildHeatStripRows,
  fmtFixed,
  type HeatSegmentKey,
} from '@/utils/deice/dashboardModel'

/**
 * 舞台坐标系 = 透视原图像素坐标（2319×1627）。
 * 机头朝左下，画面右下方机翼为飞机左翼、左上方机翼为右翼：
 * 机翼前缘三段带 = 外/中/内段加热膜（左 CH11/10/09，右 CH05/04/03），
 * 其后红色连续带 = 机翼常加热膜（CH08）；
 * 平尾、垂尾前缘带 = 左/右平尾（CH07/CH01）、左/右垂尾（CH06/CH02）。
 */
const STAGE_W = 2319
const STAGE_H = 1627

type BandKind = 'segment' | 'const'
type BandState = 'heating' | 'off' | 'nodata'

interface Band {
  key: string
  kind: BandKind
  /** 分段加热带对应热区；常加热带为 null（由 CH08 控制） */
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

const payloadStore = usePayloadStore()
const uavStore = useUavStore()
const { isRelayClosed, relayStatus } = usePayloadRelayControl()
const { manualJudge } = useManualIcingJudgement()

const segments = computed(() => buildHeatSegments(payloadStore.currentPayload))
const stripRows = computed(() => buildHeatStripRows(segments.value))
const hasRelay = computed(() => Boolean(relayStatus.value?.channels))

const heatingStripCount = computed(
  () =>
    stripRows.value.filter((r) => r.relayIds.some((id) => isRelayClosed(id)))
      .length,
)

// 防除冰控制器遥测帧刷新率（按帧计数变化统计）
const telemetryRate = useTelemetryRate(
  () => uavStore.fp95Deice?.frameCount ?? null,
)

const env = computed(
  () => payloadStore.currentPayload?.environmentSensor ?? null,
)

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
  if (level === 'normal') return 'is-normal'
  if (level === 'warning') return 'is-warning'
  if (level === 'danger') return 'is-danger'
  return 'is-muted'
})

function stateOf(key: HeatSegmentKey): BandState {
  if (!hasRelay.value) return 'nodata'
  const seg = segments.value.find((s) => s.key === key)
  if (!seg) return 'nodata'
  return isRelayClosed(seg.relayId) ? 'heating' : 'off'
}

function bandState(band: Band): BandState {
  if (band.segKey) return stateOf(band.segKey)
  if (!hasRelay.value) return 'nodata'
  return isRelayClosed(8) ? 'heating' : 'off'
}

const STATE_TEXT: Record<BandState, string> = {
  heating: '加热中',
  off: '未加热',
  nodata: '无回路状态',
}

function bandTitle(band: Band): string {
  const state = STATE_TEXT[bandState(band)]
  if (!band.segKey) {
    const temps = segments.value
      .filter((s) => s.constTemp !== null)
      .map((s) => `${s.name} ${fmtFixed(s.constTemp, 1)}°C`)
    return `机翼常加热膜 · CH08 · ${state}${temps.length ? `\n${temps.join(' / ')}` : ''}`
  }
  const seg = segments.value.find((s) => s.key === band.segKey)
  if (!seg) return state
  return `${seg.name} · CH${String(seg.relayId).padStart(2, '0')} · ${state}\n温度 ${fmtFixed(seg.temp, 1)}°C · 电压 ${fmtFixed(seg.voltage, 1)}V · 电流 ${fmtFixed(seg.current, 2)}A`
}
</script>

<style scoped>
.airframe-card {
  flex: 1;
  min-height: 0;
}

/* ---------- 环境速览 ---------- */
.env-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 8px;
  border: 1px solid rgb(56 189 248 / 28%);
  border-radius: 8px;
  background: rgb(14 30 52 / 45%);
}

.env-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 14px;
  border: 1px solid var(--dd-tile-border);
  border-radius: 6px;
  background: var(--dd-tile);
  min-width: 0;
}

.env-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dd-text-2);
}

.judge-tag {
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  line-height: 16px;
  color: var(--dd-amber);
  background: var(--dd-amber-dim);
}

.env-value {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 26px;
  line-height: 32px;
  font-weight: 600;
  white-space: nowrap;
}

.env-unit {
  font-size: 22px;
}

.icing-value {
  align-items: center;
  font-family: var(--dd-sans);
  gap: 10px;
}

.icing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentcolor;
  box-shadow: 0 0 8px currentcolor;
}

.icing-tile.is-normal .icing-value {
  color: var(--dd-green);
}

.icing-tile.is-warning .icing-value {
  color: var(--dd-amber);
}

.icing-tile.is-danger .icing-value {
  color: var(--dd-red);
}

.icing-tile.is-muted .icing-value {
  color: var(--dd-text-3);
}

/* ---------- 机体图（铺满裁切，对应设计稿大图） ---------- */
.airframe-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  container-type: size;
  background: #0b1220;
  border-radius: 6px;
  overflow: hidden;
}

.airframe-stage {
  position: absolute;
  left: 50%;
  top: 50%;
  /* 近似 cover：优先铺满，但横向最多裁切约 15%，保证整机轮廓可辨 */
  width: min(calc(max(100cqw, 100cqh * 2319 / 1627) * 1.04), 115cqw);
  aspect-ratio: 2319 / 1627;
  transform: translate(-49%, -50%);
}

.airframe-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
  pointer-events: none;
}

.airframe-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.heat-band {
  pointer-events: visiblePainted;
  cursor: default;
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
  opacity: 0.88;
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
}

@keyframes heat-pulse {
  0%,
  100% {
    opacity: 0.92;
  }

  50% {
    opacity: 0.7;
  }
}

@media (prefers-reduced-motion: reduce) {
  .heat-band {
    animation: none !important;
  }
}

.legend {
  position: absolute;
  left: 14px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
  color: var(--dd-text-2);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 14px;
  height: 8px;
  border-radius: 2px;
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
</style>
