<template>
  <div class="payload-panel">
    <!-- 头部栏 -->
    <div class="panel-header">
      <div class="title-group">
        <span class="main-title">MISSION PAYLOAD</span>
        <span class="sub-title">任务载荷与继电器控制</span>
      </div>
      <div class="header-actions">
        <n-button size="tiny" type="info" ghost @click="handleRefreshRelay">
          刷新继电器状态
        </n-button>
        <span
          class="status-pill"
          :class="{ active: hasData, offline: !hasData }"
        >
          {{ hasData ? 'ONLINE' : 'OFFLINE' }}
        </span>
      </div>
    </div>

    <!-- 主体区域 -->
    <div class="panel-body">
      <!-- 结冰状态警报卡片 -->
      <section class="section-card icing-card">
        <div class="card-title">结冰传感器状态 (0xC5)</div>
        <div class="icing-grid">
          <div class="icing-item">
            <span class="label">结冰等级</span>
            <span class="value-badge" :class="icingDesc.level">
              {{ icingDesc.text }}
            </span>
          </div>
          <div class="icing-item">
            <span class="label">加热状态</span>
            <span
              class="value-badge"
              :class="{
                warning: currentPayload?.icingSensor?.heatingActive,
                normal: !currentPayload?.icingSensor?.heatingActive,
              }"
            >
              {{ currentPayload?.icingSensor?.heatingActive ? '加热中' : '未加热' }}
            </span>
          </div>
          <div class="icing-item">
            <span class="label">探测器状态</span>
            <span
              class="value-badge"
              :class="{
                danger: currentPayload?.icingSensor?.detectorFault,
                normal: !currentPayload?.icingSensor?.detectorFault,
              }"
            >
              {{ currentPayload?.icingSensor?.detectorFault ? '故障' : '正常' }}
            </span>
          </div>
          <div class="icing-item">
            <span class="label">固件版本</span>
            <span class="value-text">
              V{{ currentPayload?.icingSensor?.versionMajor ?? '-' }}.{{ currentPayload?.icingSensor?.versionMinor ?? '-' }}
            </span>
          </div>
        </div>
      </section>

      <!-- 16路继电器控制面板 -->
      <section class="section-card relay-card">
        <div class="card-title-row">
          <span class="card-title">继电器控制器 (0xC3 - 16路)</span>
          <div class="quick-buttons">
            <n-button size="tiny" type="success" ghost @click="handleSetAll(true)">
              全开 (0xFFFF)
            </n-button>
            <n-button size="tiny" type="warning" ghost @click="handleSetAll(false)">
              全关 (0x0000)
            </n-button>
          </div>
        </div>

        <div class="relay-grid">
          <div
            v-for="index in 16"
            :key="index"
            class="relay-box"
            :class="{ closed: isRelayClosed(index) }"
          >
            <div class="relay-num">#{{ index }}</div>
            <div class="relay-state">
              {{ isRelayClosed(index) ? '闭合' : '断开' }}
            </div>
            <n-switch
              size="small"
              :value="isRelayClosed(index)"
              :loading="loadingSwitch === index"
              @update:value="(val) => handleToggleRelay(index, val)"
            />
          </div>
        </div>
      </section>

      <!-- 100V 升压与环境传感器 -->
      <div class="dual-columns">
        <!-- 100V 升压模块 -->
        <section class="section-card half-card">
          <div class="card-title">100V 升压模块 (0xC4-01)</div>
          <div class="param-rows">
            <div class="param-row">
              <span>输入电压 / 电流:</span>
              <span class="param-val">
                {{ formatNumber(currentPayload?.boostModule?.inputVoltage) }} V /
                {{ formatNumber(currentPayload?.boostModule?.inputCurrent) }} A
              </span>
            </div>
            <div class="param-row">
              <span>输出电压 / 电流:</span>
              <span class="param-val highlight">
                {{ formatNumber(currentPayload?.boostModule?.outputVoltage) }} V /
                {{ formatNumber(currentPayload?.boostModule?.outputCurrent) }} A
              </span>
            </div>
            <div class="param-row">
              <span>模块温度:</span>
              <span class="param-val">
                {{ formatNumber(currentPayload?.boostModule?.temperature) }} ℃
              </span>
            </div>
          </div>
        </section>

        <!-- 温湿度气压传感器 -->
        <section class="section-card half-card">
          <div class="card-title">温湿度气压 (0xC4-07)</div>
          <div class="param-rows">
            <div class="param-row">
              <span>环境温度:</span>
              <span class="param-val">
                {{ formatNumber(currentPayload?.environmentSensor?.temperature) }} ℃
              </span>
            </div>
            <div class="param-row">
              <span>相对湿度:</span>
              <span class="param-val">
                {{ formatNumber(currentPayload?.environmentSensor?.humidity) }} %RH
              </span>
            </div>
            <div class="param-row">
              <span>大气压强:</span>
              <span class="param-val">
                {{ formatNumber(currentPayload?.environmentSensor?.pressure) }} kPa
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- 翼面加热膜与温度采温概览 -->
      <section class="section-card">
        <div class="card-title">翼面加热膜温控采温 (0xC4-02/03)</div>
        <div class="temp-grid">
          <div class="temp-cell">
            <span class="temp-label">左内常加 / 加热</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor1?.innerWingConst) }} /
              {{ formatNumber(currentPayload?.tempSensor1?.innerWingHeat) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">右内常加 / 加热</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor2?.innerWingConst) }} /
              {{ formatNumber(currentPayload?.tempSensor2?.innerWingHeat) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">左中常加 / 加热</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor1?.midWingConst) }} /
              {{ formatNumber(currentPayload?.tempSensor1?.midWingHeat) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">右中常加 / 加热</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor2?.midWingConst) }} /
              {{ formatNumber(currentPayload?.tempSensor2?.midWingHeat) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">左外常加 / 加热</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor1?.outerWingConst) }} /
              {{ formatNumber(currentPayload?.tempSensor1?.outerWingHeat) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">右外常加 / 加热</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor2?.outerWingConst) }} /
              {{ formatNumber(currentPayload?.tempSensor2?.outerWingHeat) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">左平尾 / 左垂尾</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor1?.horizontalTail) }} /
              {{ formatNumber(currentPayload?.tempSensor1?.verticalTail) }} ℃
            </span>
          </div>
          <div class="temp-cell">
            <span class="temp-label">右平尾 / 右垂尾</span>
            <span class="temp-val">
              {{ formatNumber(currentPayload?.tempSensor2?.horizontalTail) }} /
              {{ formatNumber(currentPayload?.tempSensor2?.verticalTail) }} ℃
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { NButton, NSwitch, useMessage } from 'naive-ui'
import { usePayloadStore } from '@/store/payloadStore'

const payloadStore = usePayloadStore()
const message = useMessage()

const currentPayload = computed(() => payloadStore.currentPayload)
const hasData = computed(() => currentPayload.value !== null)
const icingDesc = computed(() => payloadStore.icingDesc)
const loadingSwitch = ref<number | null>(null)

function isRelayClosed(index: number): boolean {
  const channels = payloadStore.relayStatus?.channels
  if (!channels || index < 1 || index > 16) return false
  return Boolean(channels[index - 1])
}

function formatNumber(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return '--'
  return val.toFixed(1)
}

async function handleToggleRelay(index: number, enabled: boolean) {
  loadingSwitch.value = index
  try {
    await payloadStore.sendRelayControl(index, enabled)
    message.success(`继电器 #${index} 指令已下发: ${enabled ? '闭合' : '断开'}`)
  } catch (e: any) {
    message.error(`下发继电器 #${index} 失败: ${e}`)
  } finally {
    loadingSwitch.value = null
  }
}

async function handleSetAll(enabled: boolean) {
  try {
    const mask = enabled ? 0xFFFF : 0x0000
    await payloadStore.sendRelayBatch(mask)
    message.success(`已下发一键${enabled ? '全开' : '全关'}指令`)
  } catch (e: any) {
    message.error(`一键设置失败: ${e}`)
  }
}

async function handleRefreshRelay() {
  try {
    await payloadStore.queryRelayStatus()
    message.info('已下发继电器状态查询指令')
  } catch (e: any) {
    message.error(`查询失败: ${e}`)
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
.payload-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  background: #11141a;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.title-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.main-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #38bdf8;
}

.sub-title {
  font-size: 13px;
  color: #94a3b8;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}

.status-pill.active {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.4);
}

.status-pill.offline {
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-card {
  background: #1a1f2c;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 14px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: #cbd5e1;
  margin-bottom: 10px;
}

.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-title-row .card-title {
  margin-bottom: 0;
}

.quick-buttons {
  display: flex;
  gap: 8px;
}

/* 结冰卡片 */
.icing-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.icing-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px 12px;
  border-radius: 6px;
}

.icing-item .label {
  font-size: 11px;
  color: #94a3b8;
}

.value-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
  width: fit-content;
}

.value-badge.normal {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.value-badge.warning {
  background: rgba(234, 179, 8, 0.15);
  color: #facc15;
}

.value-badge.danger {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.value-badge.offline {
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
}

.value-text {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
}

/* 继电器网格 */
.relay-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
}

.relay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  transition: all 0.2s ease;
}

.relay-box.closed {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}

.relay-num {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
}

.relay-state {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
}

.relay-box.closed .relay-state {
  color: #4ade80;
}

/* 双列卡片 */
.dual-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.half-card {
  margin-bottom: 0;
}

.param-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
}

.param-val {
  font-weight: 600;
  color: #e2e8f0;
}

.param-val.highlight {
  color: #38bdf8;
}

/* 采温网格 */
.temp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.temp-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.temp-label {
  font-size: 11px;
  color: #94a3b8;
}

.temp-val {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
}
</style>
