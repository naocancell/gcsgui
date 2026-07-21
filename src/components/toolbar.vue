<!--
  文件描述：工具条
  创建时间：2024/4/16 10:54
  创建人：Zhaipeixiu
-->
<script setup lang="ts">
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
} from '@vicons/ionicons5'
//引入监听hooks和飞机数据状态管理

import { RulerAlt } from '@vicons/carbon'
import { TerrainSharp } from '@vicons/material'
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
import { Cartesian3, Cartographic } from 'cesium'
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
import { useRouter } from 'vue-router'
import { getUnicode } from '@/types/entityoptions.ts'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { storeToRefs } from 'pinia'
//选中飞机以及高度预警
import { useSelectedPlaneStore } from '@/store/selectedPlaneStore'
import { useTerrainWarning } from '@/hooks/useTerrainWarning'
import { useMarkObstacle } from '@/hooks/useMarkObstacle.ts'
import {
  exitApplicationOnClose,
  restoreTelemetryWindow,
  telemetryWindowOptions,
} from '@/utils/telemetryWindow'

declare global {
  interface Window {
    viewer: any
    routeManageViewer?: any
    pendingSelectedRouteId?: string | number | null
  }
}
const selectedPlaneStore = useSelectedPlaneStore()
const { selectedModel, selectedMeta } = storeToRefs(selectedPlaneStore)
const terrainWarningApi = ref<ReturnType<typeof useTerrainWarning> | null>(null)

const router = useRouter()

const emit = defineEmits(['resizeMap'])
const message = useMessage()
let SceneValue
let showModal = ref(false)
let showUdpModal = ref(false)
let showRouteModal = ref(false)
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
let showNFZ = ref(false)
let mainCloseUnlisten: (() => void) | null = null

function getRouteManageViewer() {
  if (!window.viewer) {
    return null
  }

  if (!window.routeManageViewer) {
    window.routeManageViewer = new RouteManageViewer(window.viewer)
  }

  return window.routeManageViewer
}

function toggleNFZ() {
  if (!nfzViewer && window.viewer) {
    nfzViewer = new NFZViewer(window.viewer)
  }
  showNFZ.value = !showNFZ.value
  if (nfzViewer) {
    nfzViewer.toggleNFZ(showNFZ.value)
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
    }

    Cesium.Matrix4.getTranslation(
      companionModel.modelMatrix,
      targetPosition,
    )

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

function handleSceneSelect(key) {
  if (key === 'untrace') {
    stopCompanionMode()
  } else if (key === 'companion') {
    startCompanionMode()
    if (!companionMode.value) return

    // 渲染当前所有航线的三维效果
    const routeStore = useRouteStore()
    routeStore.flyRoute.forEach((route) => {
      route.isDesignRoute = true
      window.measureViewer.showDesignRoute3D(route)
    })
    // 同时渲染 layerStore 中的航线
    lStore.navi.airlines.forEach((route) => {
      route.isDesignRoute = true
      window.measureViewer.showDesignRoute3D(route)
    })
  }
}

function handleObstacleSelect(key) {
  if (key === 'loadObstacle') {
    addAllObstacles()
  }
  if (key === 'showObstacle') {
    toggleObstaclesVisible()
  }
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
//防止上一次绘制没结束
function handleEditSelect(key) {
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

function handleDrawSelect(key) {
  if (key === 'clear') {
    if (window.measureViewer.clearDraw()) {
      message.warning('无可清除图形')
    }
  } else {
    window.measureViewer.drawGraphics(key)
  }
}

// 测量菜单选中事件
function handleSelect(key) {
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
  window.measureViewer.clearDisEntity()
  window.measureViewer.activate()
}

/**
 * 清除面积测量和多点距离测量
 */
function measureEnd() {
  if (
    window.measureViewer.vertexEntities.length > 0 ||
    window.measureViewer.activeShapePoints.length > 0
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
  window.measureViewer.clearAreaEntity()
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

async function startMainSerialService() {
  try {
    await uavStore.startMainSerialService()
    message.success('主链路串口接收服务已启动')
  } catch (err) {
    message.error('启动主链路串口接收服务失败: ' + err)
  }
}

async function stopMainSerialService() {
  try {
    await uavStore.stopMainSerialService()
    message.success('主链路串口接收服务已停止')
  } catch (err) {
    message.error('停止主链路串口接收服务失败: ' + err)
  }
}

async function startSubSerialService() {
  try {
    await uavStore.startSubSerialService()
    message.success('副链路串口接收服务已启动')
  } catch (err) {
    message.error('启动副链路串口接收服务失败: ' + err)
  }
}

async function stopSubSerialService() {
  try {
    await uavStore.stopSubSerialService()
    message.success('副链路串口接收服务已停止')
  } catch (err) {
    message.error('停止副链路串口接收服务失败: ' + err)
  }
}

async function startUavInfoService() {
  try {
    await uavStore.startUavService()
    message.success('UAVInfo 组播接收服务已启动')
  } catch (err) {
    message.error('启动 UAVInfo 接收服务失败: ' + err)
  }
}

async function stopUavInfoService() {
  try {
    await uavStore.stopUavService()
    message.success('UAVInfo 组播接收服务已停止')
  } catch (err) {
    message.error('停止 UAVInfo 接收服务失败: ' + err)
  }
}

async function startFp95Service() {
  try {
    await uavStore.startFp95Service()
    message.success('FP95 (ADSB) 组播接收服务已启动')
  } catch (err) {
    message.error('启动 FP95 接收服务失败: ' + err)
  }
}

async function stopFp95Service() {
  try {
    await uavStore.stopFp95Service()
    message.success('FP95 (ADSB) 组播接收服务已停止')
  } catch (err) {
    message.error('停止 FP95 接收服务失败: ' + err)
  }
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
    message.warning('请先结束当前航线绘制或编辑操作')
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
//拿到选中的飞机模型的世界坐标
function getSelectedAircraftPosition() {
  const model = selectedModel.value
  if (!model || model.isDestroyed()) return undefined

  return Cesium.Matrix4.getTranslation(
    model.modelMatrix,
    new Cesium.Cartesian3(),
  )
}
//拿到选中的飞机模型的heading
function getSelectedAircraftHeading() {
  const meta = selectedMeta.value
  if (!meta) return undefined

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

onMounted(async () => {
  const mainWindow = getCurrentWindow()
  mainCloseUnlisten = await mainWindow.onCloseRequested(async (event) => {
    await exitApplicationOnClose(event, () => invoke('close_app'))
  })

  if (!window.viewer) return

  terrainWarningApi.value = useTerrainWarning(
    window.viewer,
    getSelectedAircraftPosition,
    getSelectedAircraftHeading,
    {
      distance: 10000,
      steps: 50, //每1000米采样10个点
      intervalMs: 100,
      warnClearance: 100,
    }, //传递的参数
  )
})

onBeforeUnmount(() => {
  stopCompanionMode()
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

const terrainProfilePoints = computed(
  () => terrainWarningApi.value?.profilePoints ?? [],
)

const terrainWarningDistance = computed(
  () => terrainWarningApi.value?.distance ?? 1000,
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
    return
  }

  if (!selectedModel.value || !selectedMeta.value) {
    message.warning('请先选中一架飞机')
    return
  }

  terrainWarningApi.value?.start()
}

const { addAllObstacles, toggleObstaclesVisible } = useMarkObstacle()

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
      <n-dropdown
        :options="store.menuOptions.AnalyzeOptions"
        @select="handleAnalyseSelect"
      >
        <n-button tertiary type="warning">
          <template #icon>
            <n-icon><TerrainSharp /></n-icon>
          </template>
        </n-button>
      </n-dropdown>
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
        @select="handleSelect"
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
      <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button
            tertiary
            circle
            :type="showNFZ ? 'error' : 'warning'"
            @click="toggleNFZ"
          >
            <template #icon>
              <n-icon v-if="showNFZ"><ShieldCheckmark /></n-icon>
              <n-icon v-else><ShieldOutline /></n-icon>
            </template>
          </n-button>
        </template>
        <span>{{ showNFZ ? '关闭禁飞区' : '显示禁飞区' }}</span>
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
          <n-button
            tertiary
            type="warning"
            @click="uavStore.toggleMockUavInfoService"
          >
            <template #icon>
              <n-icon><Airplane /></n-icon>
            </template>
          </n-button>
        </template>
        <span>飞机实时位置</span>
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
              <n-icon><Airplane /></n-icon>
            </template>
          </n-button>
        </template>
        <span>
          {{ terrainWarningActive ? '关闭高度预警' : '开启高度预警' }}
        </span>
      </n-tooltip>

      <!-- 通视和剖面 -->
      <n-popselect
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
      </n-popselect>
      <!-- 有用户选择加载机场建筑物-->
      <n-dropdown
        :options="store.menuOptions.obstacleOptions"
        @select="handleObstacleSelect"
      >
        <n-button tertiary circle type="warning">
          <!--加载机场周边障碍物-->
          <template #icon>
            <n-icon><HomeSharp /></n-icon>
          </template>
        </n-button>
      </n-dropdown>

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
    <div style="margin: 1rem 1rem 0.5rem 1rem">
      <n-tabs type="segment" animated>
        <!-- 通道一：UAVInfo -->
        <n-tab-pane name="uavinfo" tab="UAVInfo 遥测接收">
          <n-form
            :model="uavStore"
            label-placement="left"
            label-width="auto"
            style="margin-top: 1.2rem"
          >
            <n-form-item label="组播地址">
              <n-input v-model:value="uavStore.udpIp" placeholder="226.0.1.9" />
            </n-form-item>
            <n-form-item label="本地接收端口">
              <n-input-number
                v-model:value="uavStore.udpPort"
                :show-button="false"
                placeholder="8999"
              />
            </n-form-item>
            <n-form-item label="目标发送端口">
              <n-input-number
                v-model:value="uavStore.udpTargetPort"
                :show-button="false"
                placeholder="9001"
              />
            </n-form-item>
            <n-form-item label="网卡绑定">
              <n-select
                v-model:value="uavStore.udpInterface"
                :options="interfaceOptions"
                placeholder="请选择网卡"
              />
            </n-form-item>
            <n-form-item label="运行状态">
              <n-tag :type="uavStore.isServiceRunning ? 'success' : 'error'">
                {{ uavStore.isServiceRunning ? '监听中' : '已停止' }}
              </n-tag>
            </n-form-item>
          </n-form>
          <n-space justify="center" style="margin-top: 1rem">
            <n-button @click="startUavInfoService" type="primary" size="small">
              开启通信
            </n-button>
            <n-button @click="stopUavInfoService" type="warning" size="small">
              关闭通信
            </n-button>
          </n-space>
        </n-tab-pane>

        <!-- 通道二：FP95 (ADSB) -->
        <n-tab-pane name="fp95" tab="FP95 (ADSB) 接收">
          <n-form
            :model="uavStore"
            label-placement="left"
            label-width="auto"
            style="margin-top: 1.2rem"
          >
            <n-form-item label="组播地址">
              <n-input
                v-model:value="uavStore.fp95Ip"
                placeholder="226.0.1.9"
              />
            </n-form-item>
            <n-form-item label="本地接收端口">
              <n-input-number
                v-model:value="uavStore.fp95Port"
                :show-button="false"
                placeholder="8999"
              />
            </n-form-item>
            <n-form-item label="网卡绑定">
              <n-select
                v-model:value="uavStore.fp95Interface"
                :options="interfaceOptions"
                placeholder="请选择网卡"
              />
            </n-form-item>
            <n-form-item label="运行状态">
              <n-tag :type="uavStore.isFp95Running ? 'success' : 'error'">
                {{ uavStore.isFp95Running ? '监听中' : '已停止' }}
              </n-tag>
            </n-form-item>
          </n-form>
          <n-space justify="center" style="margin-top: 1rem">
            <n-button @click="startFp95Service" type="primary" size="small">
              开启通信
            </n-button>
            <n-button @click="stopFp95Service" type="warning" size="small">
              关闭通信
            </n-button>
          </n-space>
        </n-tab-pane>

        <!-- 通道三：主链路 (串口) -->
        <n-tab-pane name="main_serial" tab="主链路 (串口)">
          <n-form
            :model="uavStore"
            label-placement="left"
            label-width="auto"
            style="margin-top: 1.2rem"
          >
            <n-form-item label="串口号">
              <n-select
                v-model:value="uavStore.mainSerialPort"
                :options="portOptions"
                placeholder="请选择串口号"
              />
            </n-form-item>
            <n-form-item label="波特率">
              <n-select
                v-model:value="uavStore.mainSerialBaud"
                :options="baudRateOptions"
                placeholder="请选择波特率"
              />
            </n-form-item>
            <n-form-item label="协议类型">
              <n-select
                v-model:value="uavStore.mainSerialProtocol"
                :options="serialProtocolOptions"
                placeholder="请选择协议"
              />
            </n-form-item>
            <n-form-item label="运行状态">
              <n-tag :type="uavStore.isMainSerialRunning ? 'success' : 'error'">
                {{ uavStore.isMainSerialRunning ? '监听中' : '已停止' }}
              </n-tag>
            </n-form-item>
          </n-form>
          <n-space justify="center" style="margin-top: 1rem">
            <n-button
              @click="startMainSerialService"
              type="primary"
              size="small"
            >
              开启通信
            </n-button>
            <n-button
              @click="stopMainSerialService"
              type="warning"
              size="small"
            >
              关闭通信
            </n-button>
          </n-space>
        </n-tab-pane>

        <!-- 通道四：副链路 (串口) -->
        <n-tab-pane name="sub_serial" tab="副链路 (串口)">
          <n-form
            :model="uavStore"
            label-placement="left"
            label-width="auto"
            style="margin-top: 1.2rem"
          >
            <n-form-item label="串口号">
              <n-select
                v-model:value="uavStore.subSerialPort"
                :options="portOptions"
                placeholder="请选择串口号"
              />
            </n-form-item>
            <n-form-item label="波特率">
              <n-select
                v-model:value="uavStore.subSerialBaud"
                :options="baudRateOptions"
                placeholder="请选择波特率"
              />
            </n-form-item>
            <n-form-item label="协议类型">
              <n-select
                v-model:value="uavStore.subSerialProtocol"
                :options="serialProtocolOptions"
                placeholder="请选择协议"
              />
            </n-form-item>
            <n-form-item label="运行状态">
              <n-tag :type="uavStore.isSubSerialRunning ? 'success' : 'error'">
                {{ uavStore.isSubSerialRunning ? '监听中' : '已停止' }}
              </n-tag>
            </n-form-item>
          </n-form>
          <n-space justify="center" style="margin-top: 1rem">
            <n-button
              @click="startSubSerialService"
              type="primary"
              size="small"
            >
              开启通信
            </n-button>
            <n-button @click="stopSubSerialService" type="warning" size="small">
              关闭通信
            </n-button>
          </n-space>
        </n-tab-pane>
      </n-tabs>
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
        <div class="terrain-warning-panel__title">高度预警</div>
        <div class="terrain-warning-panel__sub-title">
          前方 {{ terrainWarningDistance }} m 地形剖面
        </div>
      </div>

      <n-tag :type="terrainWarningIsDanger ? 'error' : 'success'" size="small">
        {{ terrainWarningIsDanger ? '预警' : '正常' }}
      </n-tag>
    </div>

    <div class="terrain-warning-panel__status">
      {{ terrainWarningStatusText }}
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
  <SpatialAnalysis ref="spatialAnalyse"></SpatialAnalysis>
  <LayerManager ref="layerManager"></LayerManager>
  <RouteOptions
    v-model:show="showRouteModal"
    @routeDraw="startDrawRoute"
    @cancelDraw="showRouteModal = false"
  />
  <MarkerDialog ref="markerDialog"></MarkerDialog>
  <AltitudeWarning :warningResult="altitudeWarningResult" />
</template>

<style>
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

.terrain-warning-panel__sub-title {
  margin-top: 2px;
  font-size: 12px;
  color: rgb(255 255 255 / 65%);
}

.terrain-warning-panel__status {
  margin-bottom: 8px;
  font-size: 13px;
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
