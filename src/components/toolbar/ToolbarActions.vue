<template>
  <n-space class="panel-toolbar989834y34" :class="{ open: !barIsOpen }">
    <n-row justify-content="space-between">
      <!-- 图层管理 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('manageLayer')">
            <template #icon>
              <n-icon><Layers /></n-icon>
            </template>
          </n-button>
        </template>
        <span>图层管理</span>
      </n-tooltip>

      <!-- 标记点 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            type="warning"
            aria-label="标记点"
            @click="$emit('openMarkerPointsPanel')"
          >
            <template #icon>
              <n-icon><LocationOutline /></n-icon>
            </template>
          </n-button>
        </template>
        标记点
      </n-tooltip>

      <!-- 添加数据 -->
      <n-dropdown :options="dataOptions" @select="$emit('selectData', $event)">
        <n-button tertiary circle type="warning">
          <template #icon>
            <n-icon><DuplicateSharp /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 航线 -->
      <n-dropdown
        :options="editOptions"
        @select="$emit('selectEdit', $event)"
      >
        <n-button tertiary circle type="warning">
          <template #icon>
            <n-icon><CreateOutline /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 测量 -->
      <n-dropdown
        :options="measureOptions"
        @select="$emit('selectMeasure', $event)"
      >
        <n-button tertiary type="warning">
          <template #icon>
            <n-icon><RulerAlt /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 标绘 -->
      <n-dropdown
        :options="drawOptions"
        @select="$emit('selectDraw', $event)"
      >
        <n-button tertiary circle type="warning">
          <template #icon>
            <n-icon><DrawPolygon /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 禁飞区 -->
      <n-dropdown
        :options="nfzOptions"
        trigger="hover"
        @select="$emit('selectNfz', $event)"
      >
        <n-tooltip placement="bottom" trigger="hover">
          <template #trigger>
            <n-button
              tertiary
              circle
              :type="showNFZ ? 'error' : 'warning'"
              :loading="nfzLoading"
              @click="$emit('hideNfz')"
            >
              <template #icon>
                <n-icon v-if="showNFZ"><ShieldCheckmark /></n-icon>
                <n-icon v-else><ShieldOutline /></n-icon>
              </template>
            </n-button>
          </template>
        </n-tooltip>
      </n-dropdown>

      <!-- 模拟电子围栏 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            :type="simulatedFenceVisible ? 'error' : 'warning'"
            @click="$emit('toggleSimulatedFence')"
          >
            <template #icon>
              <n-icon><ShieldOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>
          {{ simulatedFenceVisible ? '隐藏模拟电子围栏' : '模拟电子围栏' }}
        </span>
      </n-tooltip>

      <!-- 通信设置 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('openUdpSettings')">
            <template #icon>
              <n-icon><Settings /></n-icon>
            </template>
          </n-button>
        </template>
        <span>通信设置</span>
      </n-tooltip>

      <!-- 模拟飞行 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('toggleMockFlight')">
            <template #icon>
              <n-icon><CaretForwardCircleOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>模拟飞行</span>
      </n-tooltip>

      <!-- 模拟飞机导引 -->
      <n-dropdown
        :options="guidanceMenuOptions"
        @select="$emit('selectGuidance', $event)"
      >
        <n-tooltip placement="bottom" trigger="hover">
          <template #trigger>
            <n-button
              tertiary
              circle
              :type="guidanceActive ? 'success' : 'warning'"
              aria-label="模拟飞机导引"
            >
              <template #icon>
                <n-icon><NavigateOutline /></n-icon>
              </template>
            </n-button>
          </template>
          <span>模拟飞机导引</span>
        </n-tooltip>
      </n-dropdown>

      <!-- 高度预警 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            :type="terrainWarningActive ? 'error' : 'warning'"
            @click="$emit('toggleTerrainWarning')"
          >
            <template #icon>
              <n-icon><AlertCircleOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>
          {{ terrainWarningActive ? '关闭高度预警' : '开启高度预警' }}
        </span>
      </n-tooltip>

      <!-- 三维伴飞 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            :type="companionMode ? 'success' : 'warning'"
            @click="$emit('toggleCompanionMode')"
          >
            <template #icon>
              <n-icon><Airplane /></n-icon>
            </template>
          </n-button>
        </template>
        <span>
          {{ companionMode ? '关闭三维伴飞' : '开启三维伴飞' }}
        </span>
      </n-tooltip>

      <!-- 机场周边障碍物 -->
      <n-dropdown
        :options="obstacleLoadingOptions"
        @select="$emit('selectObstacle', $event)"
      >
        <n-button tertiary circle type="warning">
          <template #icon>
            <n-icon><HomeSharp /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 链路状态 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('showLinkHealth')">
            <template #icon>
              <n-icon><PulseOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>链路状态</span>
      </n-tooltip>

      <!-- 航电信息 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('showTelemetry')">
            <template #icon>
              <n-icon><InformationCircleOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>航电信息</span>
      </n-tooltip>

      <!-- 吊舱控制 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('showPod')">
            <template #icon>
              <n-icon><VideocamOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>吊舱控制</span>
      </n-tooltip>

      <!-- 航线通视分析 -->
      <n-dropdown :options="losAnalyzeOptions" @select="$emit('selectLosAnalyse', $event)">
        <n-button tertiary type="warning">
          <template #icon>
            <n-icon><RadioOutline /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 视图设置 -->
      <n-dropdown
        :options="viewSettingsOptions"
        @select="$emit('selectViewSettings', $event)"
      >
        <n-button
          tertiary
          circle
          :type="viewSettingsActive ? 'success' : 'warning'"
          :loading="viewSettingsLoading"
          title="视图设置"
          aria-label="视图设置"
        >
          <template #icon>
            <n-icon><EarthOutline /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 刷新页面 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="handleRefresh">
            <template #icon>
              <n-icon><ReloadSharp /></n-icon>
            </template>
          </n-button>
        </template>
        <span>刷新页面</span>
      </n-tooltip>

      <!-- 最小化程序 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="$emit('minimizeApp')">
            <template #icon>
              <n-icon><RemoveOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>最小化</span>
      </n-tooltip>

      <!-- 关闭程序 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="error" @click="$emit('closeApp')">
            <template #icon>
              <n-icon><CloseOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>关闭程序</span>
      </n-tooltip>

      <!-- 收起/展开工具条 -->
      <n-button tertiary circle type="warning" @click="barIsOpen = !barIsOpen">
        <template #icon>
          <n-icon v-if="barIsOpen"><ChevronBack /></n-icon>
          <n-icon v-else><ChevronForward /></n-icon>
        </template>
      </n-button>
    </n-row>
  </n-space>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  NSpace,
  NRow,
  NTooltip,
  NButton,
  NIcon,
  NDropdown,
} from 'naive-ui'
import {
  ChevronBack,
  ChevronForward,
  CreateOutline,
  DuplicateSharp,
  Layers,
  Settings,
  ReloadSharp,
  HomeSharp,
  CloseOutline,
  ShieldCheckmark,
  ShieldOutline,
  Airplane,
  RemoveOutline,
  InformationCircleOutline,
  AlertCircleOutline,
  EarthOutline,
  CaretForwardCircleOutline,
  PulseOutline,
  LocationOutline,
  RadioOutline,
  NavigateOutline,
  VideocamOutline,
} from '@vicons/ionicons5'
import { RulerAlt } from '@vicons/carbon'
import { DrawPolygon } from '@vicons/fa'

defineProps<{
  dataOptions: any[]
  editOptions: any[]
  measureOptions: any[]
  drawOptions: any[]
  nfzOptions: any[]
  showNFZ: boolean
  nfzLoading: boolean
  simulatedFenceVisible: boolean
  guidanceMenuOptions: any[]
  guidanceActive: boolean
  terrainWarningActive: boolean
  companionMode: boolean
  obstacleLoadingOptions: any[]
  losAnalyzeOptions: any[]
  viewSettingsOptions: any[]
  viewSettingsActive: boolean
  viewSettingsLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'manageLayer'): void
  (e: 'openMarkerPointsPanel'): void
  (e: 'selectData', key: string): void
  (e: 'selectEdit', key: string): void
  (e: 'selectMeasure', key: string): void
  (e: 'selectDraw', key: string): void
  (e: 'selectNfz', key: string | number): void
  (e: 'hideNfz'): void
  (e: 'toggleSimulatedFence'): void
  (e: 'openUdpSettings'): void
  (e: 'toggleMockFlight'): void
  // 事件名，参数类型 ：返回值类型
  (e: 'selectGuidance', key: string | number): void
  (e: 'toggleTerrainWarning'): void
  (e: 'toggleCompanionMode'): void
  (e: 'selectObstacle', key: string): void
  (e: 'showLinkHealth'): void
  (e: 'showTelemetry'): void
  (e: 'showPod'): void
  (e: 'selectLosAnalyse', key: string): void
  (e: 'selectViewSettings', key: string | number): void
  (e: 'refreshPage'): void
  (e: 'minimizeApp'): void
  (e: 'closeApp'): void
}>()

const barIsOpen = ref(true)

function handleRefresh() {
  emit('refreshPage')
}
</script>

<style scoped>
.panel-toolbar989834y34 {
  position: absolute;
  top: 10px;
  left: 2px;
  background: rgb(21 21 21 / 94%);
  border-radius: 7px;
  transition: left 0.3s;
  z-index: 100;
}

.panel-toolbar989834y34.open {
  position: absolute;
  left: -25rem;
}
</style>
