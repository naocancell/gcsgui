<template>
  <div class="avionics-payload-panel">
    <!-- 顶部概览条：通信与结冰状态 -->
    <section class="section-card overview-section" @mousedown.stop>
      <div class="overview-grid">
        <!-- 结冰状态诊断 -->
        <div class="overview-item">
          <span class="overview-label">结冰传感器诊断 (ICING STATUS)</span>
          <div class="overview-value-row">
            <span class="health-badge" :class="icingHealthClass">
              <span class="dot"></span>
              {{ icingDesc.text }}
            </span>
            <span v-if="currentPayload?.icingSensor?.heatingActive" class="heating-tag">
              电加热中
            </span>
          </div>
        </div>

        <!-- 继电器工作状态摘要 -->
        <div class="overview-item">
          <span class="overview-label">继电器总线控制 (RELAY STATUS)</span>
          <div class="overview-value-row">
            <span class="mode-badge" :class="relaySummaryClass">
              闭合: {{ closedRelayCount }} / 16
            </span>
            <span class="sub-code">
              掩码: {{ formatHex(relayStatus?.mask, 4) }}
            </span>
          </div>
        </div>

        <!-- 通信与快捷指令 -->
        <div class="overview-item text-right">
          <span class="overview-label">载荷链路 0xC3~0xC5 (MISSION BUS)</span>
          <div class="overview-value-row justify-end">
            <button
              class="avionics-btn"
              type="button"
              :disabled="loadingQuery"
              @click="handleRefreshRelay"
            >
              {{ loadingQuery ? '查询中...' : '刷新状态' }}
            </button>
            <button
              class="avionics-btn btn-success"
              type="button"
              @click="handleSetAll(true)"
            >
              一键全开
            </button>
            <button
              class="avionics-btn btn-danger"
              type="button"
              @click="handleSetAll(false)"
            >
              一键全关
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 16路继电器航电控制矩阵 -->
    <section class="section-card" @mousedown.stop>
      <div class="section-header-title">
        <span>16 路继电器航电控制矩阵</span>
        <span class="section-sub">AVIONICS RELAY CONTROL MATRIX (0xC3)</span>
      </div>

      <div class="relay-matrix">
        <div
          v-for="index in 16"
          :key="index"
          class="relay-cell"
          :class="{
            'relay-closed': isRelayClosed(index),
            'relay-open': !isRelayClosed(index),
          }"
        >
          <div class="relay-cell-header">
            <span class="relay-id">RLY-{{ formatPad(index, 2) }}</span>
            <span class="relay-led"></span>
          </div>
          <div class="relay-status-text">
            {{ isRelayClosed(index) ? 'CLOSED' : 'OPEN' }}
          </div>
          <button
            class="relay-toggle-btn"
            type="button"
            :disabled="loadingSwitch === index"
            @click="handleToggleRelay(index, !isRelayClosed(index))"
          >
            <span v-if="loadingSwitch === index">...</span>
            <span v-else>{{ isRelayClosed(index) ? '断开' : '闭合' }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 双列指标：100V 升压模块 + 温湿度与结冰传感器 -->
    <div class="metrics-two-column" @mousedown.stop>
      <!-- 100V 升压模块电气监控 -->
      <section class="section-card metric-panel">
        <div class="section-header-title">
          <span>100V 升压模块电气特性</span>
          <span class="section-sub">100V BOOST CONVERTER (0xC4-01)</span>
        </div>

        <div class="electrical-grid">
          <!-- 输入电压 -->
          <div class="stat-box">
            <span class="stat-label">输入电压 (Vin)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.inputVoltage, 2) }}
              </span>
              <span class="stat-unit">V</span>
            </div>
            <div class="stat-footer">28V DC Input</div>
          </div>

          <!-- 输入电流 -->
          <div class="stat-box">
            <span class="stat-label">输入电流 (Iin)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.inputCurrent, 2) }}
              </span>
              <span class="stat-unit">A</span>
            </div>
            <div class="stat-footer">Primary Current</div>
          </div>

          <!-- 输出电压 -->
          <div class="stat-box primary">
            <span class="stat-label">输出电压 (Vout)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.outputVoltage, 1) }}
              </span>
              <span class="stat-unit">V</span>
            </div>
            <div class="stat-footer">100V High-Voltage Bus</div>
          </div>

          <!-- 输出电流 -->
          <div class="stat-box secondary">
            <span class="stat-label">输出电流 (Iout)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.outputCurrent, 2) }}
              </span>
              <span class="stat-unit">A</span>
            </div>
            <div class="stat-footer">Load Output Current</div>
          </div>

          <!-- 模块温度 -->
          <div class="stat-box" :class="{ 'temp-warning': isBoostTempHigh }">
            <span class="stat-label">模块温度 (Temp)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.temperature, 1) }}
              </span>
              <span class="stat-unit">℃</span>
            </div>
            <div class="stat-footer">
              {{ isBoostTempHigh ? '超温警戒' : '正常工作温度' }}
            </div>
          </div>

          <!-- 输出视在功率 -->
          <div class="stat-box">
            <span class="stat-label">输出功率 (Pout)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ boostPowerText }}
              </span>
              <span class="stat-unit">W</span>
            </div>
            <div class="stat-footer">Vout × Iout</div>
          </div>
        </div>
      </section>

      <!-- 大气环境与结冰诊断 -->
      <section class="section-card metric-panel">
        <div class="section-header-title">
          <span>大气环境与结冰探测器</span>
          <span class="section-sub">ENVIRONMENT & ICING DIAGNOSTICS (0xC4-07 / 0xC5)</span>
        </div>

        <div class="electrical-grid">
          <!-- 环境温度 -->
          <div class="stat-box">
            <span class="stat-label">大气环境温度</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.temperature, 1) }}
              </span>
              <span class="stat-unit">℃</span>
            </div>
            <div class="stat-footer">Ambient Temperature</div>
          </div>

          <!-- 相对湿度 -->
          <div class="stat-box">
            <span class="stat-label">相对环境湿度</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.humidity, 1) }}
              </span>
              <span class="stat-unit">%RH</span>
            </div>
            <div class="stat-footer">Relative Humidity</div>
          </div>

          <!-- 大气压强 -->
          <div class="stat-box">
            <span class="stat-label">静压大气压强</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.pressure, 2) }}
              </span>
              <span class="stat-unit">kPa</span>
            </div>
            <div class="stat-footer">Barometric Pressure</div>
          </div>

          <!-- 结冰告警等级 -->
          <div class="stat-box" :class="{ 'temp-warning': isIcingActive }">
            <span class="stat-label">结冰告警等级</span>
            <div class="stat-value-group">
              <span class="stat-number-text">
                {{ icingDesc.text }}
              </span>
            </div>
            <div class="stat-footer">Ice Detection Level</div>
          </div>

          <!-- 探头加热状态 -->
          <div class="stat-box">
            <span class="stat-label">探头电加热状态</span>
            <div class="stat-value-group">
              <span class="stat-number-text">
                {{ currentPayload?.icingSensor?.heatingActive ? '加热中 (HEATING)' : '未加热 (OFF)' }}
              </span>
            </div>
            <div class="stat-footer">Probe Heater Status</div>
          </div>

          <!-- 传感器诊断 -->
          <div class="stat-box">
            <span class="stat-label">结冰传感器诊断</span>
            <div class="stat-value-group">
              <span class="stat-number-text" :class="{ 'text-danger': currentPayload?.icingSensor?.detectorFault }">
                {{ currentPayload?.icingSensor?.detectorFault ? '探测器故障' : '探测器正常' }}
              </span>
            </div>
            <div class="stat-footer">
              V{{ currentPayload?.icingSensor?.versionMajor ?? '-' }}.{{ currentPayload?.icingSensor?.versionMinor ?? '-' }} (Cnt: {{ currentPayload?.icingSensor?.counter ?? '-' }})
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 翼面加热膜细粒度温控采温矩阵 (0xC4-02 / 03) -->
    <section class="section-card" @mousedown.stop>
      <div class="section-header-title">
        <span>机翼与尾翼加热膜温控采温矩阵</span>
        <span class="section-sub">AIRFRAME SURFACE TEMPERATURE MATRIX (0xC4-02 / 0xC4-03)</span>
      </div>

      <div class="temp-matrix-layout">
        <!-- 左侧翼面与平尾垂尾 -->
        <div class="temp-sub-panel">
          <div class="temp-sub-title">左机翼与尾翼 (LEFT AIRFRAME)</div>
          <div class="temp-cards-grid">
            <div class="temp-stat-card">
              <span class="t-label">左内常加 / 加热</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor1?.innerWingConst, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor1?.innerWingHeat, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
            <div class="temp-stat-card">
              <span class="t-label">左中常加 / 加热</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor1?.midWingConst, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor1?.midWingHeat, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
            <div class="temp-stat-card">
              <span class="t-label">左外常加 / 加热</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor1?.outerWingConst, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor1?.outerWingHeat, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
            <div class="temp-stat-card">
              <span class="t-label">左平尾 / 左垂尾</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor1?.horizontalTail, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor1?.verticalTail, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧翼面与平尾垂尾 -->
        <div class="temp-sub-panel">
          <div class="temp-sub-title">右机翼与尾翼 (RIGHT AIRFRAME)</div>
          <div class="temp-cards-grid">
            <div class="temp-stat-card">
              <span class="t-label">右内常加 / 加热</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor2?.innerWingConst, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor2?.innerWingHeat, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
            <div class="temp-stat-card">
              <span class="t-label">右中常加 / 加热</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor2?.midWingConst, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor2?.midWingHeat, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
            <div class="temp-stat-card">
              <span class="t-label">右外常加 / 加热</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor2?.outerWingConst, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor2?.outerWingHeat, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
            <div class="temp-stat-card">
              <span class="t-label">右平尾 / 右垂尾</span>
              <div class="t-vals">
                <span class="t-num">{{ formatFixed(currentPayload?.tempSensor2?.horizontalTail, 1) }}</span>
                <span class="t-sep">/</span>
                <span class="t-num highlight">{{ formatFixed(currentPayload?.tempSensor2?.verticalTail, 1) }}</span>
                <span class="t-unit">℃</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import { usePayloadStore } from '@/store/payloadStore'

const payloadStore = usePayloadStore()
const message = useMessage()

const currentPayload = computed(() => payloadStore.currentPayload)
const relayStatus = computed(() => payloadStore.relayStatus)
const icingDesc = computed(() => payloadStore.icingDesc)

const loadingSwitch = ref<number | null>(null)
const loadingQuery = ref(false)

const closedRelayCount = computed(() => {
  const channels = relayStatus.value?.channels
  if (!channels) return 0
  return channels.filter(Boolean).length
})

const relaySummaryClass = computed(() => {
  if (closedRelayCount.value === 0) return 'mode-closed'
  if (closedRelayCount.value === 16) return 'mode-constant-temp'
  return 'mode-command'
})

const isIcingActive = computed(() => {
  const sev = currentPayload.value?.icingSensor?.icingSeverity
  return sev !== undefined && sev !== 'NoIce' && sev !== 'Unknown'
})

const icingHealthClass = computed(() => {
  const ice = currentPayload.value?.icingSensor
  if (!ice) return 'idle'
  if (ice.detectorFault || isIcingActive.value) return 'danger'
  return 'healthy'
})

const isBoostTempHigh = computed(() => {
  const t = currentPayload.value?.boostModule?.temperature
  return typeof t === 'number' && t > 85.0
})

const boostPowerText = computed(() => {
  const bm = currentPayload.value?.boostModule
  if (!bm || typeof bm.outputVoltage !== 'number' || typeof bm.outputCurrent !== 'number') {
    return '—'
  }
  return (bm.outputVoltage * bm.outputCurrent).toFixed(1)
})

function isRelayClosed(index: number): boolean {
  const channels = relayStatus.value?.channels
  if (!channels || index < 1 || index > 16) return false
  return Boolean(channels[index - 1])
}

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

function formatPad(val: number, len = 2): string {
  return String(val).padStart(len, '0')
}

async function handleToggleRelay(index: number, enabled: boolean) {
  loadingSwitch.value = index
  try {
    await payloadStore.sendRelayControl(index, enabled)
    message.success(`继电器 RLY-${formatPad(index)} 指令已发送: ${enabled ? '闭合' : '断开'}`)
  } catch (e: any) {
    message.error(`下发继电器 RLY-${formatPad(index)} 失败: ${e}`)
  } finally {
    loadingSwitch.value = null
  }
}

async function handleSetAll(enabled: boolean) {
  try {
    const mask = enabled ? 0xFFFF : 0x0000
    await payloadStore.sendRelayBatch(mask)
    message.success(`已下发一键${enabled ? '全开' : '全关'}控制指令`)
  } catch (e: any) {
    message.error(`一键控制失败: ${e}`)
  }
}

async function handleRefreshRelay() {
  loadingQuery.value = true
  try {
    await payloadStore.queryRelayStatus()
    message.info('已发送 16 路继电器状态查询指令')
  } catch (e: any) {
    message.error(`查询失败: ${e}`)
  } finally {
    loadingQuery.value = false
  }
}

onMounted(() => {
  payloadStore.startListening()
})

onBeforeUnmount(() => {
  payloadStore.stopListening()
})
</script>

<style scoped>
.avionics-payload-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 顶部概览 */
.overview-section {
  background: var(--surface-under);
  border: 1px solid var(--border-default);
}

.overview-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.1fr 1.3fr;
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

/* 模式与健康徽章（继承 Deice 航电风格） */
.mode-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-heavy);
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

.heating-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.4);
}

/* 航电按键样式 */
.avionics-btn {
  background: var(--surface-secondary);
  border: 1px solid var(--border-heavy);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.avionics-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--focus-blue);
  color: var(--focus-blue);
}

.avionics-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.avionics-btn.btn-success {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(16, 163, 127, 0.1);
}
.avionics-btn.btn-success:hover:not(:disabled) {
  background: rgba(16, 163, 127, 0.25);
  border-color: var(--accent-green);
}

.avionics-btn.btn-danger {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}
.avionics-btn.btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--accent-red);
}

/* 16 路继电器航电矩阵 */
.relay-matrix {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
}

@media (max-width: 860px) {
  .relay-matrix {
    grid-template-columns: repeat(4, 1fr);
  }
}

.relay-cell {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.relay-cell-header {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px;
}

.relay-id {
  font-size: 10px;
  font-family: monospace;
  font-weight: 700;
  color: var(--text-tertiary);
}

.relay-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: all 0.2s ease;
}

.relay-status-text {
  font-size: 11px;
  font-family: monospace;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
}

.relay-toggle-btn {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  padding: 3px 0;
  cursor: pointer;
  transition: all 0.15s ease;
}

.relay-toggle-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
}

/* 闭合状态高亮 */
.relay-cell.relay-closed {
  background: rgba(16, 163, 127, 0.08);
  border-color: rgba(16, 163, 127, 0.35);
  box-shadow: 0 0 10px rgba(16, 163, 127, 0.1);
}

.relay-cell.relay-closed .relay-id {
  color: var(--text-primary);
}

.relay-cell.relay-closed .relay-led {
  background: var(--accent-green);
  box-shadow: 0 0 6px rgba(16, 163, 127, 0.8);
}

.relay-cell.relay-closed .relay-status-text {
  color: #34d399;
}

.relay-cell.relay-closed .relay-toggle-btn {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.relay-cell.relay-closed .relay-toggle-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--accent-red);
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

.electrical-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* 航电风格 Stat-Box */
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
  color: var(--text-tertiary);
  font-weight: 500;
}

.stat-value-group {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-number {
  font-size: 20px;
  font-weight: 700;
  font-family: monospace;
  color: var(--text-primary);
  line-height: 1.1;
}

.stat-number-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-number-text.text-danger {
  color: var(--accent-red);
}

.stat-unit {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.stat-footer {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* 翼面采温矩阵布局 */
.temp-matrix-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 800px) {
  .temp-matrix-layout {
    grid-template-columns: 1fr;
  }
}

.temp-sub-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.temp-sub-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
}

.temp-cards-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.temp-stat-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.t-label {
  font-size: 10px;
  color: var(--text-tertiary);
}

.t-vals {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.t-num {
  font-size: 14px;
  font-weight: 700;
  font-family: monospace;
  color: var(--text-primary);
}

.t-num.highlight {
  color: #38bdf8;
}

.t-sep {
  font-size: 11px;
  color: var(--text-tertiary);
}

.t-unit {
  font-size: 10px;
  color: var(--text-secondary);
  margin-left: 2px;
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
