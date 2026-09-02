<!--
  文件描述：工具条编排容器组件 (Toolbar Container)
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  NButton,
  NFlex,
  NCollapseTransition,
  useMessage,
} from 'naive-ui'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

import { useStaticStore } from '@/store/staticStore'
import { useUavStore } from '@/store/uavStore'
import { useLayerStore } from '@/store/layerManagerStore'
import { useRouteStore } from '@/store/RouteStore'
import { getUnicode } from '@/types/entityoptions'
import RouteManageViewer from '@/core/gis/RouteManageViewer'
import { useMarkObstacle } from '@/hooks/useMarkObstacle'
import { isTauri } from '@/utils/homeWindowData'
import {
  exitApplicationOnClose,
  restoreTelemetryWindow,
  telemetryWindowOptions,
} from '@/utils/telemetryWindow'
import {
  linkHealthWindowOptions,
  restoreLinkHealthWindow,
} from '@/utils/linkHealthWindow'

// 引入拆解的 Composables
import { useDataImporter } from '@/composables/useDataImporter'
import { useAircraftCompanion } from '@/composables/useAircraftCompanion'
import { useSimulatedFence } from '@/composables/useSimulatedFence'
import { useCommsSettings } from '@/composables/useCommsSettings'
import { useTerrainWarningProfile } from '@/composables/useTerrainWarningProfile'
import { useToolbarTelemetrySync } from '@/composables/useToolbarTelemetrySync'
import { useToolbarLosAnalyse } from '@/composables/useToolbarLosAnalyse'
import { useToolbarViewLayers } from '@/composables/useToolbarViewLayers'

// 引入拆解的子组件
import ToolbarActions from './toolbar/ToolbarActions.vue'
import CommsConfigModal from './toolbar/CommsConfigModal.vue'
import WsConfigModal from './toolbar/WsConfigModal.vue'
import TerrainWarningPanel from './toolbar/TerrainWarningPanel.vue'
import SimulatedFencePanel from './toolbar/SimulatedFencePanel.vue'
import AirportObstacleModal from './toolbar/AirportObstacleModal.vue'

// 引入其他已有弹窗组件
import SpatialAnalysis from '@/components/SpatialAnalysis.vue'
import LayerManager from '@/components/LayerManager.vue'
import CollisionDetection from './CollisionDetection.vue'
import AltitudeWarning from './AltitudeWarning.vue'
import RouteOptions from '@/components/RouteOptions.vue'
import MarkerDialog from '@/components/MarkerDialog.vue'
import MarkerPointsPanel from '@/components/MarkerPointsPanel.vue'
import LosAnalyseOptions from './LosAnalyseOptions.vue'

const emit = defineEmits(['resizeMap'])
const message = useMessage()
const store = useStaticStore()
const uavStore = useUavStore()
const lStore = useLayerStore()
const routeStore = useRouteStore()

const spatialAnalyse = ref<any>(null)
const layerManager = ref<any>(null)
const collisionDetection = ref<any>(null)
const markerDialog = ref<any>(null)
const markerPointsPanel = ref<any>(null)

const showModal = ref(false)
const showRouteModal = ref(false)
const showAirportModal = ref(false)

// 1. 数据导入
const { dataOptions, handleDataSelect } = useDataImporter()

// 2. 飞机伴飞
const { companionMode, activeCompanionMode, stopCompanionMode } = useAircraftCompanion()

// 3. 模拟电子围栏
const {
  simulatedFenceVisible,
  simulatedFenceResults,
  simulatedFence,
  toggleSimulatedFence,
  toggleMockFlight,
} = useSimulatedFence()

// 4. 通信设置
const {
  showUdpModal,
  interfaceOptions,
  portOptions,
  openUdpSettings,
  handleSaveConfig,
  addCommunicationLink,
  updateCommunicationLinkKind,
  removeCommunicationLink,
} = useCommsSettings()

// 5. 地形剖面与高度预警
const {
  terrainWarningTargetLabel,
  terrainWarningDistance,
  terrainWarningClearance,
  terrainWarningDistanceInput,
  terrainWarningClearanceInput,
  terrainWarningActive,
  terrainWarningIsDanger,
  terrainPolylinePoints,
  flightPolylinePoints,
  profileMinHeightLabel,
  profileMaxHeightLabel,
  terrainWarningAircraftHeight,
  terrainWarningStatusText,
  updateTerrainWarningDistance,
  updateTerrainWarningClearance,
  restoreTerrainWarningInputs,
  toggleSelectedPlaneTerrainWarning,
} = useTerrainWarningProfile()

// 6. 遥测同步与碰撞检测
const {
  altitudeWarningResult,
  showDetection,
  detectDivHeight,
  shutDownDetec,
  connectWebSocket,
  closeWS,
} = useToolbarTelemetrySync(emit, collisionDetection)

// 7. 通视分析
const {
  showLosAnalyseModal,
  losAnalyzeOptions,
  handleLosAnalyseSelect,
  isRouteVisiable,
} = useToolbarLosAnalyse(message)

// 8. 视图设置与禁飞区
const {
  viewSettingsLoading,
  viewSettingsOptions,
  viewSettingsActive,
  handleViewSettingsSelect,
  showNFZ,
  nfzLoading,
  nfzOptions,
  handleNFZSelect,
  hideNFZ,
} = useToolbarViewLayers(message)

// 9. 机场障碍物
const { toggleObstaclesVisible, destroy: destroyObstacles } = useMarkObstacle()
const obstacleVisible = ref(false)
const obstacleLoadingOptions = computed(() =>
  store.menuOptions.obstacleOptions.map((opt: any) =>
    opt.key === 'showObstacle' ? { ...opt, label: obstacleVisible.value ? '隐藏障碍物' : '显示障碍物' } : opt,
  ),
)

function handleObstacleSelect(key: string) {
  if (key === 'showObstacle') {
    const v = toggleObstaclesVisible()
    if (v === null) message.warning('请先加载障碍物')
    else obstacleVisible.value = v
  } else if (key === 'selectAirports') {
    showAirportModal.value = true
  }
}

// 10. 航线绘制与测量标绘
function handleEditSelect(key: string) {
  if (routeStore.routeActionMode === 'losPointPicking') return
  if (key === 'createLine') {
    if (routeStore.routeActionMode !== 'idle') return message.warning('请先结束当前航线绘制或编辑操作')
    showRouteModal.value = true
  } else if (key === 'marker') {
    markerDialog.value?.openDlg()
  } else {
    store.showRouteManage = true
  }
}

function startDrawRoute(routeParams: any) {
  if (!routeStore.startDrawing()) return message.warning('请先结束当前航线绘制或编辑操作')
  showRouteModal.value = false
  if (!window.viewer) {
    message.error('地图尚未初始化')
    return routeStore.endRouteAction()
  }
  if (!window.routeManageViewer) window.routeManageViewer = new RouteManageViewer(window.viewer)
  const rdv = window.routeManageViewer
  rdv.routeParams.isClose = routeParams.isClose
  rdv.routeParams.height = routeParams.height

  rdv.start().then((res: any) => {
    const pts = res[0].map((pt: any, i: number) => ({
      lon: pt.lon, lat: pt.lat, alt: pt.alt, ch1: 0, ch2: 0x03, speed: 0, nPt: i + 1,
    }))
    if (pts.length) {
      pts[pts.length - 1].ch2 = 0x01
      pts[pts.length - 1].ch1 = routeParams.isClose ? 0 : 2
    }
    const aRoute = {
      code: routeParams.code, PtNum: pts.length, isClose: routeParams.isClose,
      unicode: getUnicode(), name: routeParams.name, points: pts, totalDistance: 0,
      isDesignRoute: true, isVisible: true,
    }
    routeStore.addRoute(aRoute)
    const entity = rdv.addAirLine(aRoute)
    rdv.selectRoute?.(aRoute.unicode)
    if (entity) window.viewer.flyTo(entity, { duration: 2 })
    message.success('航线绘制完成')
  }).catch((rej: any) => { if (rej) message.warning(rej) }).finally(() => routeStore.endRouteAction())
}

function handleMeasureSelect(key: string) {
  if (routeStore.routeActionMode === 'losPointPicking') return
  if (key === 'distance') window.measureViewer?.activate()
  else if (key === 'area') window.measureViewer?.activateAreaMeasure()
  else if (key === 'clear') {
    window.measureViewer?.deactivate()
    window.measureViewer?.stopAreaMeasure()
    window.measureViewer?.clearDisEntity()
    window.measureViewer?.clearAreaEntity()
    window.measureViewer?.viewer?.scene?.requestRender()
  }
}

function handleDrawSelect(key: string) {
  if (routeStore.routeActionMode === 'losPointPicking') return
  if (key === 'clear') {
    if (window.measureViewer?.clearDraw()) message.warning('无可清除图形')
  } else window.measureViewer?.drawGraphics(key)
}

let mainCloseUnlisten: (() => void) | null = null
onMounted(async () => {
  if (isTauri()) {
    mainCloseUnlisten = await getCurrentWindow().onCloseRequested(async (e) => {
      await exitApplicationOnClose(e, () => invoke('close_app'))
    })
  }
})
onBeforeUnmount(() => {
  stopCompanionMode()
  destroyObstacles?.()
  if (mainCloseUnlisten) {
    mainCloseUnlisten()
    mainCloseUnlisten = null
  }
})
</script>

<template>
  <ToolbarActions
    :data-options="dataOptions"
    :edit-options="store.menuOptions.EditOptions"
    :measure-options="store.menuOptions.MeasureOptions"
    :draw-options="store.menuOptions.DrawOptions"
    :nfz-options="nfzOptions"
    :show-n-f-z="showNFZ"
    :nfz-loading="nfzLoading"
    :simulated-fence-visible="simulatedFenceVisible"
    :terrain-warning-active="terrainWarningActive"
    :companion-mode="companionMode"
    :obstacle-loading-options="obstacleLoadingOptions"
    :los-analyze-options="losAnalyzeOptions"
    :view-settings-options="viewSettingsOptions"
    :view-settings-active="viewSettingsActive"
    :view-settings-loading="viewSettingsLoading"
    @manage-layer="layerManager?.open_closeSidebar()"
    @open-marker-points-panel="markerPointsPanel?.open()"
    @select-data="handleDataSelect"
    @select-edit="handleEditSelect"
    @select-measure="handleMeasureSelect"
    @select-draw="handleDrawSelect"
    @select-nfz="handleNFZSelect"
    @hide-nfz="hideNFZ"
    @toggle-simulated-fence="toggleSimulatedFence"
    @open-udp-settings="openUdpSettings"
    @toggle-mock-flight="toggleMockFlight"
    @toggle-terrain-warning="toggleSelectedPlaneTerrainWarning"
    @toggle-companion-mode="activeCompanionMode"
    @select-obstacle="handleObstacleSelect"
    @show-link-health="() => restoreLinkHealthWindow(null).catch(() => new WebviewWindow('linkHealth', linkHealthWindowOptions))"
    @show-telemetry="() => restoreTelemetryWindow(null).catch(() => new WebviewWindow('telemetry', telemetryWindowOptions))"
    @select-los-analyse="handleLosAnalyseSelect"
    @select-view-settings="handleViewSettingsSelect"
    @refresh-page="() => window.location.reload()"
    @minimize-app="() => getCurrentWindow().minimize()"
    @close-app="() => invoke('close_app')"
  />

  <n-button
    id="bt_switch"
    size="small"
    :type="showDetection ? 'error' : 'success'"
    v-if="lStore.validYCData"
    @click="shutDownDetec"
    :style="{ bottom: '0vh' }"
  >
    {{ showDetection ? '关闭图表' : '显示图表' }}
  </n-button>

  <n-collapse-transition v-show="showDetection">
    <n-flex id="detectionGraph" justify="center" :style="{ height: detectDivHeight + 'vh' }">
      <CollisionDetection ref="collisionDetection" />
    </n-flex>
  </n-collapse-transition>

  <WsConfigModal
    v-model:show="showModal"
    @connect="connectWebSocket"
    @close="closeWS"
  />

  <CommsConfigModal
    v-model:show="showUdpModal"
    :links="uavStore.links"
    :interface-options="interfaceOptions"
    :port-options="portOptions"
    @add-link="addCommunicationLink"
    @update-link-kind="updateCommunicationLinkKind"
    @remove-link="removeCommunicationLink"
    @save-config="handleSaveConfig"
  />

  <TerrainWarningPanel
    :active="terrainWarningActive"
    :target-label="terrainWarningTargetLabel"
    :is-danger="terrainWarningIsDanger"
    :status-text="terrainWarningStatusText"
    :aircraft-height="terrainWarningAircraftHeight"
    :distance="terrainWarningDistance"
    :clearance="terrainWarningClearance"
    :distance-input="terrainWarningDistanceInput"
    :clearance-input="terrainWarningClearanceInput"
    :terrain-polyline-points="terrainPolylinePoints"
    :flight-polyline-points="flightPolylinePoints"
    :min-altitude-label="profileMinHeightLabel"
    :max-altitude-label="profileMaxHeightLabel"
    @update-distance="updateTerrainWarningDistance"
    @update-clearance="updateTerrainWarningClearance"
    @restore-inputs="restoreTerrainWarningInputs"
  />

  <SimulatedFencePanel :visible="simulatedFenceVisible" :results="simulatedFenceResults" :fence="simulatedFence" />

  <AirportObstacleModal
    v-model:show="showAirportModal"
    @loaded="obstacleVisible = true"
  />

  <SpatialAnalysis ref="spatialAnalyse" />
  <LayerManager ref="layerManager" />
  <RouteOptions v-model:show="showRouteModal" @routeDraw="startDrawRoute" @cancelDraw="showRouteModal = false" />
  <LosAnalyseOptions v-model:show="showLosAnalyseModal" @startLosAnalyse="isRouteVisiable" @cancelLosAnalyse="showLosAnalyseModal = false" />
  <MarkerDialog ref="markerDialog" />
  <MarkerPointsPanel ref="markerPointsPanel" />
  <AltitudeWarning :warningResult="altitudeWarningResult" />
</template>

<style scoped>
#bt_switch {
  position: absolute;
  z-index: 2;
}

#detectionGraph {
  position: absolute;
  bottom: -25vh;
  width: 100vw;
  background: rgb(255 255 255 / 80%);
  border-radius: 7px;
}
</style>
