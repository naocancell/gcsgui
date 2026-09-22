<template>
  <div class="avionics-panel deice-panel" :style="panelStyle" @mousedown="startDrag">
    <n-config-provider
      :abstract="true"
      :theme="darkTheme"
      :theme-overrides="naiveThemeOverrides"
    >
      <!-- Header -->
      <div
        class="panel-header"
        :data-tauri-drag-region="props.standalone ? '' : undefined"
        @dblclick="onHeaderDblClick"
      >
        <div
          class="title"
          :data-tauri-drag-region="props.standalone ? '' : undefined"
        >
          <span :data-tauri-drag-region="props.standalone ? '' : undefined">
            防除冰与载荷控制系统
          </span>
        </div>

        <div class="header-meta">
          <div
            class="status"
            :class="{
              online: hasData && !hasAnyAlarm,
              warning: hasData && hasAnyAlarm,
              offline: !hasData,
            }"
          >
            <span class="status-dot"></span>
            <span v-if="!hasData">离线</span>
            <span v-else-if="hasAnyAlarm">告警</span>
            <span v-else>正常</span>
          </div>

          <div
            v-if="props.standalone"
            class="window-controls"
            @mousedown.stop
            @dblclick.stop
          >
            <button
              class="window-control"
              type="button"
              aria-label="最小化窗口"
              title="最小化"
              @click="emit('minimize')"
            >
              <svg aria-hidden="true" viewBox="0 0 12 12">
                <path d="M2 8.5h8" />
              </svg>
            </button>
            <button
              class="window-control"
              type="button"
              :aria-label="props.maximized ? '还原窗口' : '最大化窗口'"
              :title="props.maximized ? '还原' : '最大化'"
              @click="emit('maximize')"
            >
              <svg v-if="!props.maximized" aria-hidden="true" viewBox="0 0 12 12">
                <rect x="2.5" y="2.5" width="7" height="7" />
              </svg>
              <svg v-else aria-hidden="true" viewBox="0 0 12 12">
                <rect x="3.5" y="2" width="6" height="6" />
                <rect x="2" y="3.5" width="6" height="6" />
              </svg>
            </button>
            <button
              class="window-control window-control-close"
              type="button"
              aria-label="关闭窗口"
              title="关闭"
              @click="emit('close')"
            >
              <svg aria-hidden="true" viewBox="0 0 12 12">
                <path d="m2.5 2.5 7 7m0-7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 模式导航条 -->
      <div class="avionics-subnav" @mousedown.stop>
        <div class="subnav-container">
          <button
            class="subnav-btn"
            :class="{ active: activeTab === 'deice' }"
            type="button"
            @click="activeTab = 'deice'"
          >
            <span class="subnav-title">防除冰监控</span>
            <span
              class="subnav-status"
              :class="{ ok: hasData && !hasAnyAlarm, alarm: hasData && hasAnyAlarm, idle: !hasData }"
            ></span>
          </button>

          <button
            class="subnav-btn"
            :class="{ active: activeTab === 'payload' }"
            type="button"
            @click="activeTab = 'payload'"
          >
            <span class="subnav-title">载荷与加热控制</span>
            <span class="subnav-status ok"></span>
          </button>
        </div>
      </div>

      <!-- Main Body: 载荷控制面板 -->
      <div v-if="activeTab === 'payload'" class="panel-body payload-tab-body">
        <PayloadControlPanel />
      </div>

      <!-- Main Body: 防除冰监控 -->
      <div v-else class="panel-body">
        <!-- 顶部概览条 (模式与健康指示) -->
        <section class="section-card mode-overview-card" @mousedown.stop>
          <div class="overview-grid">
            <!-- 运行模式 -->
            <div class="overview-item">
              <span class="overview-label">工作模式</span>
              <div class="overview-value-row">
                <span
                  class="mode-badge"
                  :class="modeBadgeClass"
                >
                  {{ deiceData?.workModeDesc || (hasData ? '未知模式' : '等待遥测数据') }}
                </span>
                <span class="sub-code">
                  代码: {{ formatHex(deiceData?.workMode) }}
                </span>
              </div>
            </div>

            <!-- 系统健康度 -->
            <div class="overview-item">
              <span class="overview-label">系统综合健康诊断</span>
              <div class="overview-value-row">
                <span
                  class="health-badge"
                  :class="{
                    healthy: hasData && !hasAnyAlarm,
                    danger: hasData && hasAnyAlarm,
                    idle: !hasData,
                  }"
                >
                  <span class="dot"></span>
                  {{
                    !hasData
                      ? '链路未建立 / 待机'
                      : hasAnyAlarm
                        ? '检测到异常故障告警'
                        : '所有检测项正常'
                  }}
                </span>
              </div>
            </div>

            <!-- 帧率与通信链路 -->
            <div class="overview-item text-right">
              <span class="overview-label">透传子帧 0x94</span>
              <div class="overview-value-row justify-end">
                <span class="frame-tag">
                  计数: {{ formatInt(deiceData?.frameCount) }}
                </span>
                <span
                  class="sync-tag"
                  :class="{ valid: deiceData?.syncValid, invalid: hasData && !deiceData?.syncValid }"
                >
                  {{ deiceData?.syncValid ? '同步锁相正常' : (hasData ? '同步异常' : '未同步') }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- 7 项健康与故障告警矩阵 -->
        <section class="section-card" @mousedown.stop>
          <div class="section-header-title">
            <span>控制器故障与安全告警矩阵</span>
          </div>

          <div class="alarm-grid">
            <div
              v-for="alarm in alarmItems"
              :key="alarm.key"
              class="alarm-card"
              :title="alarm.desc"
              :class="{
                'alarm-active': hasData && alarm.active,
                'alarm-normal': hasData && !alarm.active,
                'alarm-offline': !hasData,
              }"
            >
              <div class="alarm-indicator">
                <span class="indicator-dot"></span>
              </div>
              <div class="alarm-info">
                <div class="alarm-name">{{ alarm.name }}</div>
                <div class="alarm-code">{{ alarm.code }}</div>
              </div>
              <div class="alarm-status-pill">
                <span v-if="!hasData" class="pill pill-offline">待机</span>
                <span v-else-if="alarm.active" class="pill pill-danger">异常告警</span>
                <span v-else class="pill pill-normal">正常</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 核心度量指标网格: 功率监控 + 电气与温度 -->
        <div class="metrics-two-column" @mousedown.stop>
          <!-- 功率状态 -->
          <section class="section-card metric-panel">
            <div class="section-header-title">
              <span>功率状态监控</span>
            </div>

            <div class="power-stats-layout">
              <div class="stat-box primary">
                <span class="stat-label">目标设定功率</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ formatInt(deiceData?.targetPower) }}
                  </span>
                  <span class="stat-unit">W</span>
                </div>
              </div>

              <div class="stat-box secondary">
                <span class="stat-label">当前实际输出功率</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ formatInt(deiceData?.currentPower) }}
                  </span>
                  <span class="stat-unit">W</span>
                </div>
              </div>
            </div>

            <!-- 功率偏差与调节状态 -->
            <div class="power-progress-section">
              <div class="progress-info">
                <span>功率利用率 / 负荷达成</span>
                <span class="progress-percent">
                  {{ powerRatioText }}
                </span>
              </div>
              <div class="progress-bar-track">
                <div
                  class="progress-bar-fill"
                  :style="{ width: powerRatioWidth }"
                ></div>
              </div>
              <div class="power-delta">
                <span>功率差值 (实际 - 目标):</span>
                <span :class="powerDeltaClass">
                  {{ powerDeltaText }}
                </span>
              </div>
            </div>
          </section>

          <!-- 电气特性与温度监控 -->
          <section class="section-card metric-panel">
            <div class="section-header-title">
              <span>电气特性与温度监控</span>
            </div>

            <div class="electrical-grid">
              <!-- 母线电压 -->
              <div class="stat-box">
                <span class="stat-label">母线电压</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ formatFixed(deiceData?.voltage, 1) }}
                  </span>
                  <span class="stat-unit">V</span>
                </div>
              </div>

              <!-- 工作电流 -->
              <div class="stat-box">
                <span class="stat-label">工作电流</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ formatFixed(deiceData?.current, 1) }}
                  </span>
                  <span class="stat-unit">A</span>
                </div>
              </div>

              <!-- 控制器温度 -->
              <div class="stat-box" :class="{ 'temp-warning': isTempHigh }">
                <span class="stat-label">控制器温度</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ formatFixed(deiceData?.controllerTemp, 1) }}
                  </span>
                  <span class="stat-unit">℃</span>
                </div>
                <div class="stat-footer">
                  {{ tempStatusText }}
                </div>
              </div>

              <!-- 瞬时视在功率 -->
              <div class="stat-box">
                <span class="stat-label">计算母线负载功率</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ calculatedPowerText }}
                  </span>
                  <span class="stat-unit">W</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- 协议与底层诊断 (链路与校验) -->
        <section class="section-card" @mousedown.stop>
          <div class="section-header-title">
            <span>协议校验与底层帧诊断</span>
          </div>

          <div class="diagnostics-grid">
            <div class="diag-item">
              <span class="diag-label">帧同步码</span>
              <div class="diag-val-row">
                <span class="mono-code">{{ syncCodeText }}</span>
                <span
                  class="badge-pill"
                  :class="{
                    'pill-valid': deiceData?.syncValid,
                    'pill-danger': hasData && !deiceData?.syncValid,
                    'pill-invalid': !hasData,
                  }"
                >
                  {{ deiceData?.syncValid ? '同步码正确' : (hasData ? '同步码异常' : '未同步') }}
                </span>
              </div>
            </div>

            <div class="diag-item">
              <span class="diag-label">累加和校验</span>
              <div class="diag-val-row">
                <span class="mono-code">
                  {{ formatHex(deiceData?.checksum) }}
                </span>
                <span
                  class="badge-pill"
                  :class="{
                    'pill-valid': deiceData?.checksumValid,
                    'pill-danger': hasData && !deiceData?.checksumValid,
                    'pill-invalid': !hasData,
                  }"
                >
                  {{ deiceData?.checksumValid ? '校验通过' : (hasData ? '校验和错误' : '待校验') }}
                </span>
              </div>
            </div>

            <div class="diag-item">
              <span class="diag-label">状态码回读</span>
              <div class="diag-val-row">
                <span class="mono-code">
                  状态1: {{ formatHex(deiceData?.rawStatus1) }}
                </span>
                <span class="mono-code">
                  状态2: {{ formatHex(deiceData?.status2) }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </n-config-provider>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useUavStore } from '@/store/uavStore'
import { useDeiceMonitor } from '@/composables/useDeiceMonitor'
import PayloadControlPanel from '@/components/PayloadControlPanel.vue'

const props = defineProps<{
  standalone?: boolean
  maximized?: boolean
}>()

const emit = defineEmits<{
  (e: 'minimize'): void
  (e: 'maximize'): void
  (e: 'close'): void
}>()

const uavStore = useUavStore()
const activeTab = ref<'deice' | 'payload'>('deice')

const naiveThemeOverrides = {
  common: {
    primaryColor: '#339cff',
    primaryColorHover: '#5cadff',
    primaryColorPressed: '#1f87e8',
  },
}

function onHeaderDblClick() {
  if (props.standalone) emit('maximize')
}

// 防除冰控制器状态与度量管理
const {
  deiceData,
  hasData,
  alarmItems,
  hasAnyAlarm,
  modeBadgeClass,
  powerRatioText,
  powerRatioWidth,
  powerDeltaText,
  powerDeltaClass,
  calculatedPowerText,
  isTempHigh,
  tempStatusText,
} = useDeiceMonitor(uavStore)

function formatFixed(val: unknown, digits = 1): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val.toFixed(digits)
  }
  return '—'
}

function formatHex(val: unknown, padLength = 2): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return `0x${val.toString(16).toUpperCase().padStart(padLength, '0')}`
  }
  return '—'
}

function formatInt(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return String(Math.round(val))
  }
  return '—'
}

const syncCodeText = computed(() => {
  if (Array.isArray(deiceData.value?.syncCode) && deiceData.value!.syncCode.length > 0) {
    return deiceData.value!.syncCode
      .map((b) =>
        typeof b === 'number' && Number.isFinite(b) && b >= 0
          ? `0x${Math.floor(b).toString(16).toUpperCase().padStart(2, '0')}`
          : '0x00',
      )
      .join(' ')
  }
  return '0xEB 0x90'
})

// 拖拽窗口与布局 (非独立窗口时支持内部平移)
const panelPosition = ref({ x: 28, y: 56 })
const panelStyle = computed(() => {
  if (props.standalone) {
    return {
      width: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      position: 'relative' as const,
      borderRadius: '0px',
      border: 'none',
      boxShadow: 'none',
      boxSizing: 'border-box' as const,
    }
  }
  return {
    position: 'fixed' as const,
    zIndex: 2000,
    left: `${panelPosition.value.x}px`,
    top: `${panelPosition.value.y}px`,
  }
})

let dragging = false
let startX = 0,
  startY = 0,
  originX = 0,
  originY = 0

function startDrag(e: MouseEvent) {
  if (props.standalone) return
  if (e.button !== 0) return
  dragging = true
  startX = e.clientX
  startY = e.clientY
  originX = panelPosition.value.x
  originY = panelPosition.value.y
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
  e.preventDefault()
}

function onDrag(e: MouseEvent) {
  if (!dragging) return
  if (e.buttons !== 1) {
    stopDrag()
    return
  }
  let x = originX + e.clientX - startX
  let y = originY + e.clientY - startY
  x = Math.max(0, Math.min(Math.max(0, window.innerWidth - 920), x))
  y = Math.max(0, Math.min(window.innerHeight - 300, y))
  panelPosition.value.x = x
  panelPosition.value.y = y
}

function stopDrag() {
  dragging = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

onBeforeUnmount(() => {
  stopDrag()
})
</script>

<style scoped>
.avionics-panel {
  --surface-primary: #212121;
  --surface-under: #181818;
  --surface-secondary: #282828;
  --text-primary: rgb(255 255 255 / 90%);
  --text-secondary: rgb(255 255 255 / 65%);
  --text-tertiary: rgb(255 255 255 / 45%);
  --border-light: rgb(255 255 255 / 4%);
  --border-default: rgb(255 255 255 / 8%);
  --border-heavy: rgb(255 255 255 / 14%);
  --focus-blue: #339cff;
  --accent-blue: #2563eb;
  --accent-green: #10a37f;
  --accent-red: #ef4444;
  --accent-amber: #f59e0b;
  --accent-purple: #8b5cf6;

  width: 920px;
  max-width: 100vw;
  position: fixed;
  z-index: 2000;
  background: var(--surface-primary);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 16px 36px rgb(0 0 0 / 48%);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

/* Header */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-under);
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
  cursor: default;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.title span:first-child {
  color: var(--text-primary);
  font-size: 14px;
}

.sub-title {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 航电系统模式软键导航条 (Avionics Sub-System Softkeys) */
.avionics-subnav {
  background: #1a1a1a;
  border-bottom: 1px solid var(--border-default);
  padding: 0 16px;
  display: flex;
  align-items: center;
}

.subnav-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.subnav-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.subnav-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.03);
}

.subnav-btn.active {
  color: #38bdf8;
  border-bottom-color: #38bdf8;
  background: rgba(56, 189, 248, 0.06);
}

.subnav-tag {
  font-size: 10px;
  font-family: monospace;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-tertiary);
}

.subnav-btn.active .subnav-tag {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
}

.subnav-title {
  letter-spacing: 0.3px;
}

.subnav-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.subnav-status.ok {
  background: var(--accent-green);
  box-shadow: 0 0 6px rgba(16, 163, 127, 0.6);
}

.subnav-status.alarm {
  background: var(--accent-red);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
}

.subnav-status.idle {
  background: var(--text-tertiary);
}

.payload-tab-body {
  padding: 14px 18px 20px !important;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Status Pill */
.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 9999px;
  border: 1px solid transparent;
}

.status .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status.online {
  color: var(--accent-green);
  background: rgba(16, 163, 127, 0.1);
  border-color: rgba(16, 163, 127, 0.25);
}
.status.online .status-dot {
  background: var(--accent-green);
}

.status.warning {
  color: var(--accent-red);
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
  animation: pulse-danger 1.5s infinite;
}
.status.warning .status-dot {
  background: var(--accent-red);
}

.status.offline {
  color: var(--text-tertiary);
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-light);
}
.status.offline .status-dot {
  background: var(--text-tertiary);
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Window controls */
.window-controls {
  display: flex;
  gap: 6px;
}

.window-control {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: var(--surface-secondary);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
}

.window-control:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.window-control-close:hover {
  background: var(--accent-red);
  color: white;
  border-color: var(--accent-red);
}

.window-control svg {
  width: 11px;
  height: 11px;
  stroke: currentColor;
  stroke-width: 1.5;
  fill: none;
}

/* Body */
.panel-body {
  padding: 14px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
}

.panel-body::-webkit-scrollbar {
  width: 6px;
}
.panel-body::-webkit-scrollbar-track {
  background: transparent;
}
.panel-body::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 15%);
  border-radius: 3px;
}
.panel-body::-webkit-scrollbar-thumb:hover {
  background: rgb(255 255 255 / 25%);
}

/* Common Section Card */
.section-card {
  padding: 12px 16px;
  background: var(--surface-under);
  border: 1px solid var(--border-default);
  border-radius: 10px;
}

.section-header-title {
  display: flex;
  align-items: baseline;
  margin-bottom: 10px;
  padding-bottom: 6px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-light);
  font-size: 12px;
  font-weight: 600;
}

.section-sub {
  margin-left: 8px;
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.5px;
}

/* Overview bar */
.mode-overview-card {
  background: #1c1c1c;
  border-color: rgba(255, 255, 255, 0.08);
}

.overview-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.5fr 1.1fr;
  align-items: center;
  gap: 16px;
}

.overview-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overview-label {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.overview-value-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.justify-end {
  justify-content: flex-end;
}

.text-right {
  text-align: right;
}

.mode-badge {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--surface-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-heavy);
}

.mode-constant-power {
  background: rgba(37, 99, 235, 0.15);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.3);
}

.mode-constant-temp {
  background: rgba(16, 163, 127, 0.15);
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.3);
}

.mode-command {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.3);
}

.mode-closed {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-tertiary);
}

.mode-offline {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-tertiary);
  border-color: var(--border-light);
}

.mode-default {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border-color: rgba(167, 139, 250, 0.3);
}

.sub-code {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
}

.health-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
}

.health-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.health-badge.healthy {
  background: rgba(16, 163, 127, 0.12);
  color: var(--accent-green);
  border: 1px solid rgba(16, 163, 127, 0.3);
}
.health-badge.healthy .dot {
  background: var(--accent-green);
}

.health-badge.danger {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.5);
  animation: pulse-danger 1.5s infinite;
}
.health-badge.danger .dot {
  background: var(--accent-red);
}

.health-badge.idle {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-tertiary);
  border: 1px solid var(--border-light);
}
.health-badge.idle .dot {
  background: var(--text-tertiary);
}

.frame-tag,
.sync-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  background: var(--surface-secondary);
}

.sync-tag.valid {
  color: var(--accent-green);
  border: 1px solid rgba(16, 163, 127, 0.3);
}

.sync-tag.invalid {
  color: var(--accent-red);
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
}

/* 7 项告警矩阵 */
.alarm-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 860px) {
  .alarm-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.alarm-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  transition: all 0.2s ease;
}

.alarm-indicator .indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: block;
}

.alarm-info {
  flex: 1;
  min-width: 0;
}

.alarm-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.alarm-code {
  font-size: 9px;
  font-family: monospace;
  color: var(--text-tertiary);
}

.alarm-status-pill .pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  white-space: nowrap;
}

.pill-normal {
  background: rgba(16, 163, 127, 0.12);
  color: #34d399;
}

.pill-danger {
  background: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
  animation: pulse-danger 1s infinite;
}

.pill-offline {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-tertiary);
}

/* 告警状态高亮 */
.alarm-card.alarm-normal .indicator-dot {
  background: var(--accent-green);
  box-shadow: 0 0 6px rgba(16, 163, 127, 0.5);
}

.alarm-card.alarm-active {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
}

.alarm-card.alarm-active .indicator-dot {
  background: var(--accent-red);
  box-shadow: 0 0 8px #ef4444;
}

.alarm-card.alarm-active .alarm-name {
  color: #f87171;
}

.alarm-card.alarm-offline .indicator-dot {
  background: var(--text-tertiary);
}

/* 双列网格 */
.metrics-two-column {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 800px) {
  .metrics-two-column {
    grid-template-columns: 1fr;
  }
}

.metric-panel {
  display: flex;
  flex-direction: column;
}

/* 功率卡片统计 */
.power-stats-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.stat-box {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-box.primary {
  border-left: 3px solid var(--focus-blue);
}

.stat-box.secondary {
  border-left: 3px solid var(--accent-green);
}

.stat-box.temp-warning {
  border-left: 3px solid var(--accent-red);
  background: rgba(239, 68, 68, 0.08);
}

.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

.stat-value-group {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-number {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
}

.stat-unit {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.stat-footer {
  font-size: 9px;
  color: var(--text-tertiary);
  letter-spacing: 0.2px;
}

.power-progress-section {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
}

.progress-percent {
  font-weight: 700;
  color: var(--text-primary);
}

.progress-bar-track {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #10b981);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.power-delta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.delta-good {
  color: var(--accent-green);
  font-weight: 600;
}

.delta-warning {
  color: var(--accent-amber);
  font-weight: 600;
}

.delta-danger {
  color: var(--accent-red);
  font-weight: 600;
}

/* 电气网格 */
.electrical-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* 诊断网格 */
.diagnostics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 800px) {
  .diagnostics-grid {
    grid-template-columns: 1fr;
  }
}

.diag-item {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.diag-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.diag-val-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mono-code {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 600;
}

.badge-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.pill-valid {
  background: rgba(16, 163, 127, 0.15);
  color: #34d399;
}

.pill-invalid {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-tertiary);
}

.pill-danger {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
}
</style>
