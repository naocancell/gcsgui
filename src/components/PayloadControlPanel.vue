<template>
  <div class="payload-panel-container">
    <!-- 顶部状态概览与总控 -->
    <section class="section-card" @mousedown.stop>
      <div class="overview-grid">
        <!-- 结冰状态 -->
        <div class="overview-item">
          <span class="overview-label">结冰状态诊断</span>
          <div class="overview-value-row">
            <span class="health-badge" :class="icingHealthClass">
              <span class="dot"></span>
              {{ icingDesc.text }}
            </span>
            <span
              v-if="currentPayload?.icingSensor?.heatingActive"
              class="heating-status-tag"
            >
              探头电加热中
            </span>
          </div>
        </div>

        <!-- 回路统计 -->
        <div class="overview-item">
          <span class="overview-label">加热回路状态</span>
          <div class="overview-value-row">
            <span class="mode-badge" :class="relaySummaryClass">
              已通电: {{ closedRelayCount }} / 16
            </span>
            <span class="mask-code">
              掩码: {{ formatHex(relayStatus?.mask, 4) }}
            </span>
          </div>
        </div>

        <!-- 快捷控制按键 -->
        <div class="overview-item text-right">
          <span class="overview-label">回路快捷操作</span>
          <div class="overview-value-row justify-end">
            <button
              class="action-btn"
              type="button"
              :disabled="loadingQuery"
              @click="handleRefreshRelay"
            >
              {{ loadingQuery ? '巡检中...' : '状态巡检' }}
            </button>
            <button
              class="action-btn btn-on"
              type="button"
              @click="handleSetAll(true)"
            >
              全部通电
            </button>
            <button
              class="action-btn btn-off"
              type="button"
              @click="handleSetAll(false)"
            >
              全部断开
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 16路加热与载荷供电回路控制（按航空结构分组，彻底消灭拥挤） -->
    <section class="section-card" @mousedown.stop>
      <div class="section-header-title">
        <span>防除冰与载荷供电回路控制</span>
      </div>

      <div class="circuit-groups">
        <!-- 1. 机翼加热回路 -->
        <div class="circuit-group">
          <div class="group-title">机翼加热回路</div>
          <div class="circuit-cards-grid">
            <div
              v-for="ch in wingChannels"
              :key="ch.id"
              class="circuit-card"
              :class="{ 'is-on': isRelayClosed(ch.id) }"
            >
              <div class="circuit-left">
                <span class="circuit-dot"></span>
                <span class="circuit-name">{{ ch.name }}</span>
              </div>
              <button
                class="circuit-btn"
                type="button"
                :disabled="loadingSwitch === ch.id"
                @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
              >
                {{ loadingSwitch === ch.id ? '...' : (isRelayClosed(ch.id) ? '断开' : '通电') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 2. 尾翼加热回路 -->
        <div class="circuit-group">
          <div class="group-title">尾翼加热回路</div>
          <div class="circuit-cards-grid">
            <div
              v-for="ch in tailChannels"
              :key="ch.id"
              class="circuit-card"
              :class="{ 'is-on': isRelayClosed(ch.id) }"
            >
              <div class="circuit-left">
                <span class="circuit-dot"></span>
                <span class="circuit-name">{{ ch.name }}</span>
              </div>
              <button
                class="circuit-btn"
                type="button"
                :disabled="loadingSwitch === ch.id"
                @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
              >
                {{ loadingSwitch === ch.id ? '...' : (isRelayClosed(ch.id) ? '断开' : '通电') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 3. 载荷加温与特种防冰 -->
        <div class="circuit-group">
          <div class="group-title">载荷与特种设备</div>
          <div class="circuit-cards-grid">
            <div
              v-for="ch in payloadChannels"
              :key="ch.id"
              class="circuit-card"
              :class="{ 'is-on': isRelayClosed(ch.id) }"
            >
              <div class="circuit-left">
                <span class="circuit-dot"></span>
                <span class="circuit-name">{{ ch.name }}</span>
              </div>
              <button
                class="circuit-btn"
                type="button"
                :disabled="loadingSwitch === ch.id"
                @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
              >
                {{ loadingSwitch === ch.id ? '...' : (isRelayClosed(ch.id) ? '断开' : '通电') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 双列：100V 升压电源 + 结冰探测与大气环境 -->
    <div class="metrics-two-column" @mousedown.stop>
      <!-- 100V 升压电源系统 -->
      <section class="section-card metric-panel">
        <div class="section-header-title">
          <span>100V 升压电源</span>
        </div>

        <div class="electrical-grid">
          <div class="stat-box">
            <span class="stat-label">母线输入电压</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.inputVoltage, 1) }}
              </span>
              <span class="stat-unit">V</span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">母线输入电流</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.inputCurrent, 2) }}
              </span>
              <span class="stat-unit">A</span>
            </div>
          </div>

          <div class="stat-box primary">
            <span class="stat-label">升压输出电压</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.outputVoltage, 1) }}
              </span>
              <span class="stat-unit">V</span>
            </div>
          </div>

          <div class="stat-box secondary">
            <span class="stat-label">负载输出电流</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.outputCurrent, 2) }}
              </span>
              <span class="stat-unit">A</span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">升压输出功率</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ boostPowerText }}
              </span>
              <span class="stat-unit">W</span>
            </div>
          </div>

          <div class="stat-box" :class="{ 'temp-warning': isBoostTempHigh }">
            <span class="stat-label">模块温度</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.temperature, 1) }}
              </span>
              <span class="stat-unit">℃</span>
            </div>
            <div v-if="isBoostTempHigh" class="stat-footer text-danger">
              超温警戒 (>85℃)
            </div>
          </div>
        </div>
      </section>

      <!-- 结冰探测与大气环境 -->
      <section class="section-card metric-panel">
        <div class="section-header-title">
          <span>结冰探测与大气环境</span>
        </div>

        <div class="electrical-grid">
          <div class="stat-box" :class="{ 'temp-warning': isIcingActive }">
            <span class="stat-label">结冰告警等级</span>
            <div class="stat-value-group">
              <span class="stat-number-text" :class="{ 'text-danger': isIcingActive }">
                {{ icingDesc.text }}
              </span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">结冰探测器状态</span>
            <div class="stat-value-group">
              <span
                class="stat-number-text"
                :class="{ 'text-danger': currentPayload?.icingSensor?.detectorFault }"
              >
                {{ currentPayload?.icingSensor?.detectorFault ? '探测器故障' : '探测器正常' }}
              </span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">探头防冰加热</span>
            <div class="stat-value-group">
              <span class="stat-number-text">
                {{ currentPayload?.icingSensor?.heatingActive ? '加热中' : '未加热' }}
              </span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">外部大气温度</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.temperature, 1) }}
              </span>
              <span class="stat-unit">℃</span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">相对湿度</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.humidity, 1) }}
              </span>
              <span class="stat-unit">%RH</span>
            </div>
          </div>

          <div class="stat-box">
            <span class="stat-label">大气压强</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.pressure, 2) }}
              </span>
              <span class="stat-unit">kPa</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 翼面加热膜温控采温（左右对称舒展布局） -->
    <section class="section-card" @mousedown.stop>
      <div class="section-header-title">
        <span>机翼与尾翼加热膜温度</span>
      </div>

      <div class="wing-temp-grid">
        <!-- 左侧翼面 -->
        <div class="wing-column">
          <div class="column-subtitle">左机翼与左尾翼</div>
          <div class="column-cards">
            <div class="temp-item-card">
              <div class="temp-position-name">左内机翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">常加:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor1?.innerWingConst, 1) }} ℃</span>
                <span class="temp-tag pl">加热:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor1?.innerWingHeat, 1) }} ℃</span>
              </div>
            </div>

            <div class="temp-item-card">
              <div class="temp-position-name">左中机翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">常加:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor1?.midWingConst, 1) }} ℃</span>
                <span class="temp-tag pl">加热:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor1?.midWingHeat, 1) }} ℃</span>
              </div>
            </div>

            <div class="temp-item-card">
              <div class="temp-position-name">左外机翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">常加:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor1?.outerWingConst, 1) }} ℃</span>
                <span class="temp-tag pl">加热:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor1?.outerWingHeat, 1) }} ℃</span>
              </div>
            </div>

            <div class="temp-item-card">
              <div class="temp-position-name">左尾翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">平尾:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor1?.horizontalTail, 1) }} ℃</span>
                <span class="temp-tag pl">垂尾:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor1?.verticalTail, 1) }} ℃</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧翼面 -->
        <div class="wing-column">
          <div class="column-subtitle">右机翼与右尾翼</div>
          <div class="column-cards">
            <div class="temp-item-card">
              <div class="temp-position-name">右内机翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">常加:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor2?.innerWingConst, 1) }} ℃</span>
                <span class="temp-tag pl">加热:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor2?.innerWingHeat, 1) }} ℃</span>
              </div>
            </div>

            <div class="temp-item-card">
              <div class="temp-position-name">右中机翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">常加:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor2?.midWingConst, 1) }} ℃</span>
                <span class="temp-tag pl">加热:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor2?.midWingHeat, 1) }} ℃</span>
              </div>
            </div>

            <div class="temp-item-card">
              <div class="temp-position-name">右外机翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">常加:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor2?.outerWingConst, 1) }} ℃</span>
                <span class="temp-tag pl">加热:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor2?.outerWingHeat, 1) }} ℃</span>
              </div>
            </div>

            <div class="temp-item-card">
              <div class="temp-position-name">右尾翼</div>
              <div class="temp-dual-data">
                <span class="temp-tag">平尾:</span>
                <span class="temp-val">{{ formatFixed(currentPayload?.tempSensor2?.horizontalTail, 1) }} ℃</span>
                <span class="temp-tag pl">垂尾:</span>
                <span class="temp-val highlight">{{ formatFixed(currentPayload?.tempSensor2?.verticalTail, 1) }} ℃</span>
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

export interface RelayChannelDef {
  id: number
  name: string
  group: 'wing' | 'tail' | 'payload'
}

// 16 路回路真实物理名称
const ALL_CHANNELS: RelayChannelDef[] = [
  { id: 1, name: '右平尾加热膜', group: 'tail' },
  { id: 2, name: '右垂尾加热膜', group: 'tail' },
  { id: 3, name: '右内机翼加热膜', group: 'wing' },
  { id: 4, name: '右中机翼加热膜', group: 'wing' },
  { id: 5, name: '右外机翼加热膜', group: 'wing' },
  { id: 6, name: '左垂尾加热膜', group: 'tail' },
  { id: 7, name: '左平尾加热膜', group: 'tail' },
  { id: 8, name: '机翼常加热膜', group: 'wing' },
  { id: 9, name: '左内机翼加热膜', group: 'wing' },
  { id: 10, name: '左中机翼加热膜', group: 'wing' },
  { id: 11, name: '左外机翼加热膜', group: 'wing' },
  { id: 12, name: '大气测量加温', group: 'payload' },
  { id: 13, name: '云滴探测加温', group: 'payload' },
  { id: 14, name: '电源设备供电', group: 'payload' },
  { id: 15, name: '桨叶防除冰', group: 'payload' },
  { id: 16, name: '备用通道', group: 'payload' },
]

const wingChannels = ALL_CHANNELS.filter((c) => c.group === 'wing')
const tailChannels = ALL_CHANNELS.filter((c) => c.group === 'tail')
const payloadChannels = ALL_CHANNELS.filter((c) => c.group === 'payload')

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

async function handleToggleRelay(index: number, enabled: boolean) {
  loadingSwitch.value = index
  const ch = ALL_CHANNELS[index - 1]
  const name = ch ? ch.name : `回路${index}`
  try {
    await payloadStore.sendRelayControl(index, enabled)
    message.success(`已下发: ${name} [${enabled ? '通电' : '断开'}]`)
  } catch (e: any) {
    message.error(`控制 ${name} 失败: ${e}`)
  } finally {
    loadingSwitch.value = null
  }
}

async function handleSetAll(enabled: boolean) {
  try {
    const mask = enabled ? 0xFFFF : 0x0000
    await payloadStore.sendRelayBatch(mask)
    message.success(`已下发全部 [${enabled ? '通电' : '断开'}]`)
  } catch (e: any) {
    message.error(`操作失败: ${e}`)
  }
}

async function handleRefreshRelay() {
  loadingQuery.value = true
  try {
    await payloadStore.queryRelayStatus()
    message.info('已发送回路状态巡检指令')
  } catch (e: any) {
    message.error(`巡检失败: ${e}`)
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
.payload-panel-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 顶部状态概览条 */
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
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 500;
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

.mask-code {
  font-size: 12px;
  font-family: monospace;
  color: var(--text-tertiary);
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

.heating-status-tag {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

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

.action-btn {
  background: var(--surface-secondary);
  border: 1px solid var(--border-heavy);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.action-btn.btn-on {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(16, 163, 127, 0.1);
}

.action-btn.btn-on:hover:not(:disabled) {
  background: rgba(16, 163, 127, 0.2);
}

.action-btn.btn-off {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}

.action-btn.btn-off:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
}

/* 回路分组布局：彻底消灭拥挤感 */
.circuit-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.circuit-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  padding-left: 2px;
}

.circuit-cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 860px) {
  .circuit-cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.circuit-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  transition: all 0.2s ease;
}

.circuit-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.circuit-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.circuit-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.circuit-btn {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border-heavy);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.circuit-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

/* 通电高亮态 */
.circuit-card.is-on {
  background: rgba(16, 163, 127, 0.08);
  border-color: rgba(16, 163, 127, 0.35);
}

.circuit-card.is-on .circuit-dot {
  background: var(--accent-green);
  box-shadow: 0 0 6px rgba(16, 163, 127, 0.8);
}

.circuit-card.is-on .circuit-name {
  color: var(--text-primary);
  font-weight: 600;
}

.circuit-card.is-on .circuit-btn {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}

.circuit-card.is-on .circuit-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--accent-red);
}

/* 双列指标 */
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

/* Stat Box 卡片 */
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
}

.stat-number-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-number-text.text-danger {
  color: var(--accent-red);
}

.stat-unit {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.stat-footer {
  font-size: 10px;
  margin-top: 2px;
}

.text-danger {
  color: var(--accent-red);
}

/* 机翼采温对称布局 */
.wing-temp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 800px) {
  .wing-temp-grid {
    grid-template-columns: 1fr;
  }
}

.wing-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.column-subtitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  padding-left: 2px;
}

.column-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.temp-item-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.temp-position-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.temp-dual-data {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 12px;
}

.temp-tag {
  font-size: 10px;
  color: var(--text-tertiary);
}

.temp-tag.pl {
  margin-left: 4px;
}

.temp-val {
  font-family: monospace;
  font-weight: 700;
  color: var(--text-primary);
}

.temp-val.highlight {
  color: #38bdf8;
}
</style>
