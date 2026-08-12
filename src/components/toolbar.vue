<!--
  文件描述：工具条
  创建时间：2024/4/16 10:54
  创建人：Zhaipeixiu
-->
<script setup lang="ts">
import { RadioOutline } from '@vicons/ionicons5'
import {
  ChevronBack,
  ChevronForward,
  CreateOutline,
  DuplicateSharp,
  EyeSharp,
  Layers,
  Settings,
  ReloadSharp,
  BuildSharp,
  HomeSharp,
  CloseOutline,
  ShieldCheckmark,
  ShieldOutline,
  Airplane,
  RemoveOutline,
  InformationSharp,
  InformationCircleOutline,
  AlertCircleOutline,
  ScanOutline,
  EarthOutline,
  EyeOutline,
  CompassOutline,
  CaretForwardCircleOutline,
  PulseOutline,
} from '@vicons/ionicons5'
//引入监听hooks和飞机数据状态管理

import { RulerAlt } from '@vicons/carbon'
import { TerrainSharp, TramOutlined } from '@vicons/material'
import { DrawPolygon } from '@vicons/fa'
import { useMessage } from 'naive-ui'
import { ref, watch, computed, onBeforeUnmount, onMounted } from 'vue'
import { useStaticStore } from '@/store/staticOptions.js'
import { useUavStore } from '@/store/uavStore'
import {
  dataProcess_fromQT,
  dataProcess_fromQT_route,
} from '@/assets/js/websocketProtocol.ts'
import SpatialAnalysis from '@/components/SpatialAnalysis.vue'
import LayerManager from '@/components/LayerManager.vue'
import CollisionDetection from './CollisionDetection.vue'
import AltitudeWarning from './AltitudeWarning.vue'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { Cartesian3, Cartographic, sampleTerrainMostDetailed } from 'cesium'
import * as Cesium from 'cesium'
import {
  ByDirectionAndLen,
  getDistance,
  getElevation,
} from '@/utils/map/geocomputation.ts'
import { checkAltitudeWarning } from '@/utils/map/altitudeWarning.ts'
import RouteManageViewer from '@/assets/js/RouteManageViewer.js'
import RouteOptions from '@/components/RouteOptions.vue'
import { useRouteStore } from '@/store/RouteStore'
import MarkerDialog from '@/components/MarkerDialog.vue'
import NFZViewer from '@/assets/js/NFZViewer.js'
import { formatNoFlyZoneConflictMessage } from '@/utils/map/noFlyZoneService'
import { useRouter } from 'vue-router'
import { getUnicode } from '@/types/entityoptions.ts'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { storeToRefs } from 'pinia'
import type { PlaneState } from '@/types/entityoptions'
import { normalizeUAVInfo, normalizeFP981C } from '@/utils/plane/planeAdapter'
import {
  createSimulatedElectronicFence,
  getSimulatedElectronicFenceAlerts,
  removeSimulatedElectronicFence,
  SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION,
  type ElectronicFenceResult,
  type SimulatedElectronicFence,
} from '@/utils/map/simulatedElectronicFence'
//选中飞机以及高度预警
import {
  useSelectedPlaneStore,
  type SelectedPlaneMeta,
} from '@/store/selectedPlaneStore'
import { useTerrainWarning } from '@/hooks/useTerrainWarning'
import { useMarkObstacle } from '@/hooks/useMarkObstacle.ts'
import {
  useRouteLineOfSight,
  type LosResultType,
  type LosViewPointNumber,
} from '@/hooks/useRouteLineOfSight.ts'
import {
  exitApplicationOnClose,
  restoreTelemetryWindow,
  telemetryWindowOptions,
} from '@/utils/telemetryWindow'
import {
  linkHealthWindowOptions,
  restoreLinkHealthWindow,
} from '@/utils/linkHealthWindow'
import LosAnalyseOptions from './LosAnalyseOptions.vue'
import type { RouteLosAnalyseParams } from '@/types/routeLineOfSight'
import type { LinkDraft, LinkKind } from '@/store/commsConfig'

declare global {
  interface Window {
    viewer: any
    routeManageViewer?: any
    pendingSelectedRouteId?: string | number | null
  }
}

const {
  drawLosEntities,
  stopLosAnalysis,
  toggleLosViewPointResultVisibility,
  toggleFinalLosResultVisibility,
} = useRouteLineOfSight()
const losViewPointResultVisible = ref([
  { result1: false, result2: false },
  { result1: false, result2: false },
])
const finalLosResultVisible = ref(false)
const losViewPointNumbers: LosViewPointNumber[] = [1, 2]
const losResultSelectionMap = {
  viewPoint1Result1: { viewPointNumber: 1, resultType: 1 },
  viewPoint1Result2: { viewPointNumber: 1, resultType: 2 },
  viewPoint2Result1: { viewPointNumber: 2, resultType: 1 },
  viewPoint2Result2: { viewPointNumber: 2, resultType: 2 },
} as const

function resetLosResultVisibility() {
  losViewPointResultVisible.value.forEach((result) => {
    result.result1 = false
    result.result2 = false
  })
  finalLosResultVisible.value = false
}

const losAnalyzeOptions = computed(() => [
  ...store.menuOptions.LosAnalyzeOptions,
  ...losViewPointNumbers.map((viewPointNumber) => ({
    label: `视点${viewPointNumber}结果`,
    key: `viewPoint${viewPointNumber}Results`,
    children: ([1, 2] as LosResultType[]).map((resultType) => ({
      label: losViewPointResultVisible.value[viewPointNumber - 1][
        `result${resultType}` as 'result1' | 'result2'
      ]
        ? `隐藏结果${resultType}`
        : `显示结果${resultType}`,
      key: `viewPoint${viewPointNumber}Result${resultType}`,
    })),
  })),
  {
    label: finalLosResultVisible.value ? '隐藏最终结果' : '显示最终结果',
    key: 'toggleFinalLosResult',
  },
])
const obstacleVisible = ref(false)
const obstacleLoading = ref(false)
const obstacleLoadingOptions = computed(() =>
  store.menuOptions.obstacleOptions.map((option) => {
    if (option.key === 'showObstacle') {
      return {
        ...option,
        label: obstacleVisible.value ? '隐藏障碍物' : '显示障碍物',
      }
    }
    return option
  }),
)

const selectedPlaneStore = useSelectedPlaneStore()
const { selectedModel, selectedMeta } = storeToRefs(selectedPlaneStore)
const terrainWarningApi = ref<ReturnType<typeof useTerrainWarning> | null>(null)
type TerrainWarningTarget = {
  model: Cesium.Model
  meta: SelectedPlaneMeta
}
let terrainWarningTarget: TerrainWarningTarget | null = null
const terrainWarningTargetLabel = ref('')
const terrainWarningDistance = ref(10000) //默认值
const terrainWarningClearance = ref(100) //默认值
const terrainWarningDistanceInput = ref<number | null>(10000)
const terrainWarningClearanceInput = ref<number | null>(100)

const router = useRouter()

const emit = defineEmits(['resizeMap'])
const message = useMessage()
let SceneValue
let showModal = ref(false)
let showUdpModal = ref(false)
let showRouteModal = ref(false)
let showLosAnalyseModal = ref(false)
let hasPlane = ref(false)
let showDetection = ref(false)
let store = useStaticStore()
const uavStore = useUavStore()
let lStore = useLayerStore()
let groundHeight = ref(-1)
let detectDivHeight = ref(25)
const spatialAnalyse = ref(null)
const layerManager = ref(null)
const collisionDetection = ref(null)
const markerDialog = ref(null)

SceneValue = ref('untrace')
let frameCount = 0
let lastPos = undefined //飞机上一时点的坐标
let companionMode = ref(false) // 是否处于伴飞模式
let companionModel: Cesium.Model | null = null
let removeCompanionRender: (() => void) | null = null
const altitudeWarningResult = ref(null) // 高度预警结果

let routeDrawViewer: RouteManageViewer | null = null
// const isDrawingRoute = ref(false)

let nfzViewer = null
//禁飞区是否显示 第一次默认不显示
let showNFZ = ref(false)
//禁飞区正在加载标识 防止重复点击
let nfzLoading = ref(false)
const nfzOptions = [
  { label: '同步最新禁飞区', key: 'sync' },
  { label: '加载本地禁飞区', key: 'local' },
]
let mainCloseUnlisten: (() => void) | null = null

const simulatedFenceVisible = ref(false)
const simulatedFenceResults = ref<ElectronicFenceResult[]>([])
let simulatedFence: SimulatedElectronicFence | null = null

function getMonitoredPlanes(): PlaneState[] {
  const planes: PlaneState[] = []
  uavStore.uavInfoMap?.forEach((uav) => {
    if (Number.isFinite(uav.longitude) && Number.isFinite(uav.latitude)) {
      planes.push(normalizeUAVInfo(uav))
    }
  })
  uavStore.fp981cMap?.forEach((item) => {
    if (item.c2) planes.push(normalizeFP981C(item))
  })
  return planes
}

function refreshSimulatedFenceResults() {
  if (!simulatedFenceVisible.value || !simulatedFence) return
  simulatedFenceResults.value = getSimulatedElectronicFenceAlerts(
    simulatedFence,
    getMonitoredPlanes(),
  )
}

function formatFenceDistance(distanceMeters: number) {
  return distanceMeters > 10_000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`
}

function toggleSimulatedFence() {
  if (!window.viewer) {
    message.warning('地图尚未准备完成')
    return
  }
  if (simulatedFenceVisible.value) {
    simulatedFenceVisible.value = false
    removeSimulatedElectronicFence(window.viewer, simulatedFence)
    simulatedFence = null
    simulatedFenceResults.value = []
    return
  }

  simulatedFence = createSimulatedElectronicFence(
    window.viewer,
    SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION,
  )
  simulatedFenceVisible.value = true
  refreshSimulatedFenceResults()
  focusSimulatedArea()
  window.viewer.scene.requestRender()
}

watch(
  () => [uavStore.uavInfoMap, uavStore.fp981cMap],
  refreshSimulatedFenceResults,
)

function focusSimulatedArea() {
  const viewer = window.viewer as Cesium.Viewer | undefined
  if (!viewer) return

  // Keep this view scoped to the simulation controls and high enough to show
  // the whole of Hainan around the fixed simulated aircraft position.
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION.lon,
      SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION.lat,
      450_000,
    ),
    orientation: {
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    },
    duration: 1.5,
  })
}

function toggleMockFlight() {
  const wasMockRunning = uavStore.isMock
  uavStore.toggleMockUavInfoService()
  if (!wasMockRunning) focusSimulatedArea()
}

function getRouteManageViewer() {
  if (!window.viewer) {
    return null
  }

  if (!window.routeManageViewer) {
    window.routeManageViewer = new RouteManageViewer(window.viewer)
  }

  window.routeManageViewer.onNoFlyZoneViolation = ({ conflict, action }) => {
    message.warning(formatNoFlyZoneConflictMessage(conflict, action))
  }

  return window.routeManageViewer
}

function getNFZErrorMessage(error: unknown) {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

async function handleNFZSelect(key: string | number) {
  if (!window.viewer || nfzLoading.value) return
  if (!nfzViewer) nfzViewer = new NFZViewer(window.viewer)

  const source = key === 'local' ? 'local' : 'sync'
  nfzLoading.value = true
  try {
    await nfzViewer.toggleNFZ(true, source)
    showNFZ.value = true
  } catch (error) {
    if (source === 'local') {
      message.warning('请先获取禁飞区数据')
    } else {
      const detail = getNFZErrorMessage(error)
      message.error(detail || '同步禁飞区失败')
    }
  } finally {
    nfzLoading.value = false
  }
}

async function hideNFZ() {
  if (!nfzViewer || !showNFZ.value || nfzLoading.value) return

  nfzLoading.value = true
  try {
    await nfzViewer.toggleNFZ(false)
    showNFZ.value = false
  } catch (error) {
    message.error(getNFZErrorMessage(error) || '隐藏禁飞区失败')
  } finally {
    nfzLoading.value = false
  }
}
function stopCompanionMode() {
  const viewer = window.viewer as Cesium.Viewer | undefined
  removeCompanionRender?.()
  removeCompanionRender = null

  if (viewer) {
    viewer.trackedEntity = undefined
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }

  companionModel = null
  companionMode.value = false
  SceneValue.value = 'untrace'
}

function startCompanionMode() {
  const viewer = window.viewer as Cesium.Viewer | undefined
  const model = selectedModel.value
  if (
    !viewer ||
    !model ||
    model.isDestroyed() ||
    !viewer.scene.primitives.contains(model)
  ) {
    stopCompanionMode()
    message.warning('请先在地图上选中一架飞机')
    return
  }

  removeCompanionRender?.()
  companionModel = model

  const initialHeading = Cesium.Math.toRadians(
    getSelectedAircraftHeading() ?? 0,
  )
  const followDistance = 250
  const targetPosition = new Cesium.Cartesian3()
  const initialCameraOffset = new Cesium.HeadingPitchRange(
    initialHeading,
    Cesium.Math.toRadians(-20),
    followDistance,
  )
  const cameraOffset = new Cesium.Cartesian3()
  let hasAppliedInitialView = false
  const minimumCompanionHeight = 30
  const minimumCompanionRange = 80

  function constrainCompanionOffset(offset: Cesium.Cartesian3) {
    // camera.position is expressed in the local ENU frame established by
    // lookAt. Preserve the user's horizontal view, but never let it pass
    // below or inside the aircraft.
    offset.z = Math.max(offset.z, minimumCompanionHeight)
    const range = Cesium.Cartesian3.magnitude(offset)
    if (range < minimumCompanionRange) {
      Cesium.Cartesian3.multiplyByScalar(
        offset,
        minimumCompanionRange / Math.max(range, 1),
        offset,
      )
    }
  }

  const updateCompanionCamera = () => {
    if (
      !companionModel ||
      companionModel.isDestroyed() ||
      !viewer.scene.primitives.contains(companionModel)
    ) {
      stopCompanionMode()
      return
    }

    // camera.position 是以上一帧飞机为原点的局部偏移，包含用户的旋转和缩放。
    if (hasAppliedInitialView) {
      Cesium.Cartesian3.clone(viewer.camera.position, cameraOffset)
      constrainCompanionOffset(cameraOffset)
    }

    Cesium.Matrix4.getTranslation(companionModel.modelMatrix, targetPosition)

    viewer.camera.lookAt(
      targetPosition,
      hasAppliedInitialView ? cameraOffset : initialCameraOffset,
    )
    hasAppliedInitialView = true
  }

  viewer.scene.preRender.addEventListener(updateCompanionCamera)
  removeCompanionRender = () => {
    viewer.scene.preRender.removeEventListener(updateCompanionCamera)
  }
  updateCompanionCamera()
  companionMode.value = true
  SceneValue.value = 'companion'
}

function activeCompanionMode() {
  if (companionMode.value) {
    stopCompanionMode()
  } else {
    startCompanionMode()
  }
}

function handleObstacleSelect(key) {
  if (obstacleLoading.value) return
  if (key === 'showObstacle') {
    const visible = toggleObstaclesVisible()
    if (visible === null) {
      message.warning('请先加载障碍物')
      return
    }
    obstacleVisible.value = visible
    return
  }

  const source = key === 'syncObstacle' ? 'sync' : 'local'
  obstacleLoading.value = true
  loadObstacles(source)
    .then((count) => {
      obstacleVisible.value = true
      message.success(`${source === 'sync' ? '同步' : '加载本地'}障碍物成功，共 ${count} 个`)
    })
    .catch((error) => {
      if (source === 'local') {
        message.warning('请先同步障碍物数据')
      } else {
        const detail = error instanceof Error ? error.message : String(error)
        message.error(detail || '同步障碍物失败')
      }
    })
    .finally(() => {
      obstacleLoading.value = false
    })
}
//用于控制显示关闭工具条按钮或打开工具条按钮
let barIsOpen = ref(true)
//点击关闭或打开工具条按钮
function openCloseBar() {
  // 获取工具条元素
  let toolbar = document.querySelector('.panel-toolbar989834y34')
  // 判断工具条的class是否包含open，如果包含则移除，否则添加
  if (toolbar?.classList.contains('open')) {
    //关闭

    toolbar?.classList.remove('open')
  } else {
    // 打开
    toolbar?.classList.add('open')
  }
  barIsOpen.value = !barIsOpen.value
}
//是否是在地图选择点状态
function blockWhileLosPointPicking() {
  if (useRouteStore().routeActionMode !== 'losPointPicking') return false

  message.warning('请先完成或取消地图选点')
  return true
}

function handleEditSelect(key) {
  if (blockWhileLosPointPicking()) return

  const routeStore = useRouteStore()
  if (key === 'createLine') {
    // if (isDrawingRoute.value) {
    //   message.warning('请先结束上一次航线绘制：Esc 取消绘制，Enter 结束绘制')
    //   return
    // }
    if (routeStore.routeActionMode !== 'idle') {
      message.warning('请先结束当前航线绘制或编辑操作')
      return
    }
    // 绘制航线
    showRouteModal.value = true
  } else if (key === 'marker') {
    // 标记障碍物
    markerDialog.value?.openDlg()
  } else {
    // 打开航线管理面板  这里的stores是staticOptions.js
    // 里面有一个showRouteManage变量，控制航线管理面板的显示和隐藏
    store.showRouteManage = true
  }
}
function handleAnalyseSelect(key) {
  if (blockWhileLosPointPicking()) return

  if (key === 'visibility') {
    store.analysisVars.analysisType = 2
    //弹出参数窗口
    spatialAnalyse.value?.openParamsDialog()
  }
  if (key === 'profile') {
    store.analysisVars.analysisType = 1
    //弹出参数窗口
    spatialAnalyse.value?.openParamsDialog()
  }
}

async function handleLosAnalyseSelect(key) {
  //通视分析按钮
  if (key === 'losAnalyse') {
    //先判断是否选中航线
    const routeManage = window.routeManageViewer
    const routeId = routeManage?.selectedRouteId

    if (!routeId) {
      message.info('请选中一条行航线！')
      return
    }
    if (blockWhileLosPointPicking()) return

    //弹窗进行参数设置  设置后点击确定或取消按钮再判断是否进行可视分析
    showLosAnalyseModal.value = true
  }
  if (key === 'stopLosAnalyse') {
    if (stopLosAnalysis()) {
      resetLosResultVisibility()
    } else {
      message.warning('当前没有正在进行的通视分析')
    }
  }
  const selection =
    losResultSelectionMap[key as keyof typeof losResultSelectionMap]
  if (selection) {
    const { viewPointNumber, resultType } = selection
    const visible = toggleLosViewPointResultVisibility(
      viewPointNumber,
      resultType,
    )
    if (visible === null) {
      message.warning(`暂无视点${viewPointNumber}的分析结果`)
      return
    }
    losViewPointResultVisible.value[viewPointNumber - 1][
      `result${resultType}` as 'result1' | 'result2'
    ] = visible
    message.success(
      `视点${viewPointNumber}结果${resultType}已${visible ? '显示' : '隐藏'}`,
    )
  }
  if (key === 'toggleFinalLosResult') {
    const visible = toggleFinalLosResultVisibility()
    if (visible === null) {
      message.warning('暂无最终分析结果')
      return
    }
    finalLosResultVisible.value = visible
    message.success(`最终结果已${visible ? '显示' : '隐藏'}`)
  }
}

function handleDrawSelect(key) {
  if (blockWhileLosPointPicking()) return

  if (key === 'clear') {
    if (window.measureViewer.clearDraw()) {
      message.warning('无可清除图形')
    }
  } else {
    window.measureViewer.drawGraphics(key)
  }
}

// 测量菜单选中事件
function handleMeasureSelect(key) {
  if (blockWhileLosPointPicking()) return

  if (key === 'distance') {
    measure()
  } else if (key === 'area') {
    measureArea()
  } else if (key === 'clear') {
    measureEnd()
  }
}

async function handleFile() {
  const [fileHandle] = await window?.showOpenFilePicker({
    types: [
      {
        description: 'kml/json',
        accept: { 'text/kml': ['.kml', '.kmz', '.json', '.geojson'] },
      },
    ],
  })

  // 获取文件File对象
  const file = await fileHandle?.getFile()
  console.group('获取到的文件')
  console.log(fileHandle)
  console.log(file.name)
  if (
    file.name.toLowerCase().endsWith('kml') ||
    file.name.toLowerCase().endsWith('kmz')
  ) {
    window.measureViewer.addKml(file)
  } else if (
    file.name.toLowerCase().endsWith('geojson') ||
    file.name.toLowerCase().endsWith('json') ||
    file.name.toLowerCase().endsWith('topojson')
  ) {
    window.measureViewer.addJson(file)
  }
}

/**
 * 多点距离测量
 */
function measure() {
  //允许多次测量直到点击清楚按钮
  // window.measureViewer.clearDisEntity()
  window.measureViewer.activate()
}

/**
 * 清除面积测量和多点距离测量
 */
function measureEnd() {
  if (
    window.measureViewer.vertexEntities.length > 0 ||
    window.measureViewer.activeShapePoints.length > 0 ||
    window.measureViewer.areaEntities.length > 0
  ) {
    window.measureViewer.deactivate()
    window.measureViewer.stopAreaMeasure()
    window.measureViewer.clearDisEntity()
    window.measureViewer.clearAreaEntity()
    window.measureViewer.viewer.scene.requestRender()
  } else {
    message.warning('无可清除元素')
  }
}

/**
 * 面积测量
 */
function measureArea() {
  //允许多次面积测量
  // window.measureViewer.clearAreaEntity()
  window.measureViewer.activateAreaMeasure()
}

/**
 * 连接websocket
 * @returns {Promise<void>}
 */
async function connectWebSocket() {
  if (store.webskt.ws) {
    try {
      store.webskt.ws.close()
    } catch (err) {
      console.error('关闭旧 WebSocket 连接失败:', err)
    }
  }
  store.webskt.ws = new WebSocket(
    'ws://' +
      store.webskt.ws_config.address +
      ':' +
      store.webskt.ws_config.port,
  )
  store.webskt.ws.onopen = function (event) {
    message.success(
      'WebSocket已连接\n url:' +
        'ws://' +
        store.webskt.ws_config.address +
        ':' +
        store.webskt.ws_config.port,
    )
    store.webskt.ws.send('hello QT!')
  }

  store.webskt.ws.onmessage = (event) => {
    //收到消息后的处理流程....
    let sktData = JSON.parse(event.data)
    // console.log(sktData);
    frameCount++
    if (sktData.type === 0) {
      let ycData = dataProcess_fromQT(sktData)
      if (ycData != null) {
        // 更新遥测数据（飞机位置）
        window.measureViewer.updateDynamicData(ycData)
        lStore.validYCData = true
        // 添加飞机三维图标
        if (!hasPlane.value) {
          window.measureViewer.addAirplaneEntity(
            store.models.fp98,
            ycData.uavId + ycData.uavType,
          )
          hasPlane.value = true
        }
        // 加载和更新碰撞检测图(50帧更新一次) (只在联网模式下启用)
        if (
          frameCount > 50 &&
          lStore.openDetect &&
          !store.networkStatus.offlineMode
        ) {
          emit('resizeMap', detectDivHeight.value)
          showDetection.value = true
          frameCount = 0
          let currentPos = Cartesian3.fromDegrees(
            ycData.lon,
            ycData.lat,
            ycData.alt,
          )
          // 显示飞机当前位置的地表投影点海拔高度 和 飞机高度（折线图）
          // 计算对地高度 m
          groundHeight.value =
            ycData.alt - getElevation(window.viewer, currentPos)
          // 计算当前点与上一点的距离 米
          if (lastPos === undefined) {
            lastPos = currentPos
          }
          let dis = getDistance(currentPos, lastPos) * 1000
          lastPos = currentPos
          collisionDetection.value?.drawDetection(
            ycData.alt,
            dis,
            ycData.alt - groundHeight.value,
          )
          // 当前飞机高度（折线图） 和飞机前方10公里处的地形高度（以飞机当前航向推算）
          let max_dis = 5000
          // 计算前方5公里处的坐标点
          let detectPos = ByDirectionAndLen(currentPos, ycData.heading, max_dis)
          // 计算地形剖面
          collisionDetection.value?.drawTerrain(
            ycData.alt,
            currentPos,
            detectPos,
            max_dis,
          )
        }
      } else {
        //遥测解析错误或无数据
        lStore.validYCData = false
      }
    }
    if (sktData.type === 1) {
      let routeData = dataProcess_fromQT_route(sktData)
      if (routeData != null) {
        lStore.navi.airlines.push(routeData)
        lStore.navi.currentRouteID = routeData.code
        console.log(routeData)
        window.measureViewer.showAirLine(routeData)
      }
    }
  }
}

async function openUdpSettings() {
  // showUdpModal
  showUdpModal.value = true
  try {
    await uavStore.fetchNetworkInterfaces()
    await uavStore.loadCommsConfig()
    await uavStore.startPortsMonitoring()
  } catch (err) {
    message.error('获取本地网卡或读取配置失败: ' + err)
  }
}

async function handleSaveConfig() {
  try {
    await uavStore.saveCommsConfig()
    message.success('配置已保存并成功应用热重载！')
  } catch (err) {
    message.error('保存配置失败: ' + err)
  }
}

const interfaceOptions = computed(() => {
  const options = [{ label: '0.0.0.0 (默认路由网卡)', value: '0.0.0.0' }]
  uavStore.networkInterfaces.forEach((iface) => {
    // 检查是否已包含，避免重复
    if (!options.some((opt) => opt.value === iface.ip)) {
      options.push({
        label: iface.ip,
        value: iface.ip,
      })
    }
  })
  return options
})

const portOptions = computed(() => {
  return uavStore.availablePorts.map((port) => ({
    label: port,
    value: port,
  }))
})

const baudRateOptions = [
  { label: '9600', value: 9600 },
  { label: '19200', value: 19200 },
  { label: '38400', value: 38400 },
  { label: '57600', value: 57600 },
  { label: '115200', value: 115200 },
]

const serialProtocolOptions = [
  { label: 'FP981C', value: 'FP981C' },
  { label: 'FP95', value: 'FP95' },
]

const linkKindOptions = [
  { label: 'UDP 点播', value: 'udp-unicast' as LinkKind },
  { label: 'UDP 组播', value: 'udp-multicast' as LinkKind },
  { label: '串口', value: 'serial' as LinkKind },
]

const udpProtocolOptions = [
  { label: 'FP981C', value: 'FP981C' },
  { label: 'FP95', value: 'FP95' },
  { label: 'UAVInfo', value: 'UAVInfo' },
]

function addCommunicationLink() {
  uavStore.addLink('udp-multicast')
}

function updateCommunicationLinkKind(link: LinkDraft, kind: LinkKind) {
  uavStore.updateLinkKind(link, kind)
}

function removeCommunicationLink(link: LinkDraft) {
  uavStore.removeLink(link.id)
}

watch(
  () => uavStore.uavInfo,
  (newVal) => {
    if (newVal) {
      let terrainAlt = 0
      if (window.viewer && window.viewer.scene && window.viewer.scene.globe) {
        const carto = Cartographic.fromDegrees(
          newVal.longitude,
          newVal.latitude,
        )
        terrainAlt = window.viewer.scene.globe.getHeight(carto) ?? 0
      }

      let ycData = {
        uavId: String(newVal.uavId),
        uavType: newVal.uavSeries,
        heading: newVal.headingAngle,
        pitch: newVal.pitchAngle,
        lon: newVal.longitude,
        lat: newVal.latitude,
        alt: Number(newVal.relativeAltitude) + terrainAlt,
        groundSpeed: newVal.groundSpeed * 3.6,
      }

      useLayerStore().navi.currentRouteID = newVal.currentRouteId
      useLayerStore().navi.nextRouteID = newVal.nextRouteId
      useLayerStore().navi.nextPoint = newVal.nextPoint
      useLayerStore().navi.distonext = newVal.distanceNext

      // ===== 高度预警检查 =====
      // 从 RouteStore 中查找与当前航线号匹配的设计航线
      const routeStore = useRouteStore()
      let matchedRoute = routeStore.flyRoute.find(
        (r) => r.code === newVal.currentRouteId,
      )
      // 如果没找到，尝试从 layerStore 的 airlines 中查找
      if (!matchedRoute) {
        matchedRoute = lStore.navi.airlines.find(
          (r) => r.code === newVal.currentRouteId,
        )
      }
      lStore.navi.activeDesignRoute = matchedRoute ?? null

      // 执行高度预警
      altitudeWarningResult.value = checkAltitudeWarning(
        ycData.alt,
        matchedRoute ?? null,
        newVal.nextPoint,
        newVal.distanceNext,
      )

      // 更新遥测数据（飞机位置）
      window.measureViewer.updateDynamicData(ycData)
      lStore.validYCData = true
      // 添加飞机三维图标
      if (!hasPlane.value) {
        window.measureViewer.addAirplaneEntity(
          store.models.fp98,
          ycData.uavId + ycData.uavType,
        )
        hasPlane.value = true
      }
      // 加载和更新碰撞检测图(50帧更新一次) (只在联网模式下启用)
      frameCount++
      if (
        frameCount > 50 &&
        lStore.openDetect &&
        !store.networkStatus.offlineMode
      ) {
        emit('resizeMap', detectDivHeight.value)
        showDetection.value = true
        frameCount = 0
        let currentPos = Cartesian3.fromDegrees(
          ycData.lon,
          ycData.lat,
          ycData.alt,
        )
        // 显示飞机当前位置的地表投影点海拔高度 和 飞机高度（折线图）
        // 计算对地高度 m
        groundHeight.value =
          ycData.alt - getElevation(window.viewer, currentPos)
        // 计算当前点与上一点的距离 米
        if (lastPos === undefined) {
          lastPos = currentPos
        }
        let dis = getDistance(currentPos, lastPos) * 1000
        lastPos = currentPos
        collisionDetection.value?.drawDetection(
          ycData.alt,
          dis,
          ycData.alt - groundHeight.value,
        )
        // 当前飞机高度（折线图） 和飞机前方10公里处的地形高度（以飞机当前航向推算）
        let max_dis = 5000
        // 计算前方5公里处的坐标点
        let detectPos = ByDirectionAndLen(currentPos, ycData.heading, max_dis)
        // 计算地形剖面
        collisionDetection.value?.drawTerrain(
          ycData.alt,
          currentPos,
          detectPos,
          max_dis,
        )
      }
    } else {
      lStore.validYCData = false
    }
  },
)

//关闭动态碰撞检测功能
function shutDownDetec() {
  if (lStore.openDetect) {
    emit('resizeMap', -1)
  } else {
    emit('resizeMap', detectDivHeight.value)
  }
  showDetection.value = !showDetection.value
  lStore.openDetect = !lStore.openDetect
}
/**
 * 关闭websocket连接
 */
function closeWS() {
  if (store.webskt.ws) {
    store.webskt.ws.close()
  }
}

function manageLayer() {
  layerManager.value?.open_closeSidebar()
}
function refreshPage() {
  window.location.reload()
}

function closeApp() {
  invoke('close_app')
}
//最小化
async function minimizeApp() {
  try {
    await getCurrentWindow().minimize()
  } catch (err) {
    message.error('最小化失败：' + err)
  }
}

/**
 * 绘制航线，目前只绘制任务航线
 * @param routeParams 航线属性，type:{name: string,code: number,isOpen: bool,height: number,routePts: []}
 */

function startDrawRoute(routeParams) {
  const routeStore = useRouteStore()

  // if (isDrawingRoute.value) {
  //   message.warning('请先结束上一次航线绘制')
  //   return
  // }

  if (!routeStore.startDrawing()) {
    message.warning(
      routeStore.routeActionMode === 'losPointPicking'
        ? '请先完成或取消地图选点'
        : '请先结束当前航线绘制或编辑操作',
    )
    return
  }
  //关闭绘制
  showRouteModal.value = false

  if (!window.viewer) {
    message.error('地图尚未初始化')
    routeStore.endRouteAction() //设置未空闲状态
    return
  }
  //航线管理绘制类
  routeDrawViewer = getRouteManageViewer()

  if (!routeDrawViewer) {
    message.error('航线管理器初始化失败')
    routeStore.endRouteAction() //设置未空闲状态
    return
  }

  // isDrawingRoute.value = true //正在绘制开启
  //将参数传递到航线管理器内部
  routeDrawViewer.routeParams.isClose = routeParams.isClose
  routeDrawViewer.routeParams.height = routeParams.height

  routeDrawViewer
    .start()
    .then((result) => {
      const AirlinePoints = []
      //绘制结束后将点数据（只有经纬高度）整理成航点(类型)
      result[0].forEach((pt, index) => {
        const AirlinePoint = {
          lon: pt.lon,
          lat: pt.lat,
          alt: pt.alt,
          ch1: 0,
          ch2: 0x03,
          speed: 0,
          nPt: index + 1,
        }

        AirlinePoints.push(AirlinePoint)
      })
      //最后一个航点是否闭合标志修改  ch2 = 0x01 最后一个航点的ch2特征字段固定的
      const lastPoint = AirlinePoints.at(-1)

      if (lastPoint) {
        lastPoint.ch2 = 0x01
        lastPoint.ch1 = routeParams.isClose ? 0 : 2
      }
      //将一组航点放到航线类里面
      const aRoute = {
        code: routeParams.code, //航线编号或类型（如：任务航线1、2）不是航线唯一码
        PtNum: result[0].length, //航点数
        isClose: routeParams.isClose, //是否闭合
        unicode: getUnicode(), //航线唯一码
        name: routeParams.name, //航线名称（不是航线编号）
        points: AirlinePoints, //航点的数组
        totalDistance: 0, //总距离
        isDesignRoute: true, //是否是设计航线
        isVisible: true, //航线管理页面默认显示
      }
      //将航线存放到routeStore中
      routeStore.addRoute(aRoute)
      //将航线信息存放都图层的store中
      // lStore.addLayer(
      //   aRoute.name,
      //   undefined,
      //   undefined,
      //   result[1],
      //   true,
      // )

      // 不依赖航线管理页面，工具条自己把航线画到地图上
      const entity = routeDrawViewer?.addAirLine(aRoute)

      routeDrawViewer?.selectRoute?.(aRoute.unicode)

      if (entity) {
        window.viewer.flyTo(entity, {
          duration: 2,
        })
      }

      // // 只记录刚刚绘制的航线，等以后用户打开航线管理页时再自动选中
      // window.pendingSelectedRouteId = aRoute.unicode

      // // 不要自动打开航线管理页面
      // // store.showRouteManage = true

      // // 如果航线管理页当前已经打开，才通知它刷新选中状态
      // if (store.showRouteManage) {
      //   window.dispatchEvent(
      //     new CustomEvent('route-created-and-select', {
      //       detail: {
      //         routeId: aRoute.unicode,
      //       },
      //     }),
      //   )
      // }

      message.success('航线绘制完成')
    })
    .catch((reject) => {
      if (reject) {
        message.warning(reject)
      }
    })
    .finally(() => {
      // isDrawingRoute.value = false//结束绘制状态
      routeStore.endRouteAction() //设置空闲状态
    })
}
//拿到选中的飞机模型的heading
function getSelectedAircraftHeading() {
  const meta = selectedMeta.value
  if (!meta) return undefined

  return getAircraftHeading(meta)
}

function getAircraftHeading(meta: SelectedPlaneMeta) {
  if (meta.kind === 'uavInfo') {
    return uavStore.uavInfoMap.get(meta.key)?.headingAngle
  }

  if (meta.kind === 'fp95') {
    const fp95 = uavStore.fp95Aggregate
    if (fp95 && `fp95:${fp95.uavId}` === meta.key) {
      return fp95.frame81?.headingAngle ?? fp95.frame83?.groundTrack
    }
  }

  if (meta.kind === 'fp981c') {
    const fp981c = uavStore.fp981cMap.get(meta.key.replace('fp981c:', ''))
    return (
      (fp981c?.c1?.head_angle ?? fp981c?.c2?.ground_speed_direct ?? 0) / 100
    )
  }

  return undefined
}

function getTerrainWarningAircraftPosition() {
  const model = terrainWarningTarget?.model
  if (!model || model.isDestroyed()) return undefined

  return Cesium.Matrix4.getTranslation(
    model.modelMatrix,
    new Cesium.Cartesian3(),
  )
}

function getTerrainWarningAircraftHeading() {
  const meta = terrainWarningTarget?.meta
  return meta ? getAircraftHeading(meta) : undefined
}

function getAircraftLabel(meta: SelectedPlaneMeta) {
  if (meta.kind === 'uavInfo') {
    const uav = uavStore.uavInfoMap.get(meta.key)
    if (uav) return `${uav.uavSeries}-${uav.uavId}`
  }

  if (meta.kind === 'fp95') {
    const aircraftId = meta.key.replace('fp95:', '')
    return `FP95-${aircraftId}`
  }

  const aircraftId = meta.key.replace('fp981c:', '')
  return `FP981C-${aircraftId}`
}

const profileWidth = 340
const profileHeight = 180
const profilePadding = 28

const profileRange = computed(() => {
  const points = terrainProfilePoints.value

  if (!points.length) return null

  const heights = points.flatMap((p) => [p.terrainHeight, p.flightHeight])
  const min = Math.min(...heights)
  const max = Math.max(...heights)

  const padding = Math.max(20, (max - min) * 0.15)

  return {
    min: min - padding,
    max: max + padding,
  }
})

function profileX(distanceM: number) {
  const usableWidth = profileWidth - profilePadding * 2
  return (
    profilePadding + (distanceM / terrainWarningDistance.value) * usableWidth
  )
}

function profileY(height: number) {
  const range = profileRange.value

  if (!range) return profileHeight - profilePadding

  const usableHeight = profileHeight - profilePadding * 2
  const ratio = (height - range.min) / (range.max - range.min)

  return profileHeight - profilePadding - ratio * usableHeight
}
//
const terrainPolylinePoints = computed(() => {
  return terrainProfilePoints.value
    .map((p) => `${profileX(p.distance)},${profileY(p.terrainHeight)}`)
    .join(' ')
})

const flightPolylinePoints = computed(() => {
  return terrainProfilePoints.value
    .map((p) => `${profileX(p.distance)},${profileY(p.flightHeight)}`)
    .join(' ')
})

const profileMinHeightLabel = computed(() => {
  if (!profileRange.value) return '--'
  return profileRange.value.min.toFixed(0)
})

const profileMaxHeightLabel = computed(() => {
  if (!profileRange.value) return '--'
  return profileRange.value.max.toFixed(0)
})
//根据hooks中返回的剖面拿到飞机的高度用于展示
const terrainWarningAircraftHeight = computed(() => {
  const height = terrainProfilePoints.value[0]?.flightHeight
  return Number.isFinite(height) ? `${height.toFixed(0)} m` : '--'
})
//高度预数值传入到hooks中 默认第一次远方10km 高度100
function applyTerrainWarningOptions() {
  terrainWarningApi.value?.updateOptions({
    distance: terrainWarningDistance.value,
    warnClearance: terrainWarningClearance.value,
  })
}
//更新用户输入的预警距离
function updateTerrainWarningDistance(value: number | null) {
  if (value === null || value < 1000 || value > 10000) return
  terrainWarningDistance.value = value
  applyTerrainWarningOptions()
}
//更新用户输入的预警高度
function updateTerrainWarningClearance(value: number | null) {
  if (value === null || value < 100 || value > 2000) return
  terrainWarningClearance.value = value
  applyTerrainWarningOptions()
}
//输入框中显示的值（可能输入的不对 update会对数据进行矫正 矫正后再显示到input中）
function restoreTerrainWarningInputs() {
  terrainWarningDistanceInput.value = terrainWarningDistance.value
  terrainWarningClearanceInput.value = terrainWarningClearance.value
}

onMounted(async () => {
  const mainWindow = getCurrentWindow()
  mainCloseUnlisten = await mainWindow.onCloseRequested(async (event) => {
    await exitApplicationOnClose(event, () => invoke('close_app'))
  })

  if (!window.viewer) return

  terrainWarningApi.value = useTerrainWarning(
    window.viewer,
    getTerrainWarningAircraftPosition,
    getTerrainWarningAircraftHeading,
    {
      distance: terrainWarningDistance.value,
      steps: 50, //每1000米采样10个点
      intervalMs: 10,
      terrainLevel: 13,
      warnClearance: terrainWarningClearance.value,
    }, //传递的参数
  )
  const positions = [
    // Cesium.Cartographic.fromDegrees(109.1801986, 21.6083409),
    // Cesium.Cartographic.fromDegrees(109.0942906,21.0563956),
    // Cesium.Cartographic.fromDegrees(109.0970023,21.0600092),
    // Cesium.Cartographic.fromDegrees(109.1684108, 21.6147329),
    // Cesium.Cartographic.fromDegrees(109.1202941, 21.5712331),
    // Cesium.Cartographic.fromDegrees(109.0210713, 21.4682243),
    // Cesium.Cartographic.fromDegrees(109.0521853, 21.273367),
    // Cesium.Cartographic.fromDegrees(109.0843282, 21.0720289),
    Cesium.Cartographic.fromDegrees(107.4219485, 37.8557285),
    Cesium.Cartographic.fromDegrees(110.093484, 22.395758),
    Cesium.Cartographic.fromDegrees(109.97489, 22.396414),
    Cesium.Cartographic.fromDegrees(109.682106, 22.14533),
    Cesium.Cartographic.fromDegrees(109.530916, 21.763838),
    Cesium.Cartographic.fromDegrees(109.612228, 21.539554),
    Cesium.Cartographic.fromDegrees(109.495786, 20.007391),
    Cesium.Cartographic.fromDegrees(109.536614, 19.739022),
    Cesium.Cartographic.fromDegrees(109.632882, 19.551391),
    Cesium.Cartographic.fromDegrees(109.998914, 19.153206),
    Cesium.Cartographic.fromDegrees(110.281251, 18.78065),
    Cesium.Cartographic.fromDegrees(53.424175, 16.748239),
    Cesium.Cartographic.fromDegrees(53.424851, 16.741347),
    Cesium.Cartographic.fromDegrees(53.584866, 16.73893),
    Cesium.Cartographic.fromDegrees(53.67826, 16.768164),
    Cesium.Cartographic.fromDegrees(53.770862, 16.799745),
  ]

  const result = await Cesium.sampleTerrain(
    window.viewer.terrainProvider,
    13,
    positions,
  )
  console.log(
    '海拔高度：',
    result.map((pos) => pos.height),
  )
})

onBeforeUnmount(() => {
  stopCompanionMode()
  removeSimulatedElectronicFence(window.viewer, simulatedFence)
  simulatedFence = null
  terrainWarningApi.value?.stop()
  if (mainCloseUnlisten) mainCloseUnlisten()
})

const terrainWarningActive = computed(
  () => terrainWarningApi.value?.active ?? false,
)

const terrainWarningIsDanger = computed(
  () => terrainWarningApi.value?.isWarning ?? false,
)

const terrainWarningMinClearance = computed(
  () => terrainWarningApi.value?.minClearance ?? Infinity,
)
//数组包含多个如下对象
/*{
 *distance: number//距离
  terrainHeight: number //地形高
  flightHeight: number //飞机高
  clearance: number     //离地高度
}
*/
const terrainProfilePoints = computed(
  () => terrainWarningApi.value?.profilePoints ?? [],
)

const terrainWarningStatusText = computed(() => {
  if (!terrainWarningActive.value) return '未开启'

  if (terrainWarningMinClearance.value === Infinity) {
    return '地形采样中'
  }

  const clearance = terrainWarningMinClearance.value.toFixed(0)

  return terrainWarningIsDanger.value
    ? `危险：最小离地高度 ${clearance} m`
    : `安全：最小离地高度 ${clearance} m`
})

function toggleSelectedPlaneTerrainWarning() {
  // 关闭操作不依赖当前选中状态，确保再次点击总能关闭检测和面板。
  if (terrainWarningActive.value) {
    terrainWarningApi.value?.stop()
    terrainWarningTarget = null
    terrainWarningTargetLabel.value = ''
    return
  }

  if (!selectedModel.value || !selectedMeta.value) {
    message.warning('请先选中一架飞机')
    return
  }

  const meta = { ...selectedMeta.value }
  const label = getAircraftLabel(meta)
  terrainWarningTarget = {
    model: selectedModel.value,
    meta,
  }
  terrainWarningTargetLabel.value = label
  terrainWarningApi.value?.start()
}

const { loadObstacles, toggleObstaclesVisible } = useMarkObstacle()

async function showTelemetryInfo() {
  try {
    const existingWin = await WebviewWindow.getByLabel('telemetry')
    if (existingWin) {
      await restoreTelemetryWindow(existingWin)
    } else {
      new WebviewWindow('telemetry', telemetryWindowOptions)
    }
  } catch (err) {
    console.error('打开独立航电窗口失败:', err)
  }
}
async function isRouteVisiable(losAnalyesParam: RouteLosAnalyseParams) {
  showLosAnalyseModal.value = false
  resetLosResultVisibility()
  const viewPositionCartographics = losAnalyesParam.viewPoints.map(
    (viewPoint) =>
      Cartographic.fromDegrees(
        viewPoint.longitude,
        viewPoint.latitude,
        viewPoint.altitude,
      ),
  )
  const completed = await drawLosEntities(
    viewPositionCartographics,
    losAnalyesParam.routeInterval,
    losAnalyesParam.losInterval,
  )
  if (completed) {
    resetLosResultVisibility()
    if (losAnalyesParam.isDualViewPointMode) {
      finalLosResultVisible.value = true
    } else {
      losViewPointResultVisible.value[0].result2 = true
    }
    message.success('通视分析完成')
  }
}
async function showLinkHealthInfo() {
  try {
    const existingWin = await WebviewWindow.getByLabel('linkHealth')
    if (existingWin) {
      await restoreLinkHealthWindow(existingWin)
    } else {
      new WebviewWindow('linkHealth', linkHealthWindowOptions)
    }
  } catch (err) {
    console.error('打开独立链路状态窗口失败:', err)
  }
}
</script>

<template>
  <n-space class="panel-toolbar989834y34">
    <n-row justify-content="space-between">
      <!-- 图层管理 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="manageLayer">
            <template #icon>
              <n-icon><Layers /></n-icon>
            </template>
          </n-button>
        </template>
        <span>图层管理</span>
      </n-tooltip>
      <!-- 添加数据 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary circle type="warning" @click="handleFile">
            <template #icon>
              <n-icon><DuplicateSharp /></n-icon>
            </template>
          </n-button>
        </template>
        <span>添加数据</span>
      </n-tooltip>
      <!-- 地形分析  这些Options在staticOptions.js中定义 -->
      <!-- <n-dropdown
        :options="store.menuOptions.AnalyzeOptions"
        @select="handleAnalyseSelect"
      >
        <n-button tertiary type="warning">
          <template #icon>
            <n-icon><TerrainSharp /></n-icon>
          </template>
        </n-button>
      </n-dropdown> -->
      <!-- 航线 -->
      <n-dropdown
        :options="store.menuOptions.EditOptions"
        @select="handleEditSelect"
      >
        <n-button tertiary circle type="warning">
          <!--航线绘制-->
          <template #icon>
            <n-icon><CreateOutline /></n-icon>
          </template>
        </n-button>
      </n-dropdown>
      <!-- 测量 -->
      <n-dropdown
        :options="store.menuOptions.MeasureOptions"
        @select="handleMeasureSelect"
      >
        <n-button tertiary type="warning">
          <template #icon>
            <n-icon><RulerAlt /></n-icon>
          </template>
        </n-button>
      </n-dropdown>
      <n-dropdown
        :options="store.menuOptions.DrawOptions"
        @select="handleDrawSelect"
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
        @select="handleNFZSelect"
      >
        <n-tooltip placement="bottom" trigger="hover">
          <template #trigger>
            <n-button
              tertiary
              circle
              :type="showNFZ ? 'error' : 'warning'"
              :loading="nfzLoading"
              @click="hideNFZ"
            >
              <template #icon>
                <n-icon v-if="showNFZ"><ShieldCheckmark /></n-icon>
                <n-icon v-else><ShieldOutline /></n-icon>
              </template>
            </n-button>
          </template>
          <!-- <span>
            {{ showNFZ ? '隐藏禁飞区' : '显示禁飞区（悬浮选择加载方式）' }}
          </span> -->
        </n-tooltip>
      </n-dropdown>
      <!-- 模拟电子围栏 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            :type="simulatedFenceVisible ? 'error' : 'warning'"
            @click="toggleSimulatedFence"
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
      <!-- UDP设置 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="openUdpSettings">
            <template #icon>
              <n-icon><Settings /></n-icon>
            </template>
          </n-button>
        </template>
        <span>通信设置</span>
      </n-tooltip>

      <!-- 模拟uavinfo -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="toggleMockFlight">
            <template #icon>
              <n-icon><CaretForwardCircleOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>模拟飞行</span>
      </n-tooltip>

      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            :type="terrainWarningActive ? 'error' : 'warning'"
            @click="toggleSelectedPlaneTerrainWarning"
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
            @click="activeCompanionMode"
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

      <!-- <n-popselect
        v-model:value="SceneValue"
        :options="store.menuOptions.sceneOptions"
        :disabled="!selectedModel && !companionMode"
        @update:value="handleSceneSelect"
        size="medium"
      >
        <n-button
          tertiary
          circle
          :disabled="!selectedModel && !companionMode"
          :type="companionMode ? 'success' : 'warning'"
        >
          <template #icon>
            <n-icon><EyeSharp /></n-icon>
          </template>
        </n-button>
      </n-popselect> -->
      <!-- 有用户选择加载机场建筑物-->
      <n-dropdown
        :options="obstacleLoadingOptions"
        @select="handleObstacleSelect"
      >
        <n-button tertiary circle type="warning">
          <!--加载机场周边障碍物-->
          <template #icon>
            <n-icon><HomeSharp /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 链路状态 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="showLinkHealthInfo">
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
          <n-button tertiary type="warning" @click="showTelemetryInfo">
            <template #icon>
              <n-icon><InformationCircleOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>航电信息</span>
      </n-tooltip>
      <!-- <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="isRouteVisiable">
            <template #icon>
              <n-icon><RadioOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>通视分析测试</span>
      </n-tooltip> -->
      <!-- 航线通视分析 -->
      <n-dropdown :options="losAnalyzeOptions" @select="handleLosAnalyseSelect">
        <n-button tertiary type="warning">
          <template #icon>
            <n-icon><RadioOutline /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

      <!-- 刷新页面 -->
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="refreshPage">
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
          <n-button tertiary type="warning" @click="minimizeApp">
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
          <n-button tertiary type="error" @click="closeApp">
            <template #icon>
              <n-icon><CloseOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>关闭程序</span>
      </n-tooltip>
      <!-- 收起工具条 -->
      <n-button tertiary circle type="warning" @click="openCloseBar">
        <template #icon>
          <!-- 显示关闭或打开按钮 -->
          <n-icon v-if="barIsOpen"><ChevronBack /></n-icon>
          <n-icon v-else><ChevronForward /></n-icon>
        </template>
      </n-button>
    </n-row>
  </n-space>
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
    <n-flex
      id="detectionGraph"
      justify="center"
      :style="{ height: detectDivHeight + 'vh' }"
    >
      <CollisionDetection ref="collisionDetection"></CollisionDetection>
    </n-flex>
  </n-collapse-transition>
  <!-- 是否显示模型 -->
  <n-modal
    v-model:show="showModal"
    style="width: 30%"
    :mask-closable="false"
    preset="dialog"
    title=""
  >
    <template #header>
      <div>WebsSocket配置</div>
    </template>
    <div style="margin: 2rem 2rem 0.5rem 1rem">
      <n-space>
        <n-form
          ref="formRef"
          :model="store.webskt.ws_config"
          label-placement="left"
          label-width="auto"
          require-mark-placement="right-hanging"
        >
          <n-form-item label="服务器地址">
            <n-input
              v-model:value="store.webskt.ws_config.address"
              placeholder="127.0.0.1"
            />
          </n-form-item>
          <n-form-item label="端口号">
            <n-input-number
              v-model:value="store.webskt.ws_config.port"
              placeholder="8000"
            />
          </n-form-item>
        </n-form>
      </n-space>
      <n-space justify="center">
        <n-button @click="connectWebSocket" type="primary" size="small">
          开启通信
        </n-button>
        <n-button @click="closeWS" type="warning" size="small">
          关闭通信
        </n-button>
      </n-space>
    </div>
  </n-modal>
  <!-- 控制是否展示Udp界面 -->
  <n-modal
    v-model:show="showUdpModal"
    style="width: 48%; min-width: 550px"
    :mask-closable="false"
    preset="dialog"
    title=""
  >
    <template #header>
      <div style="font-weight: bold; font-size: 16px">多通道通信配置</div>
    </template>
    <div
      style="margin: 1rem 1rem 0.5rem 1rem; max-height: 70vh; overflow-y: auto"
    >
      <n-space justify="end" style="margin-bottom: 0.8rem">
        <n-button @click="addCommunicationLink" type="primary" size="small">
          新增链路
        </n-button>
      </n-space>

      <div v-if="uavStore.links.length === 0" class="comms-empty-state">
        暂无链路，请点击“新增链路”。
      </div>

      <div
        v-for="link in uavStore.links"
        :key="link.id"
        class="comms-link-card"
      >
        <div class="comms-link-card__header">
          <n-input v-model:value="link.name" placeholder="链路名称" />
          <n-select
            :value="link.kind"
            :options="linkKindOptions"
            style="width: 140px"
            @update:value="updateCommunicationLinkKind(link, $event)"
          />
          <n-button
            quaternary
            type="error"
            size="small"
            @click="removeCommunicationLink(link)"
          >
            删除
          </n-button>
        </div>

        <n-form
          :model="link"
          label-placement="left"
          label-width="auto"
          size="small"
        >
          <n-form-item label="协议类型">
            <n-select
              v-model:value="link.protocol"
              :options="
                link.kind === 'serial'
                  ? serialProtocolOptions
                  : udpProtocolOptions
              "
              placeholder="请选择协议"
            />
          </n-form-item>

          <template v-if="link.kind !== 'serial'">
            <n-form-item label="目标地址">
              <n-input
                v-model:value="link.ip"
                placeholder="组播地址或远端 IPv4"
              />
            </n-form-item>
            <n-form-item label="本地监听端口">
              <n-input-number
                v-model:value="link.localPort"
                :min="1"
                :max="65535"
                :show-button="false"
              />
            </n-form-item>
            <n-form-item label="目标发送端口">
              <n-input-number
                v-model:value="link.targetPort"
                :min="1"
                :max="65535"
                :show-button="false"
              />
            </n-form-item>
            <n-form-item label="网卡绑定">
              <n-select
                v-model:value="link.interfaceIp"
                :options="interfaceOptions"
                placeholder="请选择网卡"
              />
            </n-form-item>
          </template>

          <template v-else>
            <n-form-item label="串口号">
              <n-select
                v-model:value="link.portName"
                :options="portOptions"
                placeholder="请选择串口号"
              />
            </n-form-item>
            <n-form-item label="波特率">
              <n-select
                v-model:value="link.baudRate"
                :options="baudRateOptions"
                placeholder="请选择波特率"
              />
            </n-form-item>
          </template>

          <n-form-item label="启用链路">
            <n-switch v-model:value="link.enabled" />
            <n-tag
              :type="link.enabled ? 'success' : 'default'"
              style="margin-left: 0.6rem"
            >
              {{ link.enabled ? '已启用' : '已停用' }}
            </n-tag>
          </n-form-item>
        </n-form>
      </div>
      <n-divider style="margin: 1rem 0 0.8rem 0" />
      <n-space justify="center" style="margin-bottom: 0.8rem">
        <n-button @click="handleSaveConfig" type="success" size="small">
          保存配置
        </n-button>
      </n-space>
    </div>
  </n-modal>
  <!-- 高度预警是否显示 -->
  <div v-if="terrainWarningActive" class="terrain-warning-panel">
    <div class="terrain-warning-panel__header">
      <div>
        <div class="terrain-warning-panel__title">
          高度预警: {{ terrainWarningTargetLabel }}
        </div>
      </div>

      <n-tag :type="terrainWarningIsDanger ? 'error' : 'success'" size="small">
        {{ terrainWarningIsDanger ? '预警' : '正常' }}
      </n-tag>
    </div>

    <div class="terrain-warning-panel__header">
      {{ terrainWarningStatusText }}
    </div>

    <div class="terrain-warning-panel__metrics">
      <div>
        <span>飞机高度</span>
        <strong>{{ terrainWarningAircraftHeight }}</strong>
      </div>
      <div>
        <span>预警离地高度</span>
        <strong>{{ terrainWarningClearance }} m</strong>
      </div>
    </div>

    <div class="terrain-warning-panel__controls">
      <label>
        <span>预警长度</span>
        <n-input-number
          v-model:value="terrainWarningDistanceInput"
          :min="1000"
          :max="10000"
          :step="100"
          size="small"
          @update:value="updateTerrainWarningDistance"
          @blur="restoreTerrainWarningInputs"
        >
          <template #suffix>m</template>
        </n-input-number>
      </label>
      <label>
        <span>预警离地高度</span>
        <n-input-number
          v-model:value="terrainWarningClearanceInput"
          :min="100"
          :max="2000"
          :step="10"
          size="small"
          @update:value="updateTerrainWarningClearance"
          @blur="restoreTerrainWarningInputs"
        >
          <template #suffix>m</template>
        </n-input-number>
      </label>
    </div>

    <svg
      class="terrain-profile-svg"
      :viewBox="`0 0 ${profileWidth} ${profileHeight}`"
    >
      <!-- 坐标轴 -->
      <line
        :x1="profilePadding"
        :y1="profileHeight - profilePadding"
        :x2="profileWidth - profilePadding"
        :y2="profileHeight - profilePadding"
        class="profile-axis"
      />
      <line
        :x1="profilePadding"
        :y1="profilePadding"
        :x2="profilePadding"
        :y2="profileHeight - profilePadding"
        class="profile-axis"
      />

      <!-- 地形线 -->
      <polyline
        v-if="terrainPolylinePoints"
        :points="terrainPolylinePoints"
        class="profile-terrain-line"
      />

      <!-- 飞机预计飞行轨迹线 -->
      <polyline
        v-if="flightPolylinePoints"
        :points="flightPolylinePoints"
        class="profile-flight-line"
      />

      <!-- 文本标注 -->
      <text :x="profilePadding" :y="profileHeight - 6" class="profile-label">
        0m
      </text>

      <text
        :x="profileWidth - profilePadding - 34"
        :y="profileHeight - 6"
        class="profile-label"
      >
        {{ terrainWarningDistance }}m
      </text>

      <text :x="4" :y="profilePadding + 4" class="profile-label">
        {{ profileMaxHeightLabel }}m
      </text>

      <text :x="4" :y="profileHeight - profilePadding" class="profile-label">
        {{ profileMinHeightLabel }}m
      </text>
    </svg>

    <div class="terrain-warning-panel__legend">
      <span>
        <i class="legend-line legend-line--flight"></i>
        预计轨迹
      </span>

      <span>
        <i
          class="legend-line"
          :class="
            terrainWarningIsDanger
              ? 'legend-line--terrain-danger'
              : 'legend-line--terrain-safe'
          "
        ></i>
        地形剖面
      </span>
    </div>
  </div>
  <div
    v-if="simulatedFenceVisible && simulatedFenceResults.length > 0"
    class="simulated-fence-panel"
  >
    <div class="simulated-fence-panel__header">
      <span>模拟电子围栏检测</span>
      <span class="simulated-fence-panel__radius">
        围栏 {{ simulatedFence?.radiusKm.toFixed(1) ?? '--' }} km / 内
        {{ simulatedFence?.innerBufferKm.toFixed(1) ?? '--' }} km / 外
        {{ simulatedFence?.outerBufferKm.toFixed(1) ?? '--' }} km
      </span>
    </div>
    <div
      v-for="result in simulatedFenceResults"
      :key="result.id"
      class="simulated-fence-row"
      :class="`simulated-fence-row--${result.status}`"
    >
      <div class="simulated-fence-row__title">
        <strong>{{ result.label }}</strong>
        <span>{{ result.type }}</span>
      </div>
      <div class="simulated-fence-row__metrics">
        <span :class="`simulated-fence-status--${result.status}`">
          {{ result.statusLabel }}
        </span>
        <span>
          距离围栏边界 {{ formatFenceDistance(result.distanceMeters) }}
        </span>
      </div>
    </div>
  </div>
  <SpatialAnalysis ref="spatialAnalyse"></SpatialAnalysis>
  <LayerManager ref="layerManager"></LayerManager>
  <RouteOptions
    v-model:show="showRouteModal"
    @routeDraw="startDrawRoute"
    @cancelDraw="showRouteModal = false"
  />
  <LosAnalyseOptions
    v-model:show="showLosAnalyseModal"
    @startLosAnalyse="isRouteVisiable"
    @cancelLosAnalyse="showLosAnalyseModal = false"
  />
  <MarkerDialog ref="markerDialog"></MarkerDialog>
  <AltitudeWarning :warningResult="altitudeWarningResult" />
</template>

<style>
.comms-empty-state {
  padding: 1.5rem;
  color: #999;
  text-align: center;
  border: 1px dashed #555;
  border-radius: 6px;
}

.comms-link-card {
  padding: 0.8rem;
  margin-bottom: 0.8rem;
  border: 1px solid #3d3d3d;
  border-radius: 6px;
}

.comms-link-card__header {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.8rem;
}

.comms-link-card__header .n-input {
  flex: 1;
}

.panel-toolbar989834y34 {
  position: absolute;
  top: 10px;
  left: 2px;
  background: rgb(21 21 21 / 94%);
  border-radius: 7px;
  transition: left 0.3s;
}
/* 向左移动20个单位 */
.panel-toolbar989834y34.open {
  position: absolute;
  left: -25rem;
}

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

.terrain-warning-panel {
  position: absolute;
  top: 60px;
  left: 12px;
  z-index: 9999;
  width: 380px;
  padding: 12px;
  border-radius: 8px;
  background: rgb(21 21 21 / 94%);
  color: #fff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
}

.simulated-fence-panel {
  position: absolute;
  left: 12px;
  bottom: 16px;
  z-index: 9999;
  width: min(360px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 8px;
  background: rgb(21 21 21 / 94%);
  color: #fff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
  pointer-events: auto;
}

.simulated-fence-panel__header,
.simulated-fence-row__title,
.simulated-fence-row__metrics {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.simulated-fence-panel__header {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.simulated-fence-panel__radius,
.simulated-fence-row__title span,
.simulated-fence-row__metrics span:last-child,
.simulated-fence-panel__empty {
  color: rgb(255 255 255 / 68%);
  font-size: 12px;
}

.simulated-fence-row {
  padding: 8px 9px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-left: 3px solid #42d392;
  border-radius: 5px;
  background: rgb(255 255 255 / 6%);
}

.simulated-fence-row + .simulated-fence-row {
  margin-top: 6px;
}

.simulated-fence-row--green {
  border-left-color: #67c23a;
  background: rgb(103 194 58 / 12%);
}

.simulated-fence-row--yellow {
  border-left-color: #f0c419;
  background: rgb(240 196 25 / 12%);
}

.simulated-fence-row--orange {
  border-left-color: #f39c12;
  background: rgb(243 156 18 / 12%);
}

.simulated-fence-row--red {
  border-left-color: #f56c6c;
  background: rgb(245 108 108 / 12%);
}

.simulated-fence-row__title {
  margin-bottom: 4px;
  font-size: 13px;
}

.simulated-fence-row__metrics {
  font-size: 12px;
}

.simulated-fence-status--green {
  color: #67c23a;
}

.simulated-fence-status--yellow {
  color: #f0c419;
  font-weight: 600;
}

.simulated-fence-status--orange {
  color: #f39c12;
  font-weight: 600;
}

.simulated-fence-status--red {
  color: #f56c6c;
  font-weight: 600;
}

.terrain-warning-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.terrain-warning-panel__title {
  font-size: 16px;
  font-weight: bold;
}

.terrain-warning-panel__metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.terrain-warning-panel__metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 6px;
  background: rgb(255 255 255 / 6%);
}

.terrain-warning-panel__metrics span,
.terrain-warning-panel__controls label > span {
  font-size: 12px;
  color: rgb(255 255 255 / 65%);
}

.terrain-warning-panel__metrics strong {
  font-size: 14px;
  color: #fff;
}

.terrain-warning-panel__controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}

.terrain-warning-panel__controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.terrain-profile-svg {
  width: 100%;
  height: 180px;
  border-radius: 6px;
  background: rgb(255 255 255 / 8%);
}

.profile-axis {
  stroke: rgb(255 255 255 / 45%);
  stroke-width: 1;
}

.profile-terrain-line {
  fill: none;
  stroke: #67c23a;
  stroke-width: 2.5;
}

.terrain-warning-panel:has(.n-tag--error) .profile-terrain-line {
  stroke: #f56c6c;
}

.profile-flight-line {
  fill: none;
  stroke: #00d5ff;
  stroke-width: 2.5;
  stroke-dasharray: 6 4;
}

.profile-label {
  fill: rgb(255 255 255 / 70%);
  font-size: 10px;
}

.terrain-warning-panel__legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: rgb(255 255 255 / 78%);
}

.terrain-warning-panel__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-line {
  display: inline-block;
  width: 22px;
  height: 0;
  border-top: 3px solid;
}

.legend-line--flight {
  border-color: #00d5ff;
  border-style: dashed;
}

.legend-line--terrain-safe {
  border-color: #67c23a;
}

.legend-line--terrain-danger {
  border-color: #f56c6c;
}
</style>
