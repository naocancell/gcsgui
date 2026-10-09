<template>
  <div
    class="avionics-panel deice-panel"
    :style="panelStyle"
    @mousedown="startDrag"
  >
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
              <svg
                v-if="!props.maximized"
                aria-hidden="true"
                viewBox="0 0 12 12"
              >
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
              :class="{
                ok: hasData && !hasAnyAlarm,
                alarm: hasData && hasAnyAlarm,
                idle: !hasData,
              }"
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
        <!-- 1. 控制指令配置与下发 (严格对应协议表 3 / 表 4) -->
        <section class="section-card cmd-control-card" @mousedown.stop>
          <div class="section-header-title">
            <span>防除冰工作模式与控制指令</span>
            <span class="section-sub">
              当前运行:
              {{ deiceData?.workModeDesc || (hasData ? '未知' : '待机') }} ({{
                formatHex(deiceData?.workMode)
              }})
            </span>
          </div>

          <div class="cmd-control-body">
            <!-- 模式选择行 -->
            <div class="cmd-form-row">
              <span class="cmd-field-label">工作模式:</span>
              <div class="cmd-mode-selector">
                <button
                  v-for="m in propModes"
                  :key="m.mode"
                  type="button"
                  class="cmd-mode-option"
                  :class="{ active: selectedPropMode === m.mode }"
                  @click="selectedPropMode = m.mode"
                >
                  <span class="mode-name">{{ m.name }}</span>
                  <span class="mode-hex">
                    0x{{ m.mode.toString(16).toUpperCase().padStart(2, '0') }}
                  </span>
                </button>
              </div>
            </div>

            <!-- 根据选中的模式动态展示对应操作区 -->
            <div class="cmd-mode-content-area">
              <!-- 0x00: 关闭模式 -->
              <div v-if="selectedPropMode === 0" class="cmd-mode-action-row">
                <span class="cmd-mode-tip">停止防除冰电加热输出</span>
                <button
                  type="button"
                  class="btn-send-cmd btn-danger"
                  :disabled="isSendingCommand"
                  @click="handleSendClosedMode"
                >
                  {{ isSendingCommand ? '下发中...' : '下发关闭指令' }}
                </button>
              </div>

              <!-- 0x01: 指令调节 -->
              <div
                v-else-if="selectedPropMode === 1"
                class="cmd-mode-action-row"
              >
                <span class="cmd-mode-tip">
                  以每次 1% 步长动态微调输出功率:
                </span>
                <div class="cmd-adjust-btns">
                  <button
                    type="button"
                    class="btn-adjust btn-adjust-dec"
                    :disabled="isSendingCommand"
                    @click="handleSendAdjust(0)"
                  >
                    <span class="adjust-symbol">−</span>
                    <span>减小功率 (-1%)</span>
                  </button>
                  <button
                    type="button"
                    class="btn-adjust btn-adjust-inc"
                    :disabled="isSendingCommand"
                    @click="handleSendAdjust(1)"
                  >
                    <span class="adjust-symbol">+</span>
                    <span>增大功率 (+1%)</span>
                  </button>
                </div>
              </div>

              <!-- 0x02: 恒功率模式 -->
              <div
                v-else-if="selectedPropMode === 2"
                class="cmd-mode-action-row"
              >
                <div class="cmd-param-input-group">
                  <label class="cmd-field-label">设定目标功率</label>
                  <div class="cmd-input-box">
                    <input
                      v-model.number="cmdTargetPower"
                      type="number"
                      min="0"
                      max="65535"
                      step="50"
                      class="param-input"
                      placeholder="0~65535"
                    />
                    <span class="param-unit">W</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="btn-send-cmd"
                  :disabled="isSendingCommand"
                  @click="handleSendConstantPower"
                >
                  {{ isSendingCommand ? '下发中...' : '下发恒功率指令' }}
                </button>
              </div>

              <!-- 0x03: 恒温模式 -->
              <div
                v-else-if="selectedPropMode === 3"
                class="cmd-mode-action-row"
              >
                <div class="cmd-param-input-group">
                  <label class="cmd-field-label">设定目标温度</label>
                  <div class="cmd-input-box">
                    <input
                      v-model.number="cmdTargetTemp"
                      type="number"
                      min="-40"
                      max="100"
                      step="1"
                      class="param-input"
                      placeholder="-40~100"
                    />
                    <span class="param-unit">℃</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="btn-send-cmd"
                  :disabled="isSendingCommand"
                  @click="handleSendConstantTemp"
                >
                  {{ isSendingCommand ? '下发中...' : '下发恒温指令' }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 2. 7 项健康与故障告警矩阵 (严格对应协议表 2) -->
        <section class="section-card" @mousedown.stop>
          <div class="section-header-title">
            <span>控制器故障与状态告警矩阵</span>
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
                <span v-else-if="alarm.active" class="pill pill-danger">
                  异常告警
                </span>
                <span v-else class="pill pill-normal">正常</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. 协议度量指标监控 (严格对应协议表 1) -->
        <div class="metrics-two-column" @mousedown.stop>
          <!-- 功率遥测 -->
          <section class="section-card metric-panel">
            <div class="section-header-title">
              <span>功率遥测</span>
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
          </section>

          <!-- 电气特性与温度遥测 -->
          <section class="section-card metric-panel">
            <div class="section-header-title">
              <span>电气与温度遥测</span>
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
              <div class="stat-box full-width">
                <span class="stat-label">控制器温度 (0-255, 偏差-45℃)</span>
                <div class="stat-value-group">
                  <span class="stat-number">
                    {{ formatFixed(deiceData?.controllerTemp, 1) }}
                  </span>
                  <span class="stat-unit">℃</span>
                  <span class="stat-temp-tag" :class="{ error: isTempHigh }">
                    {{ tempStatusText }}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </n-config-provider>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { NConfigProvider, darkTheme, useMessage } from 'naive-ui'
import { useUavStore } from '@/store/uavStore'
import { usePayloadStore } from '@/store/payloadStore'
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
const payloadStore = usePayloadStore()
const message = useMessage()
const activeTab = ref<'deice' | 'payload'>('deice')

// 螺旋桨防除冰工作模式指令列表 (严格对应需求规范)
const propModes = [
  { mode: 0, name: '关闭模式' },
  { mode: 1, name: '指令调节' },
  { mode: 2, name: '恒功率' },
  { mode: 3, name: '恒温模式' },
]
const loadingPropMode = ref<number | null>(null)
const selectedPropMode = ref<number>(2) // 默认恒功率模式
const cmdTargetPower = ref<number>(2000) // 目标设定功率 (W)
const cmdTargetTemp = ref<number>(15) // 目标温度 (℃)
const isSendingCommand = ref(false)

function syncFromTelemetry() {
  if (deiceData.value) {
    if (
      typeof deiceData.value.targetPower === 'number' &&
      Number.isFinite(deiceData.value.targetPower)
    ) {
      cmdTargetPower.value = deiceData.value.targetPower
    }
    if (typeof deiceData.value.workMode === 'number') {
      selectedPropMode.value = deiceData.value.workMode
    }
    message.info('已同步当前遥测参数至输入框')
  }
}

async function handleSendClosedMode() {
  isSendingCommand.value = true
  try {
    await payloadStore.sendPropellerDeiceCommand(0, 0, 0)
    message.success('已下发关闭模式指令 (停止加热)')
  } catch (e: any) {
    message.error(`下发关闭模式指令失败: ${e}`)
  } finally {
    isSendingCommand.value = false
  }
}

async function handleSendAdjust(direction: 0 | 1) {
  isSendingCommand.value = true
  const dirName = direction === 1 ? '增大功率 (+1%)' : '减小功率 (-1%)'
  try {
    // 严格对应协议表 4：参数 0x00 减小，0x01 增大，功率每次变化 1%
    await payloadStore.sendPropellerDeiceCommand(1, direction, 0)
    message.success(`已下发指令调节: [${dirName}]`)
  } catch (e: any) {
    message.error(`下发指令调节失败: ${e}`)
  } finally {
    isSendingCommand.value = false
  }
}

async function handleSendConstantPower() {
  isSendingCommand.value = true
  try {
    const power = Number.isFinite(cmdTargetPower.value)
      ? Math.max(0, Math.min(65535, Math.round(cmdTargetPower.value)))
      : 2000
    await payloadStore.sendPropellerDeiceCommand(2, power, 0)
    message.success(`已下发恒功率指令: 目标功率=${power}W`)
  } catch (e: any) {
    message.error(`下发恒功率指令失败: ${e}`)
  } finally {
    isSendingCommand.value = false
  }
}

async function handleSendConstantTemp() {
  isSendingCommand.value = true
  try {
    const temp = Number.isFinite(cmdTargetTemp.value)
      ? Math.round(cmdTargetTemp.value)
      : 15
    await payloadStore.sendPropellerDeiceCommand(3, 0, temp)
    message.success(`已下发恒温指令: 目标温度=${temp}℃`)
  } catch (e: any) {
    message.error(`下发恒温指令失败: ${e}`)
  } finally {
    isSendingCommand.value = false
  }
}

async function handleSendDeiceCommand() {
  if (selectedPropMode.value === 0) {
    await handleSendClosedMode()
  } else if (selectedPropMode.value === 1) {
    await handleSendAdjust(1)
  } else if (selectedPropMode.value === 2) {
    await handleSendConstantPower()
  } else if (selectedPropMode.value === 3) {
    await handleSendConstantTemp()
  }
}

async function handleSendPropMode(mode: number, name: string) {
  selectedPropMode.value = mode
  await handleSendDeiceCommand()
}

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
  if (
    Array.isArray(deiceData.value?.syncCode) &&
    deiceData.value!.syncCode.length > 0
  ) {
    return deiceData
      .value!.syncCode.map((b) =>
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
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
    sans-serif;
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
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
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

/* Overview bar & Control Card */
.cmd-control-card {
  background: #1c1c1c;
  border-color: rgba(255, 255, 255, 0.08);
}

.cmd-control-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cmd-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cmd-field-label {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
  white-space: nowrap;
}

.cmd-mode-selector {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cmd-mode-option {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  background: var(--surface-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cmd-mode-option:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.cmd-mode-option.active {
  background: #2563eb !important;
  border-color: #2563eb !important;
  color: #ffffff !important;
  font-weight: 600;
}

.cmd-mode-option .mode-hex {
  font-size: 10px;
  font-family: monospace;
  opacity: 0.7;
}

.cmd-mode-option.active .mode-hex {
  color: #ffffff;
  opacity: 0.85;
}

.cmd-mode-content-area {
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  min-height: 48px;
  display: flex;
  align-items: center;
}

.cmd-mode-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
}

.cmd-mode-tip {
  font-size: 12px;
  color: var(--text-secondary);
}

.cmd-adjust-btns {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-adjust {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid #1f87e8;
  background: #2563eb;
  color: #ffffff;
  transition: all 0.15s ease;
}

.btn-adjust:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-adjust-dec,
.btn-adjust-inc {
  background: #2563eb;
  color: #ffffff;
  border: 1px solid #1f87e8;
}

.btn-adjust-dec:hover:not(:disabled),
.btn-adjust-inc:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-adjust:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.adjust-symbol {
  font-size: 14px;
  font-weight: 700;
  font-family: monospace;
}

.cmd-param-input-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cmd-input-box {
  display: flex;
  align-items: center;
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 4px 8px;
  gap: 6px;
}

.cmd-input-box:focus-within {
  border-color: #339cff;
  box-shadow: 0 0 0 1px rgba(51, 156, 255, 0.3);
}

.param-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  width: 90px;
  outline: none;
}

.param-unit {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.btn-send-cmd {
  padding: 6px 18px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid #1f87e8;
  background: #2563eb;
  color: #ffffff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-send-cmd:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-send-cmd.btn-danger {
  background: #2563eb;
  color: #ffffff;
  border-color: #1f87e8;
}

.btn-send-cmd.btn-danger:hover:not(:disabled) {
  background: #1d4ed8;
  color: #ffffff;
}

.btn-send-cmd:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

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

.mode-constant-power,
.mode-constant-temp,
.mode-command,
.mode-closed,
.mode-offline,
.mode-default {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.sub-code {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
}

.mode-cmd-btns {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.mode-cmd-btn {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.mode-cmd-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
}

.mode-cmd-btn.active {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.4);
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

.stat-box.primary,
.stat-box.secondary {
  border-left: 1px solid var(--border-light);
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

.stat-box.full-width {
  grid-column: span 2;
}

.stat-temp-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(16, 163, 127, 0.15);
  color: #34d399;
  margin-left: 8px;
}

.stat-temp-tag.error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
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
