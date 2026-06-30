<!--
  文件描述：工具条
  创建时间：2024/4/16 10:54
  创建人：Zhaipeixiu
-->
<script setup>
import {
  ChevronBack,
  ChevronForward,
  CreateOutline,
  DuplicateSharp,
  EyeSharp,
  Layers,
  Settings,
  ReloadSharp,
  CloseOutline,
  ShieldCheckmark,
  ShieldOutline,
  Airplane,

} from '@vicons/ionicons5'
//引入监听hooks和飞机数据状态管理

import { RulerAlt } from '@vicons/carbon'
import { TerrainSharp } from '@vicons/material'
import { DrawPolygon } from '@vicons/fa'
import { useMessage } from 'naive-ui'
import { ref, defineEmits, watch, computed } from 'vue'
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
const altitudeWarningResult = ref(null) // 高度预警结果

let nfzViewer = null
let showNFZ = ref(false)

function toggleNFZ() {
  if (!nfzViewer && window.viewer) {
    nfzViewer = new NFZViewer(window.viewer)
  }
  showNFZ.value = !showNFZ.value
  if (nfzViewer) {
    nfzViewer.toggleNFZ(showNFZ.value)
  }
}
function handleSceneSelect(key) {
  if (!hasPlane.value) return

  if (key === 'untrace') {
    window.measureViewer.setNoTrack()
    companionMode.value = false
  } else if (key === 'companion') {
    // 三维伴飞：锁定飞机在屏幕中央 + 渲染设计航线三维效果
    window.viewer.trackedEntity = window.viewer.entities.getById(
      store.uav.ModelIDinMap,
    )
    companionMode.value = true
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

function handleEditSelect(key) {
  if (key === 'createLine') {
    // 绘制航线
    showRouteModal.value = true
  } else if (key === 'marker') {
    // 标记障碍物
    markerDialog.value?.openDlg()
  } else {
    // 打开航线管理面板
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
          SceneValue.value = 'companion'
          handleSceneSelect('companion')
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
  } catch (err) {
    message.error('获取本地网卡列表失败: ' + err)
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
        SceneValue.value = 'companion'
        handleSceneSelect('companion')
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

/**
 * 绘制航线，目前只绘制任务航线
 * @param routeParams 航线属性，type:{name: string,code: number,isOpen: bool,height: number,routePts: []}
 */
function startDrawRoute(routeParams) {
  showRouteModal.value = false// 关闭航线参数窗口
  let drawLine = new RouteManageViewer(window.viewer)// 航线绘制类
  drawLine.routeParams.isClose = routeParams.isClose//是否闭合
  drawLine.routeParams.height = routeParams.height//高度
  drawLine
    .start()
    .then((result) => {
      // result[0]是经纬度坐标数组，需转换为 AirlinePoint数组
      let AirlinePoints = []
      result[0].forEach((pt, index) => {
        let AirlinePoint = {
          lon: pt.lon,
          lat: pt.lat,
          alt: pt.alt,
          ch1: routeParams.isClose ? 0 : 2,
          ch2: 0x03,
          speed: 0,
          nPt: index + 1,
        }
        AirlinePoints.push(AirlinePoint) //航点数组
      })
      AirlinePoints.at(-1).ch2 = 0x01 //最后一个航点的ch2字段设置未0x01
      //这是航线 航线加入store
      let aRoute = {
        code: routeParams.code,
        PtNum: result[0].length,
        isClose: routeParams.isClose,
        unicode: getUnicode(),
        name: routeParams.name,
        points: AirlinePoints,
        totalDistance: 0,
        isDesignRoute: true, // 标记为设计航线
      }
      useRouteStore().addRoute(aRoute)
      // 航线加入图层管理
      lStore.addLayer(aRoute.name, undefined, undefined, result[1], true)
    })
    .catch((reject) => {
      message.error(reject)
    })
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
      <!-- 地形分析 -->
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
          <n-button tertiary circle :type="showNFZ ? 'error' : 'warning'" @click="toggleNFZ">
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
        <span>UDP设置</span>
      </n-tooltip>

      <!-- 模拟uavinfo -->
       <n-tooltip placement="bottom" trigger="hover">
        <template #trigger>
          <n-button tertiary type="warning" @click="uavStore.toggleMockUavInfoService">
            <template #icon>
              <n-icon><Airplane /></n-icon>
            </template>
          </n-button>
        </template>
        <span>飞机实时位置</span>
      </n-tooltip>
       <!-- 通视和剖面 -->
      <n-popselect
        v-model:value="SceneValue"
        :options="store.menuOptions.sceneOptions"
        @update:value="handleSceneSelect"
        size="medium"
      >
        <n-button tertiary circle type="warning">
          <template #icon>
            <n-icon><EyeSharp /></n-icon>
          </template>
        </n-button>
      </n-popselect>
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
    style="width: 36%"
    :mask-closable="false"
    preset="dialog"
    title=""
  >
    <template #header>
      <div style="font-weight: bold; font-size: 16px;">多通道组播通信配置</div>
    </template>
    <div style="margin: 1rem 1rem 0.5rem 1rem">
      <n-tabs type="segment" animated>
        <!-- 通道一：UAVInfo -->
        <n-tab-pane name="uavinfo" tab="UAVInfo 遥测接收">
          <n-form
            :model="uavStore"
            label-placement="left"
            label-width="auto"
            style="margin-top: 1.2rem;"
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
            style="margin-top: 1.2rem;"
          >
            <n-form-item label="组播地址">
              <n-input v-model:value="uavStore.fp95Ip" placeholder="226.0.1.9" />
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
      </n-tabs>
    </div>
  </n-modal>

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
  left: -20rem;
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
</style>
