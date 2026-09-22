<template>
  <div class="avionics-payload-panel">
    <!-- 顶部状态与回路总控条 -->
    <section class="section-card overview-section" @mousedown.stop>
      <div class="overview-grid">
        <!-- 结冰综合诊断 -->
        <div class="overview-item">
          <span class="overview-label">结冰状态与告警诊断 (0xC5)</span>
          <div class="overview-value-row">
            <span class="health-badge" :class="icingHealthClass">
              <span class="dot"></span>
              {{ icingDesc.text }}
            </span>
            <span
              v-if="currentPayload?.icingSensor?.heatingActive"
              class="tag-heating"
            >
              探头电加热
            </span>
          </div>
        </div>

        <!-- 供电回路状态统计 -->
        <div class="overview-item">
          <span class="overview-label">16 路加热回路闭合统计 (0xC3)</span>
          <div class="overview-value-row">
            <span class="mode-badge" :class="relaySummaryClass">
              通电回路: {{ closedRelayCount }} / 16
            </span>
            <span class="sub-code">
              寄存器掩码: {{ formatHex(relayStatus?.mask, 4) }}
            </span>
          </div>
        </div>

        <!-- 回路总控与通信操作 -->
        <div class="overview-item text-right">
          <span class="overview-label">总线控制与巡检操作 (BUS COMMAND)</span>
          <div class="overview-value-row justify-end">
            <button
              class="toolbar-btn"
              type="button"
              :disabled="loadingQuery"
              @click="handleRefreshRelay"
            >
              <span class="btn-dot"></span>
              {{ loadingQuery ? '巡检中...' : '状态巡检' }}
            </button>
            <button
              class="toolbar-btn toolbar-btn-active"
              type="button"
              @click="handleSetAll(true)"
            >
              一键全通电
            </button>
            <button
              class="toolbar-btn toolbar-btn-danger"
              type="button"
              @click="handleSetAll(false)"
            >
              一键全断开
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 16 路防除冰与载荷供电回路控制矩阵 (4x4 航电开关网格) -->
    <section class="section-card" @mousedown.stop>
      <div class="section-header-title">
        <span>防除冰与载荷加热回路控制矩阵 (16通道)</span>
        <span class="section-sub">HEATING CIRCUITS & PAYLOAD RELAY MATRIX (0xC3)</span>
      </div>

      <div class="circuit-grid">
        <div
          v-for="ch in RELAY_CHANNELS"
          :key="ch.id"
          class="circuit-card"
          :class="{
            'circuit-energized': isRelayClosed(ch.id),
            'circuit-deenergized': !isRelayClosed(ch.id),
          }"
        >
          <!-- 航电硬件指示灯 -->
          <div class="circuit-indicator">
            <span class="indicator-led"></span>
          </div>

          <!-- 回路名称与通道编码 -->
          <div class="circuit-info">
            <div class="circuit-name" :title="ch.name">{{ ch.name }}</div>
            <div class="circuit-meta-row">
              <span class="circuit-code">CH-{{ formatPad(ch.id, 2) }}</span>
              <span class="circuit-relay-id">({{ ch.code }})</span>
              <span class="circuit-tag" :class="`tag-${ch.group}`">{{ ch.groupLabel }}</span>
            </div>
          </div>

          <!-- 航电触控开关 -->
          <button
            class="circuit-switch"
            type="button"
            :disabled="loadingSwitch === ch.id"
            @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
          >
            <span v-if="loadingSwitch === ch.id" class="switch-loading">...</span>
            <span v-else class="switch-state-text">
              {{ isRelayClosed(ch.id) ? 'ON 通电' : 'OFF 断开' }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- 双列核心度量：100V 升压电源 + 大气环境与结冰探测 -->
    <div class="metrics-two-column" @mousedown.stop>
      <!-- 100V 升压电源系统 -->
      <section class="section-card metric-panel">
        <div class="section-header-title">
          <span>100V 升压电源转换系统</span>
          <span class="section-sub">100V BOOST CONVERTER (0xC4-01)</span>
        </div>

        <div class="electrical-grid">
          <!-- 28V 输入电压 -->
          <div class="stat-box">
            <span class="stat-label">母线输入电压 (Vin)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.inputVoltage, 1) }}
              </span>
              <span class="stat-unit">V</span>
            </div>
            <div class="stat-footer">28V DC Primary Bus</div>
          </div>

          <!-- 输入电流 -->
          <div class="stat-box">
            <span class="stat-label">母线输入电流 (Iin)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.inputCurrent, 2) }}
              </span>
              <span class="stat-unit">A</span>
            </div>
            <div class="stat-footer">Primary Bus Current</div>
          </div>

          <!-- 100V 输出电压 -->
          <div class="stat-box primary">
            <span class="stat-label">升压输出电压 (Vout)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.outputVoltage, 1) }}
              </span>
              <span class="stat-unit">V</span>
            </div>
            <div class="stat-footer">100V High-Voltage Bus</div>
          </div>

          <!-- 100V 输出电流 -->
          <div class="stat-box secondary">
            <span class="stat-label">负载输出电流 (Iout)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.outputCurrent, 2) }}
              </span>
              <span class="stat-unit">A</span>
            </div>
            <div class="stat-footer">Heating Load Current</div>
          </div>

          <!-- 升压总功率 -->
          <div class="stat-box">
            <span class="stat-label">升压转换功率 (Pout)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ boostPowerText }}
              </span>
              <span class="stat-unit">W</span>
            </div>
            <div class="stat-footer">Vout × Iout Calculated</div>
          </div>

          <!-- 模块温度 -->
          <div class="stat-box" :class="{ 'temp-warning': isBoostTempHigh }">
            <span class="stat-label">模块工作温度 (Temp)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.boostModule?.temperature, 1) }}
              </span>
              <span class="stat-unit">℃</span>
            </div>
            <div class="stat-footer">
              {{ isBoostTempHigh ? '模块超温预警 (>85℃)' : '工作温升正常' }}
            </div>
          </div>
        </div>
      </section>

      <!-- 结冰探测与大气环境指标 -->
      <section class="section-card metric-panel">
        <div class="section-header-title">
          <span>结冰探测与大气环境数据</span>
          <span class="section-sub">ICING DETECTOR & ATMOSPHERE (0xC5 / 0xC4-07)</span>
        </div>

        <div class="electrical-grid">
          <!-- 结冰等级 -->
          <div class="stat-box" :class="{ 'temp-warning': isIcingActive }">
            <span class="stat-label">结冰威胁等级</span>
            <div class="stat-value-group">
              <span class="stat-number-text" :class="{ 'text-danger': isIcingActive }">
                {{ icingDesc.text }}
              </span>
            </div>
            <div class="stat-footer">Level 0~5 Severity</div>
          </div>

          <!-- 探测器状态 -->
          <div class="stat-box">
            <span class="stat-label">结冰探测器健康度</span>
            <div class="stat-value-group">
              <span
                class="stat-number-text"
                :class="{ 'text-danger': currentPayload?.icingSensor?.detectorFault }"
              >
                {{ currentPayload?.icingSensor?.detectorFault ? '硬件故障 (FAULT)' : '探测器正常 (OK)' }}
              </span>
            </div>
            <div class="stat-footer">
              固件 V{{ currentPayload?.icingSensor?.versionMajor ?? '-' }}.{{ currentPayload?.icingSensor?.versionMinor ?? '-' }}
            </div>
          </div>

          <!-- 探头加热 -->
          <div class="stat-box">
            <span class="stat-label">探头防冰加热状态</span>
            <div class="stat-value-group">
              <span class="stat-number-text">
                {{ currentPayload?.icingSensor?.heatingActive ? '加热中 (HEATING)' : '未加热 (STANDBY)' }}
              </span>
            </div>
            <div class="stat-footer">Probe Heater Status</div>
          </div>

          <!-- 大气温度 -->
          <div class="stat-box">
            <span class="stat-label">外部大气温度 (OAT)</span>
            <div class="stat-value-group">
              <span class="stat-number">
                {{ formatFixed(currentPayload?.environmentSensor?.temperature, 1) }}
              </span>
              <span class="stat-unit">℃</span>
            </div>
            <div class="stat-footer">Outside Air Temp</div>
          </div>

          <!-- 相对湿度 -->
          <div class="stat-box">
            <span class="stat-label">环境相对湿度</span>
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
        </div>
      </section>
    </div>

    <!-- 翼面加热膜温控采温矩阵 (左右机翼对称航电仪表) -->
    <section class="section-card" @mousedown.stop>
      <div class="section-header-title">
        <span>机翼与尾翼加热膜温控采温矩阵</span>
        <span class="section-sub">AIRFRAME SURFACE TEMPERATURE MATRIX (0xC4-02 / 0xC4-03)</span>
      </div>

      <div class="airframe-temp-layout">
        <!-- 左侧机翼与尾翼 -->
        <div class="wing-side-panel">
          <div class="wing-side-header">
            <span class="wing-side-dot left"></span>
            <span class="wing-side-title">左机翼与左尾翼 (LEFT AIRFRAME)</span>
          </div>

          <div class="temp-channel-grid">
            <!-- 左内机翼 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">左内机翼</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">常加:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.innerWingConst, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">脉冲:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.innerWingHeat, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>

            <!-- 左中机翼 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">左中机翼</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">常加:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.midWingConst, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">脉冲:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.midWingHeat, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>

            <!-- 左外机翼 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">左外机翼</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">常加:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.outerWingConst, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">脉冲:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.outerWingHeat, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>

            <!-- 左平尾 / 左垂尾 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">左尾翼 (平/垂)</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">平尾:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.horizontalTail, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">垂尾:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor1?.verticalTail, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧机翼与尾翼 -->
        <div class="wing-side-panel">
          <div class="wing-side-header">
            <span class="wing-side-dot right"></span>
            <span class="wing-side-title">右机翼与右尾翼 (RIGHT AIRFRAME)</span>
          </div>

          <div class="temp-channel-grid">
            <!-- 右内机翼 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">右内机翼</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">常加:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.innerWingConst, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">脉冲:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.innerWingHeat, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>

            <!-- 右中机翼 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">右中机翼</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">常加:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.midWingConst, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">脉冲:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.midWingHeat, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>

            <!-- 右外机翼 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">右外机翼</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">常加:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.outerWingConst, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">脉冲:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.outerWingHeat, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
              </div>
            </div>

            <!-- 右平尾 / 右垂尾 -->
            <div class="temp-channel-card">
              <div class="temp-channel-title">右尾翼 (平/垂)</div>
              <div class="temp-dual-values">
                <div class="temp-val-item">
                  <span class="temp-val-label">平尾:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.horizontalTail, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
                <div class="temp-val-item highlight">
                  <span class="temp-val-label">垂尾:</span>
                  <span class="temp-val-num">{{ formatFixed(currentPayload?.tempSensor2?.verticalTail, 1) }}</span>
                  <span class="temp-val-unit">℃</span>
                </div>
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
  id: number // 1 ~ 16
  name: string
  code: string // Y1 ~ Y16
  group: 'wing' | 'tail' | 'payload' | 'special'
  groupLabel: string
}

// 严格根据《任管-载荷上下行协议.docx》图 3 物理定义映射 16 路继电器真实名称与编码
const RELAY_CHANNELS: RelayChannelDef[] = [
  { id: 1, name: '右平尾加热膜供电', code: 'Y1', group: 'tail', groupLabel: '尾翼' },
  { id: 2, name: '右垂尾加热膜供电', code: 'Y2', group: 'tail', groupLabel: '尾翼' },
  { id: 3, name: '右内机翼加热膜供电', code: 'Y3', group: 'wing', groupLabel: '机翼' },
  { id: 4, name: '右中机翼加热膜供电', code: 'Y4', group: 'wing', groupLabel: '机翼' },
  { id: 5, name: '右外机翼加热膜供电', code: 'Y5', group: 'wing', groupLabel: '机翼' },
  { id: 6, name: '左垂尾加热膜供电', code: 'Y6', group: 'tail', groupLabel: '尾翼' },
  { id: 7, name: '左平尾加热膜供电', code: 'Y7', group: 'tail', groupLabel: '尾翼' },
  { id: 8, name: '机翼常加热膜供电', code: 'Y8', group: 'wing', groupLabel: '常加' },
  { id: 9, name: '左内机翼加热膜供电', code: 'Y9', group: 'wing', groupLabel: '机翼' },
  { id: 10, name: '左中机翼加热膜供电', code: 'Y10', group: 'wing', groupLabel: '机翼' },
  { id: 11, name: '左外机翼加热膜供电', code: 'Y11', group: 'wing', groupLabel: '机翼' },
  { id: 12, name: '大气测量-加温供电', code: 'Y12', group: 'payload', groupLabel: '载荷' },
  { id: 13, name: '云滴探测-加温供电', code: 'Y13', group: 'payload', groupLabel: '载荷' },
  { id: 14, name: '电源设备供电', code: 'Y14', group: 'special', groupLabel: '电源' },
  { id: 15, name: '桨叶防除冰控制', code: 'Y15', group: 'special', groupLabel: '防冰' },
  { id: 16, name: '备用通道', code: 'Y16', group: 'special', groupLabel: '备用' },
]

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
  const ch = RELAY_CHANNELS[index - 1]
  const name = ch ? ch.name : `CH-${formatPad(index)}`
  try {
    await payloadStore.sendRelayControl(index, enabled)
    message.success(`已下发指令: ${name} [${enabled ? '通电' : '断开'}]`)
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
    message.success(`已下发一键全部 [${enabled ? '通电' : '断开'}] 指令`)
  } catch (e: any) {
    message.error(`一键控制失败: ${e}`)
  }
}

async function handleRefreshRelay() {
  loadingQuery.value = true
  try {
    await payloadStore.queryRelayStatus()
    message.info('已发送 16 路继电器状态回读巡检指令')
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
.avionics-payload-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 顶部概览栏 */
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

/* 航电模式徽章 */
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

.tag-heating {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.4);
}

/* 顶部工具栏内敛按键 */
.toolbar-btn {
  background: var(--surface-secondary);
  border: 1px solid var(--border-heavy);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  border-color: var(--focus-blue);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn .btn-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--focus-blue);
}

.toolbar-btn-active {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(16, 163, 127, 0.1);
}

.toolbar-btn-active:hover:not(:disabled) {
  background: rgba(16, 163, 127, 0.2);
  border-color: var(--accent-green);
  color: #6ee7b7;
}

.toolbar-btn-danger {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}

.toolbar-btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: var(--accent-red);
  color: #fca5a5;
}

/* 16 路继电器航电控制网格 (4x4 与 alarm-grid 风格呼应) */
.circuit-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 860px) {
  .circuit-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.circuit-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  transition: all 0.2s ease;
}

.circuit-indicator .indicator-led {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: block;
  background: var(--text-tertiary);
  transition: all 0.2s ease;
}

.circuit-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.circuit-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.circuit-meta-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.circuit-code {
  font-size: 10px;
  font-family: monospace;
  font-weight: 700;
  color: var(--text-tertiary);
}

.circuit-relay-id {
  font-size: 10px;
  font-family: monospace;
  color: var(--text-tertiary);
}

.circuit-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
}

.circuit-tag.tag-wing {
  color: #60a5fa;
  background: rgba(37, 99, 235, 0.12);
}

.circuit-tag.tag-tail {
  color: #a78bfa;
  background: rgba(139, 92, 246, 0.12);
}

.circuit-tag.tag-payload {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.12);
}

.circuit-tag.tag-special {
  color: #34d399;
  background: rgba(16, 163, 127, 0.12);
}

/* 航电触控开关按键 */
.circuit-switch {
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid var(--border-heavy);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.circuit-switch:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.circuit-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 闭合通电状态高亮 */
.circuit-card.circuit-energized {
  background: rgba(16, 163, 127, 0.08);
  border-color: rgba(16, 163, 127, 0.35);
  box-shadow: 0 0 12px rgba(16, 163, 127, 0.1);
}

.circuit-card.circuit-energized .indicator-led {
  background: var(--accent-green);
  box-shadow: 0 0 8px rgba(16, 163, 127, 0.8);
}

.circuit-card.circuit-energized .circuit-switch {
  background: rgba(16, 163, 127, 0.18);
  border-color: rgba(16, 163, 127, 0.4);
  color: #34d399;
}

.circuit-card.circuit-energized .circuit-switch:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fca5a5;
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

/* 航电 Stat-Box 结构 */
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
  font-size: 9px;
  color: var(--text-tertiary);
  letter-spacing: 0.2px;
}

/* 机翼加热膜对称采温布局 */
.airframe-temp-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 800px) {
  .airframe-temp-layout {
    grid-template-columns: 1fr;
  }
}

.wing-side-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wing-side-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 2px;
}

.wing-side-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.wing-side-dot.left {
  background: #60a5fa;
}

.wing-side-dot.right {
  background: #34d399;
}

.wing-side-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
}

.temp-channel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.temp-channel-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.temp-channel-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.temp-dual-values {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.temp-val-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.temp-val-label {
  font-size: 10px;
  color: var(--text-tertiary);
}

.temp-val-num {
  font-size: 14px;
  font-weight: 700;
  font-family: monospace;
  color: var(--text-primary);
}

.temp-val-item.highlight .temp-val-num {
  color: #38bdf8;
}

.temp-val-unit {
  font-size: 10px;
  color: var(--text-tertiary);
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
