<template>
  <div class="payload-panel-container">
    <!-- 顶部状态概览与总控操作条 -->
    <section class="section-card overview-card" @mousedown.stop>
      <div class="overview-grid">
        <!-- 最低加热膜温度与位置监视 (严格根据需求实现) -->
        <div class="overview-item">
          <span class="overview-label">全机最低加热膜监视</span>
          <div class="overview-value-row">
            <span class="min-temp-badge" :class="minTempClass">
              <span class="dot"></span>
              {{ formatFixed(payloadStore.minHeatingMat.temp, 1) }} ℃
            </span>
            <span class="min-temp-loc">
              {{ payloadStore.minHeatingMat.location }}
            </span>
          </div>
        </div>

        <!-- 结冰状态诊断 -->
        <div class="overview-item">
          <span class="overview-label">0xC5 结冰探测状态</span>
          <div class="overview-value-row">
            <span class="health-badge" :class="icingHealthClass">
              <span class="dot"></span>
              {{ icingDesc.text }}
            </span>
            <span
              v-if="currentPayload?.icingSensor?.heatingActive"
              class="heating-status-tag"
            >
              探头加热中
            </span>
            <span
              v-if="currentPayload?.icingSensor?.detectorFault"
              class="fault-status-tag"
            >
              探测器故障
            </span>
          </div>
        </div>

        <!-- 继电器回路统计 -->
        <div class="overview-item">
          <span class="overview-label">0xC3 继电器回路状态</span>
          <div class="overview-value-row">
            <span class="mode-badge" :class="relaySummaryClass">
              已闭合: {{ closedRelayCount }} / 16
            </span>
            <span class="mask-code">
              掩码: {{ formatHex(relayStatus?.mask, 4) }}
            </span>
          </div>
        </div>

        <!-- 快捷控制按键 -->
        <div class="overview-item text-right">
          <span class="overview-label">回路控制与巡检</span>
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

    <!-- 航电仪表盘视图导航分栏 -->
    <div class="panel-view-nav" @mousedown.stop>
      <button
        class="nav-tab-btn"
        :class="{ active: currentView === 'matrix' }"
        type="button"
        @click="currentView = 'matrix'"
      >
        <svg class="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 2.5h12v11H2zM2 6.5h12M2 10.5h12M6 2.5v11M10.5 2.5v11" />
        </svg>
        <span>翼面防除冰看板 (温·压·流矩阵)</span>
      </button>

      <button
        class="nav-tab-btn"
        :class="{ active: currentView === 'circuits' }"
        type="button"
        @click="currentView = 'circuits'"
      >
        <svg class="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 1.5v3.5M11 1.5v3.5M3 5h10v2.5a5 5 0 0 1-10 0zM8 12.5V14.5" />
        </svg>
        <span>16路供电回路控制 (0xC3)</span>
      </button>

      <button
        class="nav-tab-btn"
        :class="{ active: currentView === 'power' }"
        type="button"
        @click="currentView = 'power'"
      >
        <svg class="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9.2 1.5L3.8 9h3.1l-.9 5.5L11.4 7H8.3z" />
        </svg>
        <span>电源与系统总线遥测 (0xC4)</span>
      </button>

      <button
        class="nav-tab-btn"
        :class="{ active: currentView === 'all' }"
        type="button"
        @click="currentView = 'all'"
      >
        <svg class="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.8 4h8M5.8 8h8M5.8 12h8M2.2 4h.6M2.2 8h.6M2.2 12h.6" />
        </svg>
        <span>全景平铺视图</span>
      </button>
    </div>

    <!-- ========================================================== -->
    <!-- 视图 1：翼面防除冰矩阵看板（温·电·流一体化对照） -->
    <!-- ========================================================== -->
    <section
      v-if="currentView === 'matrix' || currentView === 'all'"
      class="section-card"
      @mousedown.stop
    >
      <div class="section-header-title">
        <span>翼面与舵面防除冰遥测对照矩阵</span>
        <span class="section-header-sub">左右对称舵面 · 采温 / 供电电压 / 供电电流 严格对齐</span>
      </div>

      <div class="matrix-table-container">
        <table class="avionics-matrix-table">
          <thead>
            <tr>
              <th colspan="3" class="th-group-left">左侧翼面与尾翼 (设备1)</th>
              <th class="th-position">物理位置</th>
              <th colspan="3" class="th-group-right">右侧翼面与尾翼 (设备2)</th>
            </tr>
            <tr class="sub-headers">
              <th class="sub-col">采温 (℃)</th>
              <th class="sub-col">供电电压 (V)</th>
              <th class="sub-col">供电电流 (A)</th>
              <th class="th-pos-name">控制与采温舵面</th>
              <th class="sub-col">采温 (℃)</th>
              <th class="sub-col">供电电压 (V)</th>
              <th class="sub-col">供电电流 (A)</th>
            </tr>
          </thead>
          <tbody>
            <!-- 1. 内机翼 -->
            <tr>
              <td class="td-val">
                <span class="cell-sub" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.innerWingConst) }">常加: {{ formatFixed(currentPayload?.tempSensor1?.innerWingConst, 1) }}</span>
                <span class="cell-main" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.innerWingHeat) }">加热: {{ formatFixed(currentPayload?.tempSensor1?.innerWingHeat, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.leftInnerWing) }">
                {{ formatFixed(currentPayload?.voltageSensor?.leftInnerWing, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor1?.leftInnerWing) }">
                {{ formatFixed(currentPayload?.currentSensor1?.leftInnerWing, 3) }}
              </td>
              <td class="td-position">内机翼</td>
              <td class="td-val">
                <span class="cell-sub" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.innerWingConst) }">常加: {{ formatFixed(currentPayload?.tempSensor2?.innerWingConst, 1) }}</span>
                <span class="cell-main" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.innerWingHeat) }">加热: {{ formatFixed(currentPayload?.tempSensor2?.innerWingHeat, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.rightInnerWing) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rightInnerWing, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor2?.rightInnerWing) }">
                {{ formatFixed(currentPayload?.currentSensor2?.rightInnerWing, 3) }}
              </td>
            </tr>

            <!-- 2. 中机翼 -->
            <tr>
              <td class="td-val">
                <span class="cell-sub" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.midWingConst) }">常加: {{ formatFixed(currentPayload?.tempSensor1?.midWingConst, 1) }}</span>
                <span class="cell-main" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.midWingHeat) }">加热: {{ formatFixed(currentPayload?.tempSensor1?.midWingHeat, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.leftMidWing) }">
                {{ formatFixed(currentPayload?.voltageSensor?.leftMidWing, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor1?.leftMidWing) }">
                {{ formatFixed(currentPayload?.currentSensor1?.leftMidWing, 3) }}
              </td>
              <td class="td-position">中机翼</td>
              <td class="td-val">
                <span class="cell-sub" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.midWingConst) }">常加: {{ formatFixed(currentPayload?.tempSensor2?.midWingConst, 1) }}</span>
                <span class="cell-main" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.midWingHeat) }">加热: {{ formatFixed(currentPayload?.tempSensor2?.midWingHeat, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.rightMidWing) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rightMidWing, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor2?.rightMidWing) }">
                {{ formatFixed(currentPayload?.currentSensor2?.rightMidWing, 3) }}
              </td>
            </tr>

            <!-- 3. 外机翼 -->
            <tr>
              <td class="td-val">
                <span class="cell-sub" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.outerWingConst) }">常加: {{ formatFixed(currentPayload?.tempSensor1?.outerWingConst, 1) }}</span>
                <span class="cell-main" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.outerWingHeat) }">加热: {{ formatFixed(currentPayload?.tempSensor1?.outerWingHeat, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.leftOuterWing) }">
                {{ formatFixed(currentPayload?.voltageSensor?.leftOuterWing, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor1?.leftOuterWing) }">
                {{ formatFixed(currentPayload?.currentSensor1?.leftOuterWing, 3) }}
              </td>
              <td class="td-position">外机翼</td>
              <td class="td-val">
                <span class="cell-sub" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.outerWingConst) }">常加: {{ formatFixed(currentPayload?.tempSensor2?.outerWingConst, 1) }}</span>
                <span class="cell-main" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.outerWingHeat) }">加热: {{ formatFixed(currentPayload?.tempSensor2?.outerWingHeat, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.rightOuterWing) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rightOuterWing, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor2?.rightOuterWing) }">
                {{ formatFixed(currentPayload?.currentSensor2?.rightOuterWing, 3) }}
              </td>
            </tr>

            <!-- 4. 水平尾翼（平尾）- 独立清晰展示 -->
            <tr class="row-highlight">
              <td class="td-val">
                <span class="cell-main cell-tail" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.horizontalTail) }">{{ formatFixed(currentPayload?.tempSensor1?.horizontalTail, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.leftHorizontalTail) }">
                {{ formatFixed(currentPayload?.voltageSensor?.leftHorizontalTail, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor1?.leftHorizontalTail) }">
                {{ formatFixed(currentPayload?.currentSensor1?.leftHorizontalTail, 3) }}
              </td>
              <td class="td-position td-tail-name">
                <span class="badge-tail">平尾</span>
                <span>水平尾翼</span>
              </td>
              <td class="td-val">
                <span class="cell-main cell-tail" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.horizontalTail) }">{{ formatFixed(currentPayload?.tempSensor2?.horizontalTail, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.rightHorizontalTail) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rightHorizontalTail, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor2?.rightHorizontalTail) }">
                {{ formatFixed(currentPayload?.currentSensor2?.rightHorizontalTail, 3) }}
              </td>
            </tr>

            <!-- 5. 垂直尾翼（垂尾）- 独立清晰展示 -->
            <tr class="row-highlight">
              <td class="td-val">
                <span class="cell-main cell-tail" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor1?.verticalTail) }">{{ formatFixed(currentPayload?.tempSensor1?.verticalTail, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.leftVerticalTail) }">
                {{ formatFixed(currentPayload?.voltageSensor?.leftVerticalTail, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor1?.leftVerticalTail) }">
                {{ formatFixed(currentPayload?.currentSensor1?.leftVerticalTail, 3) }}
              </td>
              <td class="td-position td-tail-name">
                <span class="badge-tail vtail">垂尾</span>
                <span>垂直尾翼</span>
              </td>
              <td class="td-val">
                <span class="cell-main cell-tail" :class="{ 'is-min': isMinTemp(currentPayload?.tempSensor2?.verticalTail) }">{{ formatFixed(currentPayload?.tempSensor2?.verticalTail, 1) }}</span>
              </td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.rightVerticalTail) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rightVerticalTail, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor2?.rightVerticalTail) }">
                {{ formatFixed(currentPayload?.currentSensor2?.rightVerticalTail, 3) }}
              </td>
            </tr>


            <!-- 6. 常加热膜 / 低压供电 -->
            <tr class="row-aux">
              <td class="td-val">—</td>
              <td class="td-val" :class="{ 'val-active': hasVoltage(currentPayload?.voltageSensor?.wingConstHeat) }">
                {{ formatFixed(currentPayload?.voltageSensor?.wingConstHeat, 2) }}
              </td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor1?.wingConstHeat) }">
                {{ formatFixed(currentPayload?.currentSensor1?.wingConstHeat, 3) }}
              </td>
              <td class="td-position">常加 / 低压</td>
              <td class="td-val">—</td>
              <td class="td-val">—</td>
              <td class="td-val" :class="{ 'val-active': hasCurrent(currentPayload?.currentSensor2?.lowVoltageSupply) }">
                {{ formatFixed(currentPayload?.currentSensor2?.lowVoltageSupply, 3) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 严格按照协议命名的 4 个电池温度采集 -->
      <div class="battery-strip">
        <div class="battery-strip-title">
          <span>电池温度采集 (协议 6.2 节)</span>
        </div>
        <div class="battery-strip-grid">
          <div class="battery-metric-card" :class="{ 'is-warm': isBatteryWarm(currentPayload?.tempSensor1?.batteryA) }">
            <span class="b-label">电池1温度采集</span>
            <div class="b-val-row">
              <span class="b-val">{{ formatFixed(currentPayload?.tempSensor1?.batteryA, 1) }}</span>
              <span class="b-unit">℃</span>
            </div>
            <span class="b-device">采集设备 1</span>
          </div>

          <div class="battery-metric-card" :class="{ 'is-warm': isBatteryWarm(currentPayload?.tempSensor1?.batteryB) }">
            <span class="b-label">电池2温度采集</span>
            <div class="b-val-row">
              <span class="b-val">{{ formatFixed(currentPayload?.tempSensor1?.batteryB, 1) }}</span>
              <span class="b-unit">℃</span>
            </div>
            <span class="b-device">采集设备 1</span>
          </div>

          <div class="battery-metric-card" :class="{ 'is-warm': isBatteryWarm(currentPayload?.tempSensor2?.batteryA) }">
            <span class="b-label">电池3温度采集</span>
            <div class="b-val-row">
              <span class="b-val">{{ formatFixed(currentPayload?.tempSensor2?.batteryA, 1) }}</span>
              <span class="b-unit">℃</span>
            </div>
            <span class="b-device">采集设备 2</span>
          </div>

          <div class="battery-metric-card" :class="{ 'is-warm': isBatteryWarm(currentPayload?.tempSensor2?.batteryB) }">
            <span class="b-label">电池4温度采集</span>
            <div class="b-val-row">
              <span class="b-val">{{ formatFixed(currentPayload?.tempSensor2?.batteryB, 1) }}</span>
              <span class="b-unit">℃</span>
            </div>
            <span class="b-device">采集设备 2</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ========================================================== -->
    <!-- 视图 2：16 路供电回路控制 (0xC3 继电器) -->
    <!-- ========================================================== -->
    <section
      v-if="currentView === 'circuits' || currentView === 'all'"
      class="section-card"
      @mousedown.stop
    >
      <div class="section-header-title">
        <span>0xC3 继电器控制器：16 路回路控制</span>
        <span class="section-header-sub">严格对应协议图 3 物理控制位置</span>
      </div>

      <div class="circuits-dashboard">
        <!-- 1. 机翼加热回路 -->
        <div class="circuit-block">
          <div class="block-label">
            <span class="block-dot wing-dot"></span>
            <span>机翼加热膜供电回路 (8 路)</span>
          </div>
          <div class="circuit-tiles-grid">
            <div
              v-for="ch in wingChannels"
              :key="ch.id"
              class="circuit-tile"
              :class="{ 'is-closed': isRelayClosed(ch.id) }"
            >
              <div class="tile-header">
                <span class="tile-idx">CH{{ ch.id.toString().padStart(2, '0') }}</span>
                <span class="tile-state">{{ isRelayClosed(ch.id) ? '闭合' : '断开' }}</span>
              </div>
              <div class="tile-name" :title="ch.name">{{ ch.name }}</div>
              <button
                class="tile-btn"
                type="button"
                :disabled="loadingSwitch === ch.id"
                @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
              >
                {{ loadingSwitch === ch.id ? '...' : (isRelayClosed(ch.id) ? '断开' : '通电') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 2. 尾翼加热回路（平尾与垂尾区分明确） -->
        <div class="circuit-block">
          <div class="block-label">
            <span class="block-dot tail-dot"></span>
            <span>尾翼加热膜供电回路 (平尾与垂尾独立控制)</span>
          </div>
          <div class="circuit-tiles-grid">
            <div
              v-for="ch in tailChannels"
              :key="ch.id"
              class="circuit-tile tile-tail"
              :class="{ 'is-closed': isRelayClosed(ch.id) }"
            >
              <div class="tile-header">
                <span class="tile-idx">CH{{ ch.id.toString().padStart(2, '0') }}</span>
                <span class="tile-state">{{ isRelayClosed(ch.id) ? '闭合' : '断开' }}</span>
              </div>
              <div class="tile-name" :title="ch.name">{{ ch.name }}</div>
              <button
                class="tile-btn"
                type="button"
                :disabled="loadingSwitch === ch.id"
                @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
              >
                {{ loadingSwitch === ch.id ? '...' : (isRelayClosed(ch.id) ? '断开' : '通电') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 3. 特种设备与载荷供电回路 -->
        <div class="circuit-block">
          <div class="block-label">
            <span class="block-dot payload-dot"></span>
            <span>载荷加温与特种防冰供电回路 (4 路)</span>
          </div>
          <div class="circuit-tiles-grid">
            <div
              v-for="ch in payloadChannels"
              :key="ch.id"
              class="circuit-tile"
              :class="{ 'is-closed': isRelayClosed(ch.id) }"
            >
              <div class="tile-header">
                <span class="tile-idx">CH{{ ch.id.toString().padStart(2, '0') }}</span>
                <span class="tile-state">{{ isRelayClosed(ch.id) ? '闭合' : '断开' }}</span>
              </div>
              <div class="tile-name" :title="ch.name">{{ ch.name }}</div>
              <button
                class="tile-btn"
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

    <!-- ========================================================== -->
    <!-- 视图 3：电源系统与总线遥测 (0xC4) -->
    <!-- ========================================================== -->
    <div
      v-if="currentView === 'power' || currentView === 'all'"
      class="power-dashboard-layout"
      @mousedown.stop
    >
      <!-- 双列：6.1 升压模块（严格5项，删除功率） + 6.5 温湿度与结冰环境 -->
      <div class="power-top-row">
        <!-- 6.1 升压模块 -->
        <section class="section-card">
          <div class="section-header-title">
            <span>6.1 升压模块 (ID: 01)</span>
            <span class="section-header-sub">严格对应协议定义 5 项指标</span>
          </div>

          <div class="protocol-metrics-grid">
            <div class="p-card">
              <span class="p-label">输入电压</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.boostModule?.inputVoltage, 2) }}</span>
                <span class="p-unit">V</span>
              </div>
            </div>

            <div class="p-card">
              <span class="p-label">输入电流</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.boostModule?.inputCurrent, 2) }}</span>
                <span class="p-unit">A</span>
              </div>
            </div>

            <div class="p-card highlight-box">
              <span class="p-label">输出电压</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.boostModule?.outputVoltage, 2) }}</span>
                <span class="p-unit">V</span>
              </div>
            </div>

            <div class="p-card highlight-box">
              <span class="p-label">输出电流</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.boostModule?.outputCurrent, 2) }}</span>
                <span class="p-unit">A</span>
              </div>
            </div>

            <div class="p-card span-2" :class="{ 'is-warm': isBoostTempHigh }">
              <span class="p-label">温度</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.boostModule?.temperature, 1) }}</span>
                <span class="p-unit">℃</span>
              </div>
              <span v-if="isBoostTempHigh" class="p-alert">超温告警 (>85℃)</span>
            </div>
          </div>
        </section>

        <!-- 6.5 温湿度传感器 + 结冰状态 -->
        <section class="section-card">
          <div class="section-header-title">
            <span>6.5 温湿度气压传感器 (ID: 07) & 结冰环境</span>
          </div>

          <div class="protocol-metrics-grid">
            <div class="p-card">
              <span class="p-label">温度</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.environmentSensor?.temperature, 2) }}</span>
                <span class="p-unit">℃</span>
              </div>
            </div>

            <div class="p-card">
              <span class="p-label">湿度</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.environmentSensor?.humidity, 2) }}</span>
                <span class="p-unit">%RH</span>
              </div>
            </div>

            <div class="p-card span-2">
              <span class="p-label">大气压</span>
              <div class="p-val-row">
                <span class="p-val">{{ formatFixed(currentPayload?.environmentSensor?.pressure, 2) }}</span>
                <span class="p-unit">kPa</span>
              </div>
            </div>

            <div class="p-card">
              <span class="p-label">探测器状态</span>
              <div class="p-status-pill" :class="{ fault: currentPayload?.icingSensor?.detectorFault }">
                {{ currentPayload?.icingSensor?.detectorFault ? '故障' : '正常' }}
              </div>
            </div>

            <div class="p-card">
              <span class="p-label">加热状态</span>
              <div class="p-status-pill" :class="{ heating: currentPayload?.icingSensor?.heatingActive }">
                {{ currentPayload?.icingSensor?.heatingActive ? '加热中' : '未加热' }}
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 6.3 电压采集：系统供电与关键电源电压 (11 路) -->
      <section class="section-card">
        <div class="section-header-title">
          <span>6.3 电压采集模块：电源与特种载荷供电电压 (ID: 04)</span>
          <span class="section-header-sub">严格对应协议定义 11 路供电采样通道</span>
        </div>

        <div class="sys-voltage-grid">
          <div class="v-card">
            <span class="v-name">100V输入电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.v100Input) }">
                {{ formatFixed(currentPayload?.voltageSensor?.v100Input, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">电池输入电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.batteryInput) }">
                {{ formatFixed(currentPayload?.voltageSensor?.batteryInput, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">48V升压模块 电压采集</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.v48BoostModule) }">
                {{ formatFixed(currentPayload?.voltageSensor?.v48BoostModule, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">降压模块 电压采集</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.stepDownModule) }">
                {{ formatFixed(currentPayload?.voltageSensor?.stepDownModule, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">整流器1输入电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.rectifier1Input) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rectifier1Input, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">整流器1后继电器电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.rectifier1PostRelay) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rectifier1PostRelay, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">整流器3 电压采集</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.rectifier3) }">
                {{ formatFixed(currentPayload?.voltageSensor?.rectifier3, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">稳压模块1输出电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.regulator1Output) }">
                {{ formatFixed(currentPayload?.voltageSensor?.regulator1Output, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">稳压模块2输出电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.regulator2Output) }">
                {{ formatFixed(currentPayload?.voltageSensor?.regulator2Output, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">大气测量-加温供电电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.atmosphereHeat) }">
                {{ formatFixed(currentPayload?.voltageSensor?.atmosphereHeat, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>

          <div class="v-card">
            <span class="v-name">云滴探测-加温电压</span>
            <div class="v-val-group">
              <span class="v-val" :class="{ on: hasVoltage(currentPayload?.voltageSensor?.cloudDropHeat) }">
                {{ formatFixed(currentPayload?.voltageSensor?.cloudDropHeat, 2) }}
              </span>
              <span class="v-unit">V</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import { usePayloadStore } from '@/store/payloadStore'

const payloadStore = usePayloadStore()
const message = useMessage()

// 视图切换：matrix (温电流矩阵看板) | circuits (回路控制) | power (电源与遥测) | all (全景)
const currentView = ref<'matrix' | 'circuits' | 'power' | 'all'>('matrix')

export interface RelayChannelDef {
  id: number
  name: string
  group: 'wing' | 'tail' | 'payload'
}

// 16 路回路真实物理名称（100% 严格对应协议图 3 原始名称）
const ALL_CHANNELS: RelayChannelDef[] = [
  { id: 1, name: '右平尾加热膜供电', group: 'tail' },
  { id: 2, name: '右垂尾加热膜供电', group: 'tail' },
  { id: 3, name: '右内机翼加热膜供电', group: 'wing' },
  { id: 4, name: '右中机翼加热膜供电', group: 'wing' },
  { id: 5, name: '右外机翼加热膜供电', group: 'wing' },
  { id: 6, name: '左垂尾加热膜供电', group: 'tail' },
  { id: 7, name: '左平尾加热膜供电', group: 'tail' },
  { id: 8, name: '机翼常加热膜供电', group: 'wing' },
  { id: 9, name: '左内机翼加热膜供电', group: 'wing' },
  { id: 10, name: '左中机翼加热膜供电', group: 'wing' },
  { id: 11, name: '左外机翼加热膜供电', group: 'wing' },
  { id: 12, name: '大气测量-加温供电', group: 'payload' },
  { id: 13, name: '云滴探测-加温供电', group: 'payload' },
  { id: 14, name: '电源设备供电', group: 'payload' },
  { id: 15, name: '桨叶防除冰控制', group: 'payload' },
  { id: 16, name: '空', group: 'payload' },
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

const minTempClass = computed(() => {
  if (payloadStore.minHeatingMat.isCritical) return 'temp-critical'
  if (payloadStore.minHeatingMat.isWarning) return 'temp-warning'
  return 'temp-normal'
})


const isBoostTempHigh = computed(() => {
  const t = currentPayload.value?.boostModule?.temperature
  return typeof t === 'number' && t > 85.0
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

function hasCurrent(val: unknown): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val > 0.05
}

function hasVoltage(val: unknown): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val > 1.0
}

function isMinTemp(val: unknown): boolean {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false
  const min = payloadStore.minHeatingMat.temp
  return min !== null && Math.abs(val - min) < 0.05
}

function isBatteryWarm(val: unknown): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val > 55.0
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
  gap: 12px;
}

/* 顶部总控条 */
.overview-card {
  padding: 12px 16px;
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
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
  letter-spacing: 0.3px;
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
  background: rgba(16, 163, 127, 0.12);
  color: var(--accent-green);
  border: 1px solid rgba(16, 163, 127, 0.3);
}

.health-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-green);
}

.heating-status-tag {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.fault-status-tag {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
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

.action-btn.btn-off {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}

/* 导航分栏 */
.panel-view-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--surface-under);
  border-radius: 6px;
  border: 1px solid var(--border-light);
}

.nav-tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  white-space: nowrap;
}

.nav-tab-btn:hover {
  color: var(--text-primary);
}

.nav-tab-btn.active {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.07);
}

.nav-icon {
  width: 13px;
  height: 13px;
  stroke: currentColor;
  stroke-width: 1.3;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.75;
  flex-shrink: 0;
}

/* 通用面板标题 */
.section-header-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-light);
}

.section-header-title span:first-child {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.3px;
}

.section-header-sub {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 400;
}

/* 航电对照矩阵表 */
.matrix-table-container {
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: rgba(0, 0, 0, 0.15);
}

.avionics-matrix-table {
  width: 100%;
  border-collapse: collapse;
  text-align: center;
  font-size: 12px;
}

.avionics-matrix-table th {
  padding: 8px 10px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-light);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

.th-group-left {
  background: rgba(56, 189, 248, 0.05);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.th-group-right {
  background: rgba(52, 211, 153, 0.05);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.th-position {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: 11px;
  width: 130px;
}

.sub-headers th {
  font-size: 11px;
  color: var(--text-tertiary);
  background: rgba(0, 0, 0, 0.2);
  padding: 6px 8px;
}

.avionics-matrix-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  border-right: 1px solid rgba(255, 255, 255, 0.04);
}

.td-val {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-secondary);
}

.val-active {
  color: #34d399;
  font-weight: 700;
}

.cell-sub {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
}

.cell-main {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.cell-tail {
  font-size: 13px;
  color: var(--text-primary);
}

.cell-main.is-min,
.cell-sub.is-min,
.cell-tail.is-min {
  color: #fbbf24 !important;
  font-weight: 700 !important;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 3px;
  padding: 1px 4px;
  border: 1px solid rgba(245, 158, 11, 0.3);
}


.td-position {
  font-weight: 700;
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.02);
  font-size: 12px;
}

.row-highlight {
  background: rgba(56, 189, 248, 0.03);
}

.td-tail-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.badge-tail {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.badge-tail.vtail {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  border-color: var(--border-default);
}

.row-aux {
  background: rgba(0, 0, 0, 0.1);
  color: var(--text-tertiary);
}

/* 电池条 */
.battery-strip {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}

.battery-strip-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.battery-strip-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.battery-metric-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.battery-metric-card.is-warm {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.06);
}

.b-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.b-val-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.b-val {
  font-size: 20px;
  font-weight: 700;
  font-family: monospace;
  color: var(--text-primary);
}

.b-unit {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.b-device {
  font-size: 10px;
  color: var(--text-tertiary);
}

/* 回路控制面板布局 */
.circuits-dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.circuit-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
}

.block-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.wing-dot {
  background: var(--text-tertiary);
}

.tail-dot {
  background: var(--text-tertiary);
}

.payload-dot {
  background: var(--text-tertiary);
}

.circuit-tiles-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

@media (max-width: 900px) {
  .circuit-tiles-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.circuit-tile {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s ease;
}

.circuit-tile.is-closed {
  background: rgba(16, 163, 127, 0.07);
  border-color: rgba(16, 163, 127, 0.4);
}

.tile-tail.is-closed {
  border-color: rgba(16, 163, 127, 0.4);
  background: rgba(16, 163, 127, 0.07);
}

.tile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tile-idx {
  font-size: 10px;
  font-family: monospace;
  color: var(--text-tertiary);
  font-weight: 700;
}

.tile-state {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
}

.circuit-tile.is-closed .tile-state {
  color: #34d399;
}

.tile-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-btn {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--border-heavy);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.tile-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

.circuit-tile.is-closed .tile-btn {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

.circuit-tile.is-closed .tile-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
}

/* 电源系统布局 */
.power-dashboard-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.power-top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 860px) {
  .power-top-row {
    grid-template-columns: 1fr;
  }
}

.protocol-metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.p-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.p-card.span-2 {
  grid-column: span 2;
}

.p-card.is-warm {
  border-left: 3px solid var(--accent-red);
  background: rgba(239, 68, 68, 0.08);
}

.p-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

.p-val-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.p-val {
  font-size: 17px;
  font-weight: 700;
  font-family: monospace;
  color: var(--text-primary);
}

.p-unit {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.p-alert {
  font-size: 10px;
  color: var(--accent-red);
  font-weight: 700;
}

.p-status-pill {
  font-size: 12px;
  font-weight: 700;
  color: #34d399;
}

.p-status-pill.fault {
  color: var(--accent-red);
}

.p-status-pill.heating {
  color: #fbbf24;
}

/* 系统供电电压 11 路矩阵 */
.sys-voltage-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

@media (max-width: 900px) {
  .sys-voltage-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.v-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.v-name {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.v-val-group {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.v-val {
  font-size: 15px;
  font-weight: 700;
  font-family: monospace;
  color: var(--text-tertiary);
}

.v-val.on {
  color: #34d399;
}

.v-unit {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
}
</style>
