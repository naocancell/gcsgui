<template>
  <div class="avionics-panel deice-panel deice-dashboard" :style="panelStyle">
    <n-config-provider
      :abstract="true"
      :theme="darkTheme"
      :theme-overrides="naiveThemeOverrides"
    >
      <!-- ================= 顶栏：标题 / 状态摘要 / 回路总控 / 窗口控制 ================= -->
      <header
        class="panel-header dash-header"
        :data-tauri-drag-region="dragRegion"
        @mousedown="startDrag"
        @dblclick="onHeaderDblClick"
      >
        <div class="brand" :data-tauri-drag-region="dragRegion">
          <span
            class="brand-bar"
            :class="{
              online: hasData && !headerAlarm,
              warning: hasData && headerAlarm,
              offline: !hasData,
            }"
          ></span>
          <span class="brand-title" :data-tauri-drag-region="dragRegion">
            防除冰与载荷控制系统
          </span>
          <span class="brand-sub" :data-tauri-drag-region="dragRegion">
            ANTI-ICE · PAYLOAD CONTROL · GCS LINK
          </span>
        </div>

        <div class="header-chips" :data-tauri-drag-region="dragRegion">
          <span
            class="chip"
            :class="heaterMasterOn ? 'chip-green' : 'chip-plain'"
            :title="`防除冰工作模式 ${formatHex(deiceData?.workMode)}`"
          >
            加热总开关 · {{ heaterMasterText }}
          </span>
          <span class="chip chip-plain">
            继电器已闭合 {{ closedRelayCount }}/16
          </span>
        </div>

        <div class="header-actions" @mousedown.stop @dblclick.stop>
          <span class="min-temp-label">最低膜温</span>
          <span
            class="min-temp-value dd-mono"
            :title="payloadStore.minHeatingMat.location"
          >
            {{ formatFixed(payloadStore.minHeatingMat.temp, 1) }}
            <template v-if="payloadStore.minHeatingMat.temp !== null">
              °C
            </template>
          </span>
          <span class="loop-label">回路总控</span>
          <button
            class="hdr-btn hdr-btn-on"
            type="button"
            :disabled="loadingBatch"
            @click="handleSetAll(true)"
          >
            全部通电
          </button>
          <button
            class="hdr-btn hdr-btn-off"
            type="button"
            :disabled="loadingBatch"
            @click="handleSetAll(false)"
          >
            全部断开
          </button>
          <div v-if="props.standalone" class="window-controls">
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
      </header>

      <!-- ================= 主体：三栏大屏 ================= -->
      <div ref="bodyEl" class="panel-body dash-grid">
        <!-- 左栏：功率 / 电气 / 电源总线 -->
        <div class="dash-col col-left">
          <!-- 功率监测 (协议表 1) -->
          <section class="dd-card power-card">
            <div class="dd-card-head">
              <span
                class="dd-card-title"
                :title="`目标 / 实际 · 最近 ${powerSamples.length} 帧`"
              >
                功率监测
              </span>
            </div>
            <div class="dd-grid-2">
              <div class="dd-tile">
                <span class="dd-tile-label">目标设定功率</span>
                <span class="dd-tile-value big c-amber">
                  {{ formatInt(deiceData?.targetPower) }}
                  <span class="dd-unit">W</span>
                </span>
              </div>
              <div class="dd-tile">
                <span class="dd-tile-label">
                  当前实际输出功率
                  <span class="dd-mono c-muted">{{ powerDeviationText }}</span>
                </span>
                <span class="dd-tile-value big c-green">
                  {{ formatInt(deiceData?.currentPower) }}
                  <span class="dd-unit">W</span>
                </span>
              </div>
            </div>
            <div class="power-trend">
              <PowerTrendChart :samples="powerSamples" />
            </div>
          </section>

          <!-- 电气与温度遥测 (协议表 1) -->
          <section class="dd-card">
            <div class="dd-card-head">
              <span class="dd-card-title" :title="`同步码 ${syncCodeText}`">
                电气与温度遥测
              </span>
            </div>
            <div class="dd-grid-3">
              <div class="dd-tile">
                <span class="dd-tile-label">母线电压</span>
                <span class="dd-tile-value c-cyan">
                  {{ formatFixed(deiceData?.voltage, 1) }}
                  <span class="dd-unit">V</span>
                </span>
              </div>
              <div class="dd-tile">
                <span class="dd-tile-label">工作电流</span>
                <span class="dd-tile-value c-cyan">
                  {{ formatFixed(deiceData?.current, 1) }}
                  <span class="dd-unit">A</span>
                </span>
              </div>
              <div
                class="dd-tile"
                title="控制器温度原始值 0-255，显示值已减 45℃ 偏移"
              >
                <span class="dd-tile-label ctrl-temp-label">
                  控制器温度 (0-255, 偏移-45°C)
                </span>
                <span class="dd-tile-value temp-row c-green">
                  <span>
                    {{ formatFixed(deiceData?.controllerTemp, 1) }}
                    <span class="dd-unit">°C</span>
                  </span>
                  <span class="stat-temp-tag" :class="{ error: isTempHigh }">
                    {{ tempStatusText }}
                  </span>
                </span>
              </div>
            </div>
          </section>

          <PowerBusPanel class="fill-card" />
        </div>

        <!-- 中栏：机体示意图 + 电池温度 -->
        <div class="dash-col col-center">
          <AirframeHeatMap />
          <BatteryTempStrip />
        </div>

        <!-- 右栏：模式控制 / 回路控制 / 温压流矩阵 / 告警 / 结冰环境 -->
        <div class="dash-col col-right">
          <!-- 防除冰工作模式与控制指令 (协议表 3 / 表 4) -->
          <section class="dd-card cmd-control-card">
            <div class="dd-card-head">
              <span class="dd-card-title">防除冰工作模式与控制指令</span>
              <span
                class="dd-card-sub mode-run"
                :class="modeBadgeClass"
                :title="`工作模式 ${formatHex(deiceData?.workMode)}`"
              >
                当前运行 ·
                {{ deiceData?.workModeDesc || (hasData ? '未知' : '待机') }}
              </span>
            </div>

            <div class="mode-grid">
              <button
                v-for="m in propModes"
                :key="m.mode"
                type="button"
                class="mode-option"
                :class="{
                  selected: selectedPropMode === m.mode,
                  running: hasData && deiceData?.workMode === m.mode,
                }"
                @click="selectedPropMode = m.mode"
              >
                <span class="mode-name">{{ m.name }}</span>
                <span class="mode-hex dd-mono">
                  {{ formatHex(m.mode) }} ·
                  {{
                    hasData && deiceData?.workMode === m.mode
                      ? '已激活'
                      : '待命'
                  }}
                </span>
              </button>
            </div>

            <!-- 0x00: 关闭模式 -->
            <button
              v-if="selectedPropMode === 0"
              type="button"
              class="btn-send-cmd btn-block btn-danger"
              :disabled="isSendingCommand"
              @click="handleSendClosedMode"
            >
              {{ isSendingCommand ? '下发中...' : '下发关闭指令' }}
            </button>

            <!-- 0x01: 指令调节（每次 1% 步长） -->
            <div v-else-if="selectedPropMode === 1" class="adjust-btns">
              <button
                type="button"
                class="btn-send-cmd"
                :disabled="isSendingCommand"
                @click="handleSendAdjust(0)"
              >
                − 减小 1%
              </button>
              <button
                type="button"
                class="btn-send-cmd"
                :disabled="isSendingCommand"
                @click="handleSendAdjust(1)"
              >
                + 增大 1%
              </button>
            </div>

            <!-- 0x02 恒功率 / 0x03 恒温：点击后在气泡中确认参数再下发 -->
            <n-popover
              v-else
              v-model:show="paramPopoverShow"
              trigger="click"
              placement="bottom"
              :width="'trigger'"
              :show-arrow="false"
              class="deice-param-popover"
            >
              <template #trigger>
                <button
                  type="button"
                  class="btn-send-cmd btn-block"
                  :disabled="isSendingCommand"
                >
                  {{
                    isSendingCommand
                      ? '下发中...'
                      : selectedPropMode === 2
                        ? '下发恒功率指令'
                        : '下发恒温指令'
                  }}
                </button>
              </template>
              <div class="param-pop">
                <label class="cmd-field">
                  <span class="cmd-label">
                    {{
                      selectedPropMode === 2 ? '设定目标功率' : '设定目标温度'
                    }}
                  </span>
                  <span class="cmd-input-box">
                    <input
                      v-if="selectedPropMode === 2"
                      v-model.number="cmdTargetPower"
                      type="number"
                      :min="CONST_POWER_TARGET_MIN"
                      :max="CONST_POWER_TARGET_MAX"
                      step="50"
                      class="param-input dd-mono"
                      :class="{ 'is-invalid': powerTargetInvalid }"
                      :placeholder="`${CONST_POWER_TARGET_MIN}~${CONST_POWER_TARGET_MAX}`"
                    />
                    <input
                      v-else
                      v-model.number="cmdTargetTemp"
                      type="number"
                      :min="CONST_TEMP_TARGET_MIN"
                      :max="CONST_TEMP_TARGET_MAX"
                      step="1"
                      class="param-input dd-mono"
                      :class="{ 'is-invalid': tempTargetInvalid }"
                      :placeholder="`${CONST_TEMP_TARGET_MIN}~${CONST_TEMP_TARGET_MAX}`"
                    />
                    <span class="param-unit">
                      {{ selectedPropMode === 2 ? 'W' : '℃' }}
                    </span>
                  </span>
                </label>
                <span v-if="powerTargetInvalid" class="param-error">
                  {{ powerRangeHint }}
                </span>
                <span v-if="tempTargetInvalid" class="param-error">
                  {{ tempRangeHint }}
                </span>
                <button
                  type="button"
                  class="btn-send-cmd"
                  :disabled="
                    isSendingCommand || powerTargetInvalid || tempTargetInvalid
                  "
                  @click="confirmParamCommand"
                >
                  确认下发
                </button>
              </div>
            </n-popover>
          </section>

          <RelayCircuitPanel />

          <HeatingMatrixPanel />

          <!-- 控制故障与状态告警矩阵 (协议表 2 + 0xC5 结冰) -->
          <section class="dd-card">
            <div class="dd-card-head">
              <span
                class="dd-card-title"
                :title="`${activeAlarmCount} 告警 · ${alarmSummaryText}`"
              >
                控制故障与状态告警矩阵
              </span>
              <span v-if="activeAlarmCount > 0" class="dd-card-sub c-red">
                {{ activeAlarmCount }} 告警 · 请及时处置
              </span>
            </div>
            <div class="alarm-grid">
              <div
                v-for="alarm in dashboardAlarms"
                :key="alarm.key"
                class="alarm-card"
                :title="alarm.desc"
                :class="{
                  'alarm-active': alarm.online && alarm.active,
                  'alarm-normal': alarm.online && !alarm.active,
                  'alarm-offline': !alarm.online,
                }"
              >
                <div class="alarm-top">
                  <span class="indicator-dot"></span>
                  <span class="alarm-name">{{ alarm.name }}</span>
                  <span
                    v-if="alarm.online && alarm.active"
                    class="pill pill-danger"
                  >
                    告警
                  </span>
                </div>
              </div>
            </div>
          </section>

          <IcingEnvironmentPanel />
        </div>
      </div>
    </n-config-provider>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { NConfigProvider, NPopover, darkTheme, useMessage } from 'naive-ui'
import { useUavStore } from '@/store/uavStore'
import { usePayloadStore } from '@/store/payloadStore'
import { useDeiceMonitor } from '@/composables/useDeiceMonitor'
import {
  useDashboardFit,
  useDeicePowerHistory,
  usePayloadLink,
  usePayloadRelayControl,
} from '@/composables/useDeiceDashboard'
import {
  CONST_POWER_TARGET_MAX,
  CONST_POWER_TARGET_MIN,
  CONST_TEMP_TARGET_MAX,
  CONST_TEMP_TARGET_MIN,
  normalizeConstPowerTarget,
  normalizeConstTempTarget,
  powerDeviationPercent,
} from '@/utils/deice/dashboardModel'
import AirframeHeatMap from '@/components/deice/AirframeHeatMap.vue'
import BatteryTempStrip from '@/components/deice/BatteryTempStrip.vue'
import HeatingMatrixPanel from '@/components/deice/HeatingMatrixPanel.vue'
import IcingEnvironmentPanel from '@/components/deice/IcingEnvironmentPanel.vue'
import PowerBusPanel from '@/components/deice/PowerBusPanel.vue'
import PowerTrendChart from '@/components/deice/PowerTrendChart.vue'
import RelayCircuitPanel from '@/components/deice/RelayCircuitPanel.vue'
import './deice/dashboard.css'

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
const message = useMessage()
// 挂载载荷遥测监听（含继电器初态巡检），并获取载荷 store
const payloadStore: ReturnType<typeof usePayloadStore> = usePayloadLink()
const { closedRelayCount, loadingBatch, handleSetAll } =
  usePayloadRelayControl()
const { samples: powerSamples } = useDeicePowerHistory(uavStore)
// 大屏自适应：窗口高度不足时整体等比缩放三栏内容，尽量免滚动完整呈现
const bodyEl = ref<HTMLElement | null>(null)
useDashboardFit(bodyEl)

const dragRegion = computed(() => (props.standalone ? '' : undefined))

// 螺旋桨防除冰工作模式指令列表 (严格对应需求规范)
const propModes = [
  { mode: 0, name: '关闭模式' },
  { mode: 1, name: '指令调节' },
  { mode: 2, name: '恒功率' },
  { mode: 3, name: '恒温模式' },
]
const selectedPropMode = ref<number>(2) // 默认恒功率模式
const cmdTargetPower = ref<number>(2000) // 目标设定功率 (W)
const cmdTargetTemp = ref<number>(15) // 目标温度 (℃)
const isSendingCommand = ref(false)
const paramPopoverShow = ref(false)

// 恒温目标温度：协议参数为 uint16，负温或越界时禁止下发
const tempTargetInvalid = computed(
  () =>
    selectedPropMode.value === 3 &&
    normalizeConstTempTarget(cmdTargetTemp.value) === null,
)

const tempRangeHint = `目标温度需为 ${CONST_TEMP_TARGET_MIN}~${CONST_TEMP_TARGET_MAX}℃ 的整数，不支持负温`

// 恒功率目标功率：DFB-2000 额定 2000W，越界时禁止下发（不再静默截断到 65535）
const powerTargetInvalid = computed(
  () =>
    selectedPropMode.value === 2 &&
    normalizeConstPowerTarget(cmdTargetPower.value) === null,
)

const powerRangeHint = `目标功率需为 ${CONST_POWER_TARGET_MIN}~${CONST_POWER_TARGET_MAX}W`

async function confirmParamCommand() {
  if (powerTargetInvalid.value || tempTargetInvalid.value) return
  paramPopoverShow.value = false
  if (selectedPropMode.value === 2) await handleSendConstantPower()
  else if (selectedPropMode.value === 3) await handleSendConstantTemp()
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
  const power = normalizeConstPowerTarget(cmdTargetPower.value)
  if (power === null) {
    message.error(`${powerRangeHint}，未下发`)
    return
  }
  isSendingCommand.value = true
  try {
    await payloadStore.sendPropellerDeiceCommand(2, power, 0)
    message.success(`已下发恒功率指令: 目标功率=${power}W`)
  } catch (e: any) {
    message.error(`下发恒功率指令失败: ${e}`)
  } finally {
    isSendingCommand.value = false
  }
}

async function handleSendConstantTemp() {
  const temp = normalizeConstTempTarget(cmdTargetTemp.value)
  if (temp === null) {
    message.error(`${tempRangeHint}，未下发`)
    return
  }
  isSendingCommand.value = true
  try {
    await payloadStore.sendPropellerDeiceCommand(3, 0, temp)
    message.success(`已下发恒温指令: 目标温度=${temp}℃`)
  } catch (e: any) {
    message.error(`下发恒温指令失败: ${e}`)
  } finally {
    isSendingCommand.value = false
  }
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
  isTempHigh,
  tempStatusText,
} = useDeiceMonitor(uavStore)

// 顶栏：加热总开关 = 防除冰控制器处于非关闭模式（0x00 以外）
const heaterMasterOn = computed(
  () => hasData.value && deiceData.value?.workMode !== 0,
)
const heaterMasterText = computed(() => {
  if (!hasData.value) return '离线'
  switch (deiceData.value?.workMode) {
    case 0x00:
      return '关闭模式'
    case 0x01:
      return '指令调节模式'
    case 0x02:
      return '恒功率模式'
    case 0x03:
      return '恒温模式'
    default:
      return deiceData.value?.workModeDesc || '未知模式'
  }
})

const powerDeviationText = computed(() => {
  const pct = powerDeviationPercent(
    deiceData.value?.targetPower,
    deiceData.value?.currentPower,
  )
  if (pct === null) return ''
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
})

// 告警矩阵：协议表 2 的 7 项控制器告警 + 0xC5 结冰告警
const ICING_ALERT_LEVELS = [
  'AlertCalculating',
  'Light',
  'Moderate',
  'Severe',
  'Extreme',
]

const iceAlarmActive = computed(() => {
  const ice = payloadStore.currentPayload?.icingSensor
  return Boolean(ice && ICING_ALERT_LEVELS.includes(ice.icingSeverity))
})

// 大屏紧凑显示名（完整协议名称见悬停提示）
const ALARM_SHORT_NAME: Record<string, string> = {
  targetPowerOverflow: '功率超范围',
  targetPowerTimeout: '功率调节超时',
}

const dashboardAlarms = computed(() => [
  ...alarmItems.value.map((a) => ({
    ...a,
    name: ALARM_SHORT_NAME[a.key] ?? a.name,
    desc: `${a.name}：${a.desc}`,
    online: hasData.value,
  })),
  {
    key: 'icingWarning',
    name: '结冰告警',
    code: 'ICE_WARNING',
    active: iceAlarmActive.value,
    online: Boolean(payloadStore.currentPayload?.icingSensor),
    desc: '0xC5 结冰探测器上报结冰（含解算中告警）',
  },
])

const activeAlarmCount = computed(
  () => dashboardAlarms.value.filter((a) => a.online && a.active).length,
)

const alarmSummaryText = computed(() => {
  const anyOnline = dashboardAlarms.value.some((a) => a.online)
  if (!anyOnline) return '全部待机'
  return activeAlarmCount.value > 0 ? '请及时处置' : '全部正常'
})

const headerAlarm = computed(() => hasAnyAlarm.value || iceAlarmActive.value)

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

// 拖拽窗口与布局 (非独立窗口时支持通过顶栏内部平移)
const panelPosition = ref({ x: 20, y: 48 })
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
  x = Math.max(0, Math.min(Math.max(0, window.innerWidth - 400), x))
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
  width: min(1600px, calc(100vw - 40px));
  height: min(920px, calc(100vh - 64px));
  max-width: 100vw;
  position: fixed;
  z-index: 2000;
  border: 1px solid var(--dd-card-border);
  border-radius: 10px;
  box-shadow: 0 16px 36px rgb(0 0 0 / 48%);
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  box-sizing: border-box;
  overflow: hidden;
}

/* ================= 顶栏 ================= */
.dash-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 46px;
  padding: 0 12px 0 14px;
  background: var(--dd-card);
  border: 1px solid var(--dd-card-border);
  border-radius: 8px;
  cursor: default;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 1;
}

.brand-bar {
  width: 6px;
  height: 20px;
  border-radius: 2px;
  background: var(--dd-gray);
  flex-shrink: 0;
}

.brand-bar.online {
  background: var(--dd-green);
}

.brand-bar.warning {
  background: var(--dd-red);
}

.brand-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.brand-sub {
  font-family: var(--dd-mono);
  font-size: 9.5px;
  letter-spacing: 2.5px;
  color: var(--dd-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-chips {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

@media (max-width: 1760px) {
  .brand-sub {
    display: none;
  }
}

.chip {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgb(148 163 184 / 6%);
  color: var(--dd-text-2);
  white-space: nowrap;
  flex-shrink: 0;
}

.chip-green {
  color: var(--dd-green);
}

.chip-blue {
  color: var(--dd-blue-text);
}

.chip-plain {
  color: var(--dd-text);
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 4px;
  white-space: nowrap;
  background: rgb(148 163 184 / 6%);
  color: var(--dd-text-3);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
}

.status.online {
  color: var(--dd-green);
}

.status.warning {
  color: var(--dd-red);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.min-temp-label,
.loop-label {
  font-size: 11.5px;
  color: var(--dd-text-2);
  white-space: nowrap;
}

.min-temp-value {
  font-size: 17px;
  font-weight: 600;
  color: var(--dd-green);
  white-space: nowrap;
  margin-right: 4px;
}

.hdr-btn {
  height: 28px;
  padding: 0 16px;
  border-radius: 5px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: filter 0.15s ease;
}

.hdr-btn:hover:not(:disabled) {
  filter: brightness(1.25);
}

.hdr-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hdr-btn-on {
  background: rgb(22 101 52 / 35%);
  border-color: rgb(74 222 128 / 18%);
  color: var(--dd-green);
}

.hdr-btn-off {
  background: rgb(127 29 29 / 40%);
  border-color: rgb(248 113 113 / 18%);
  color: var(--dd-red);
}

.ctrl-temp-label {
  font-size: 10px;
  letter-spacing: -0.2px;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
  padding-left: 10px;
  border-left: 1px solid var(--dd-card-border);
}

.window-control {
  width: 28px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--dd-text-2);
  cursor: pointer;
}

.window-control svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.2;
}

.window-control:hover {
  background: rgb(148 163 184 / 12%);
  color: var(--dd-text);
}

.window-control-close:hover {
  background: #dc2626;
  color: #fff;
}

/* ================= 三栏主体 ================= */
.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.panel-body::-webkit-scrollbar,
.dash-col::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.panel-body::-webkit-scrollbar-thumb,
.dash-col::-webkit-scrollbar-thumb {
  background: rgb(148 163 184 / 18%);
  border-radius: 3px;
}

.panel-body::-webkit-scrollbar-track,
.dash-col::-webkit-scrollbar-track {
  background: transparent;
}

.dash-grid {
  display: grid;
  grid-template-columns:
    minmax(300px, 1fr)
    minmax(480px, 2.05fr)
    minmax(360px, 1.05fr);
  gap: 10px;
}

.dash-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
}

.col-center {
  overflow: hidden;
}

.fill-card {
  flex: 1 0 auto;
}

/* 功率监测 */
.power-card {
  flex-shrink: 0;
}

.dd-tile-value.big {
  font-size: 20px;
}

.power-trend {
  height: 64px;
}

.temp-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.stat-temp-tag {
  font-family: var(--dd-sans);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--dd-green);
}

.stat-temp-tag.error {
  color: var(--dd-red);
}

/* 模式运行文字配色 */
.mode-offline {
  color: var(--dd-text-3);
}

.mode-closed {
  color: var(--dd-text-2);
}

.mode-command {
  color: var(--dd-blue-text);
}

.mode-constant-power {
  color: var(--dd-amber);
}

.mode-constant-temp {
  color: var(--dd-cyan);
}

.mode-default {
  color: var(--dd-text-2);
}

.mode-run {
  font-family: var(--dd-sans);
  font-size: 11px;
}

/* 模式控制 */
.mode-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.mode-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 4px;
  border-radius: 6px;
  border: 1px solid var(--dd-tile-border);
  background: var(--dd-tile);
  color: var(--dd-text);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.mode-option:hover {
  border-color: rgb(148 163 184 / 22%);
}

.mode-name {
  font-size: 12.5px;
  font-weight: 600;
}

.mode-hex {
  font-size: 9.5px;
  color: var(--dd-text-3);
}

.mode-option.running .mode-hex {
  color: var(--dd-green);
}

.mode-option.selected {
  background: rgb(22 101 52 / 32%);
  border-color: rgb(74 222 128 / 30%);
}

.mode-option.selected .mode-name {
  color: var(--dd-green);
}

.cmd-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cmd-label {
  font-size: 11.5px;
  color: var(--dd-text-2);
  white-space: nowrap;
}

.cmd-input-box {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border-radius: 5px;
  background: var(--dd-tile);
  border: 1px solid var(--dd-tile-border);
}

.cmd-input-box:focus-within {
  border-color: rgb(96 165 250 / 55%);
}

.param-input {
  width: 92px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--dd-text);
  font-size: 14px;
  font-weight: 600;
}

.param-unit {
  font-size: 11px;
  color: var(--dd-text-3);
}

.btn-send-cmd {
  height: 30px;
  padding: 0 16px;
  border: none;
  border-radius: 5px;
  background: var(--dd-blue);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: filter 0.15s ease;
}

.btn-send-cmd:hover:not(:disabled) {
  filter: brightness(1.15);
}

.btn-send-cmd:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-send-cmd.btn-danger {
  background: #dc2626;
}

.btn-send-cmd.btn-block {
  width: 100%;
  height: 32px;
}

/* 恒功率 / 恒温参数确认气泡（弹层挂载在大屏外部，需自带配色） */
.param-pop {
  --dd-tile: #0a111e;
  --dd-tile-border: rgb(148 163 184 / 14%);
  --dd-text: #e2e8f0;
  --dd-text-2: #94a3b8;
  --dd-text-3: #5b6b85;
  --dd-blue: #2563eb;

  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
}

.param-pop .param-error {
  order: 3;
  flex-basis: 100%;
  margin-top: -4px;
  font-size: 11px;
  color: #f87171;
}

.param-input.is-invalid {
  color: #f87171;
}

.adjust-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.adjust-btns .btn-send-cmd {
  height: 32px;
}

/* 告警矩阵 */
.alarm-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.alarm-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--dd-tile);
  border: 1px solid var(--dd-tile-border);
  min-width: 0;
}

.alarm-top {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.indicator-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dd-gray);
  flex-shrink: 0;
}

.alarm-name {
  flex: 1;
  font-size: 11px;
  color: var(--dd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill {
  font-size: 10px;
  flex-shrink: 0;
}

.pill-danger {
  color: var(--dd-red);
  font-weight: 700;
}

.alarm-normal .indicator-dot {
  background: var(--dd-green);
}

.alarm-active {
  background: var(--dd-red-dim);
  border-color: rgb(248 113 113 / 35%);
}

.alarm-active .indicator-dot {
  background: var(--dd-red);
  box-shadow: 0 0 6px var(--dd-red);
}
</style>
