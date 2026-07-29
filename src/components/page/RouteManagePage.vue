<script setup lang="ts">
import {
  ArrowBackOutline,
  ArrowForwardOutline,
  Add,
  SaveOutline,
  FolderOpenOutline,
  DownloadOutline,
  EyeOutline,
  EyeOffOutline,
} from '@vicons/ionicons5'
import { nextTick, onBeforeUnmount, onMounted, ref, computed } from 'vue'
import { darkTheme, useMessage, useDialog } from 'naive-ui'
import { useRouteStore } from '@/store/RouteStore.ts'
import type { Airline } from '@/types/entityoptions.ts'
import { newAirline, newAirlinePt } from '@/assets/js/TypeInitial.ts'
import * as echarts from 'echarts'
import type { EChartsType } from 'echarts'
import { getDistance, transLonlat2Car3 } from '@/utils/map/geocomputation.ts'
import {
  drawEcharts_RouteDetection,
  profileAnalyseAtTerrainLevel,
} from '@/utils/map/SpatialAnalysis.ts'
import RouteManageViewer from '@/assets/js/RouteManageViewer.js'
import {
  query_surface_forecast,
  query_upper_forecast,
  requireWeatherLevel,
} from '@/assets/js/weatherRequest.ts'
import { setChartOptions } from '@/assets/js/weatherCharts.ts'
import type { NotificationType } from 'naive-ui'
import { useNotification } from 'naive-ui'
import { useStaticStore } from '@/store/staticOptions'
import { invoke } from '@tauri-apps/api/core'
import { useUavStore } from '@/store/uavStore.ts'
import { ArrowRight } from '@vicons/carbon'

declare global {
  interface Window {
    viewer: any
    routeManageViewer?: any
    pendingSelectedRouteId?: string | number | null
  }
}

type RouteProfileChartData = {
  distanceArray: number[]
  elevationArray: number[]
  orderArr: number[]
  heightArr: number[]
  routeDistanceArr: number[]
}

type RouteProfileCacheEntry = {
  routeCode: string
  data: RouteProfileChartData
}

let isRouteEditing = ref(false)
let routeDirty = ref(false)

let myChart: EChartsType | undefined = undefined
let weatherChart: EChartsType | undefined = undefined
let profileChartResizeObserver: ResizeObserver | null = null

const MAX_ROUTE_PROFILE_SAMPLES = 5000
const ROUTE_PROFILE_TERRAIN_LEVEL = 11

const routeStore = useRouteStore()
const sStore = useStaticStore()
const uavStore = useUavStore()

let selectedRouteCode = ref<string | number | null>(null)
let selectedLevel = ref<number | null>(null)
let showPtList = ref(true)
let selectedRoute = ref<Airline>(newAirline())

let routeManage: any = null
let routePtNumber = ref(1)
let uiMsg = useMessage()
const dialog = useDialog()
let nowTime = ref('')
let timer: ReturnType<typeof setInterval> | null = null
let profileRefreshTimer: ReturnType<typeof setTimeout> | null = null
let profileSamplingTimer: ReturnType<typeof setTimeout> | null = null
let profileSamplingFrame: number | null = null
let profileSamplingRequestId = 0
let profileInterval = ref<number | null>(1000)
const routeProfileCache = new Map<string, RouteProfileCacheEntry>()

let activeTab = ref<'detail' | 'profile' | 'weather'>('detail')
let routeDrawingBlockTipAt = 0

const PtOptions = [
  { label: '在前面插入', key: 'insertBefore' },
  { label: '在后面插入', key: 'insertAfter' },
  { label: '删除航点', key: 'deletePt' },
]

const routeCode = [
  { label: '任务航线1', value: 1 },
  { label: '任务航线2', value: 2 },
  { label: '任务航线3', value: 3 },
  { label: '任务航线4', value: 4 },
  { label: '任务航线5', value: 5 },
]

let levelOptions = ref<any[]>([])

const notification = useNotification()

const routesListRef = computed(() => {
  return routeStore.flyRoute.map((route) => {
    return {
      value: route.unicode,
      label: route.name,
      visible: route.isVisible !== false,
    }
  })
})

const hasSelectedRoute = computed(() => {
  return (
    !!selectedRoute.value?.unicode &&
    selectedRoute.value.isVisible !== false &&
    selectedRoute.value.points?.length > 0
  )
})

const canEditSelectedRoute = computed(() => {
  return (
    hasSelectedRoute.value &&
    !isRouteEditing.value &&
    routeStore.routeActionMode === 'idle'
  )
})

const notify = (type: NotificationType, title: string, detail: string) => {
  notification[type]({
    title,
    meta: detail,
    duration: 3000,
    closable: true,
    keepAliveOnHover: true,
  })
}

function isRouteActionIdle() {
  const viewerMode = routeManage?.mode

  return (
    routeStore.routeActionMode === 'idle' &&
    !isRouteEditing.value &&
    viewerMode !== 'drawing' &&
    viewerMode !== 'editing'
  )
}

function isRouteDrawing() {
  return (
    routeStore.routeActionMode === 'drawing' || routeManage?.mode === 'drawing'
  )
}

function warnRouteActionBusy() {
  if (routeStore.routeActionMode === 'losPointPicking') {
    uiMsg.warning('请先完成或取消地图选点')
    return
  }

  if (isRouteDrawing()) {
    uiMsg.warning('请先结束绘制')
    return
  }

  uiMsg.warning('请结束绘制或编辑')
}

function ensureRouteActionIdle() {
  if (isRouteActionIdle()) return true

  warnRouteActionBusy()
  return false
}

function blockRouteManageWhenDrawing(event: Event) {
  if (!isRouteDrawing()) return

  const target = event.target as HTMLElement | null

  if (target?.closest('[data-route-manage-close="true"]')) {
    return
  }

  if (target?.closest('[data-route-visibility-toggle="true"]')) {
    return
  }

  const now = Date.now()
  if (now - routeDrawingBlockTipAt > 800) {
    uiMsg.warning('请先结束绘制')
    routeDrawingBlockTipAt = now
  }

  event.preventDefault()
  event.stopPropagation()

  const immediateEvent = event as Event & {
    stopImmediatePropagation?: () => void
  }

  immediateEvent.stopImmediatePropagation?.()
}

onMounted(() => {
  if (!window.routeManageViewer) {
    window.routeManageViewer = new RouteManageViewer(window.viewer)
  }

  routeManage = window.routeManageViewer

  routeStore.flyRoute.forEach((route) => {
    route.isVisible = route.isVisible !== false
    routeManage.setRouteVisibility?.(route.unicode, route.isVisible)
  })

  // 兼容你 RouteManageViewer 构造函数没有接 options 的情况，直接挂回调
  routeManage.onRouteSelected = (routeId: string, line: Airline) => {
    selectedRouteCode.value = routeId
    selectedRoute.value = line
    routeDirty.value = false
    refreshSelectedRouteView({
      refreshWeather: true,
      forceRefreshPtList: true,
    })
  }
  //当航线被编辑变化后会执行这个回调
  routeManage.onRouteChanged = (line: Airline) => {
    selectedRoute.value = line //这是被编辑后的最新航线
    routeDirty.value = true

    normalizeRouteForBiz(selectedRoute.value)
    scheduleProfileRefresh() //剖面刷新

    refreshPtList() //刷新航点详情列表
  }

  routeManage.onEditStateChanged = (editing: boolean) => {
    isRouteEditing.value = editing
  }

  const profileChartElement = document.getElementById('echarts-profile')

  if (profileChartElement && typeof ResizeObserver !== 'undefined') {
    profileChartResizeObserver = new ResizeObserver(() => {
      resizeProfileChart()
    })
    profileChartResizeObserver.observe(profileChartElement)
  }

  weatherChart = echarts.init(document.getElementById('weatherChart'), 'dark')

  timer = setInterval(getTimesInterval, 1000)

  requireWeatherLevel().then((res) => {
    if (!res.data.success) {
      notify('error', '气象信息查询失败', res.data.message)
      return
    }

    levelOptions.value =
      res.data.data.levelsAvailableList[0].pressureLevels.map(
        (level, index) => {
          return {
            value: level,
            label:
              level +
              'hPa/ ' +
              res.data.data.levelsAvailableList[0].heightLevels[index] +
              'm',
          }
        },
      )

    levelOptions.value.reverse()
    levelOptions.value.unshift({ value: -1, label: '地面' })
    selectedLevel.value = -1
  })

  window.addEventListener(
    'route-created-and-select',
    handleRouteCreatedAndSelect as EventListener,
  )

  nextTick(() => {
    if (window.pendingSelectedRouteId != null) {
      selectRouteById(window.pendingSelectedRouteId)
      window.pendingSelectedRouteId = null
    }
  })
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  if (profileRefreshTimer) {
    clearTimeout(profileRefreshTimer)
    profileRefreshTimer = null
  }

  cancelPendingProfileSampling()
  profileChartResizeObserver?.disconnect()
  profileChartResizeObserver = null

  window.removeEventListener(
    'route-created-and-select',
    handleRouteCreatedAndSelect as EventListener,
  )

  if (routeManage) {
    routeManage.onRouteSelected = undefined
    routeManage.onRouteChanged = undefined
    routeManage.onEditStateChanged = undefined
    routeManage.onVertexSelected = undefined
  }

  myChart?.dispose()
  weatherChart?.dispose()
})

function switchTab(tab: 'detail' | 'profile' | 'weather') {
  activeTab.value = tab

  if (tab !== 'profile') {
    if (profileRefreshTimer) {
      clearTimeout(profileRefreshTimer)
      profileRefreshTimer = null
    }

    cancelPendingProfileSampling()
  }

  nextTick(() => {
    if (tab === 'profile') {
      resizeProfileChart()

      if (hasSelectedRoute.value) {
        drawRouteProfile(selectedRoute.value)
      }
    }

    if (tab === 'weather') {
      weatherChart?.resize()

      if (hasSelectedRoute.value) {
        refreshWeatherOfCurrentPoint()
      }
    }
  })
}

function getTimesInterval() {
  const now = new Date()
  const year = now.getFullYear()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  const seconds = now.getSeconds().toString().padStart(2, '0')

  nowTime.value = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/**
 * 统一整理航线业务字段。
 */
function normalizeRouteForBiz(route: Airline) {
  if (!route?.points) return

  route.points.forEach((pt, index) => {
    pt.nPt = index + 1

    if (pt.lon == null) pt.lon = 0
    if (pt.lat == null) pt.lat = 0
    if (pt.alt == null) pt.alt = 0
    if (pt.speed == null) pt.speed = 0
    if (pt.ch1 == null) pt.ch1 = 0

    pt.ch2 = 3
  })

  if (route.points.length > 0) {
    const lastPt = route.points[route.points.length - 1]
    lastPt.ch2 = 1
    lastPt.ch1 = route.isClose ? 0 : 2
  }

  route.PtNum = route.points.length
}

function getMinimumRoutePointCount(route: Pick<Airline, 'isClose'>) {
  return route.isClose ? 3 : 2
}

function getRoutePointCountWarning(route: Pick<Airline, 'isClose'>) {
  const minimum = getMinimumRoutePointCount(route)
  return `${route.isClose ? '闭合' : '非闭合'}航线至少需要 ${minimum} 个航点`
}

/**
 * 如果导入文件里已经把首点重复写到了末尾，闭合航线只保留真实航点。
 */
function removeDuplicatedClosingPoint(route: Airline) {
  if (!route?.isClose || !route.points || route.points.length < 3) return

  const first = route.points[0]
  const last = route.points[route.points.length - 1]

  const alreadyClosed =
    Math.abs(first.lon - last.lon) < 1e-8 &&
    Math.abs(first.lat - last.lat) < 1e-8 &&
    Math.abs(first.alt - last.alt) < 1e-3

  if (alreadyClosed) {
    route.points.pop()
  }

  normalizeRouteForBiz(route)
}
//刷新航点详情列表
function refreshPtList() {
  showPtList.value = false
  nextTick(() => {
    showPtList.value = true
  })
}

/**
 * 闭合航线用于剖面图时，临时追加首点，不修改原始数据。
 */
function getProfilePoints(route: Airline) {
  const points = route.points.map((pt) => ({ ...pt }))

  if (!route.isClose || points.length < 2) {
    return points
  }

  const first = points[0]
  const last = points[points.length - 1]

  const alreadyClosed =
    Math.abs(first.lon - last.lon) < 1e-8 &&
    Math.abs(first.lat - last.lat) < 1e-8 &&
    Math.abs(first.alt - last.alt) < 1e-3

  if (!alreadyClosed) {
    points.push({
      ...first,
      nPt: points.length + 1,
    })
  }

  return points
}

function getRouteProfileDistances(
  cartesianPositions: ReturnType<typeof transLonlat2Car3>,
) {
  const distances = [0]

  for (let index = 1; index < cartesianPositions.length; index++) {
    const segmentDistance = Math.round(
      getDistance(cartesianPositions[index - 1], cartesianPositions[index]) *
        1000,
    )

    distances.push(distances[index - 1] + segmentDistance)
  }

  return distances
}

function getEffectiveProfileInterval(
  routeDistanceArr: number[],
  segmentCount: number,
  requestedInterval: number,
) {
  const totalDistance = routeDistanceArr[routeDistanceArr.length - 1] ?? 0
  const availableSamples = Math.max(
    1,
    MAX_ROUTE_PROFILE_SAMPLES - segmentCount * 2,
  )

  return Math.max(
    requestedInterval,
    Math.ceil(totalDistance / availableSamples),
  )
}

function getProfileInterval() {
  return Math.max(100, profileInterval.value ?? 1000)
}

function getRouteProfileCacheKey(
  route: Airline,
  interval = getProfileInterval(),
) {
  return JSON.stringify([
    String(route.unicode),
    interval,
    ROUTE_PROFILE_TERRAIN_LEVEL,
    Boolean(route.isClose),
    route.points.map((point) => [
      Number(point.lon),
      Number(point.lat),
      Number(point.alt),
    ]),
  ])
}

function cacheRouteProfile(
  route: Airline,
  cacheKey: string,
  data: RouteProfileChartData,
) {
  routeProfileCache.delete(cacheKey)
  routeProfileCache.set(cacheKey, {
    routeCode: String(route.unicode),
    data,
  })

  if (routeProfileCache.size > 20) {
    const oldestKey = routeProfileCache.keys().next().value
    if (oldestKey) routeProfileCache.delete(oldestKey)
  }
}

function clearRouteProfileCache(routeCode: string | number) {
  const normalizedRouteCode = String(routeCode)

  routeProfileCache.forEach((entry, cacheKey) => {
    if (entry.routeCode === normalizedRouteCode) {
      routeProfileCache.delete(cacheKey)
    }
  })
}

function ensureProfileChart() {
  const element = document.getElementById('echarts-profile')

  if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) {
    return undefined
  }

  if (!myChart || myChart.isDisposed()) {
    myChart = echarts.getInstanceByDom(element) ?? echarts.init(element, 'dark')
  }

  return myChart
}

function resizeProfileChart() {
  ensureProfileChart()?.resize()
}

function renderRouteProfile(data: RouteProfileChartData) {
  const chart = ensureProfileChart()
  if (!chart) return

  drawEcharts_RouteDetection(
    chart,
    data.distanceArray,
    data.elevationArray,
    data.orderArr,
    data.heightArr,
    data.routeDistanceArr,
  )

  requestAnimationFrame(() => {
    if (!chart.isDisposed()) chart.resize()
  })
}

function cancelPendingProfileSampling() {
  profileSamplingRequestId += 1

  if (profileSamplingFrame != null) {
    cancelAnimationFrame(profileSamplingFrame)
    profileSamplingFrame = null
  }

  if (profileSamplingTimer) {
    clearTimeout(profileSamplingTimer)
    profileSamplingTimer = null
  }

  myChart?.hideLoading()
}

function showRouteProfileLoading() {
  ensureProfileChart()?.showLoading('default', {
    text: '正在采样中',
    color: '#63e2b7',
    textColor: '#ffffff',
    maskColor: 'rgba(16, 16, 20, 0.88)',
  })
}

function drawRouteProfile(route: Airline, options?: { force?: boolean }) {
  cancelPendingProfileSampling()

  if (!route?.points || route.points.length < 2) {
    myChart?.clear()
    return
  }

  const interval = getProfileInterval()
  const cacheKey = getRouteProfileCacheKey(route, interval)
  const cachedProfile = options?.force
    ? undefined
    : routeProfileCache.get(cacheKey)

  if (cachedProfile) {
    renderRouteProfile(cachedProfile.data)
    return
  }

  const profilePoints = getProfilePoints(route)
  const routeIsClose = Boolean(route.isClose)

  showRouteProfileLoading()

  const requestId = ++profileSamplingRequestId

  profileSamplingFrame = requestAnimationFrame(() => {
    profileSamplingFrame = null

    profileSamplingTimer = setTimeout(async () => {
      profileSamplingTimer = null

      if (requestId !== profileSamplingRequestId) return

      try {
        const cartesianPositions = transLonlat2Car3(profilePoints)
        const routeDistanceArr = getRouteProfileDistances(cartesianPositions)
        const effectiveInterval = getEffectiveProfileInterval(
          routeDistanceArr,
          Math.max(0, cartesianPositions.length - 1),
          interval,
        )
        const result = await profileAnalyseAtTerrainLevel(
          window.viewer,
          cartesianPositions,
          effectiveInterval,
          ROUTE_PROFILE_TERRAIN_LEVEL,
        )

        if (requestId !== profileSamplingRequestId) return

        if (result.terrainLevel !== ROUTE_PROFILE_TERRAIN_LEVEL) {
          console.info(
            `航线地形剖面使用 ${result.terrainLevel} 级地形（请求等级 ${ROUTE_PROFILE_TERRAIN_LEVEL}）`,
          )
        }
        const data: RouteProfileChartData = {
          distanceArray: result.distanceArray,
          elevationArray: result.elevationArray,
          orderArr: profilePoints.map((_, index) => {
            if (routeIsClose && index === profilePoints.length - 1) {
              return 1
            }

            return index + 1
          }),
          heightArr: profilePoints.map((point) => point.alt),
          routeDistanceArr,
        }

        cacheRouteProfile(route, cacheKey, data)

        renderRouteProfile(data)
      } catch (error) {
        if (requestId !== profileSamplingRequestId) return

        console.error('[drawRouteProfile] 地形剖面采样失败：', error)
        uiMsg.error('地形剖面采样失败')
      } finally {
        if (requestId === profileSamplingRequestId) {
          myChart?.hideLoading()
        }
      }
    }, 0)
  })
}

function redrawRouteProfile() {
  if (!hasSelectedRoute.value) return

  drawRouteProfile(selectedRoute.value, { force: true })
}

function handleProfileIntervalChanged() {
  cancelPendingProfileSampling()
}

function scheduleProfileRefresh() {
  if (profileRefreshTimer) {
    clearTimeout(profileRefreshTimer)
    profileRefreshTimer = null
  }

  if (activeTab.value !== 'profile') return

  cancelPendingProfileSampling()

  profileRefreshTimer = setTimeout(() => {
    profileRefreshTimer = null

    if (activeTab.value !== 'profile') return

    drawRouteProfile(selectedRoute.value)
  }, 200)
}

function refreshWeatherOfCurrentPoint() {
  if (!selectedRoute.value?.points?.length) {
    weatherChart?.clear()
    return
  }

  if (routePtNumber.value > selectedRoute.value.points.length) {
    routePtNumber.value = selectedRoute.value.points.length
  }

  if (routePtNumber.value < 1) {
    routePtNumber.value = 1
  }

  const currentPoint = selectedRoute.value.points[routePtNumber.value - 1]

  if (currentPoint?.lon != null && currentPoint?.lat != null) {
    queryWeather(
      currentPoint.lon,
      currentPoint.lat,
      Number(selectedLevel.value),
    )
  } else {
    weatherChart?.clear()
  }
}

function refreshSelectedRouteView(options?: {
  refreshWeather?: boolean
  forceRefreshPtList?: boolean
}) {
  if (!selectedRoute.value?.points) return

  normalizeRouteForBiz(selectedRoute.value)

  if (routePtNumber.value > selectedRoute.value.points.length) {
    routePtNumber.value = selectedRoute.value.points.length
  }

  if (routePtNumber.value < 1) {
    routePtNumber.value = 1
  }

  if (options?.forceRefreshPtList) {
    refreshPtList()
  }

  const routeToProfile = selectedRoute.value
  const routeToProfileCode = String(routeToProfile?.unicode ?? '')

  if (options?.refreshWeather && activeTab.value === 'weather') {
    refreshWeatherOfCurrentPoint()
  }

  nextTick(() => {
    if (activeTab.value === 'profile') {
      resizeProfileChart()

      if (
        routeToProfile &&
        hasSelectedRoute.value &&
        String(selectedRoute.value.unicode) === routeToProfileCode
      ) {
        drawRouteProfile(routeToProfile)
      }
    }

    if (activeTab.value === 'weather') weatherChart?.resize()
  })
}
function flyToRoute(route: Airline, duration = 1.5) {
  if (!routeManage || !route?.unicode) return

  nextTick(() => {
    let ok = false

    if (routeManage.flyToRoute) {
      ok = routeManage.flyToRoute(route, duration)
    }

    if (ok) return

    const entity = getRouteEntity(route)

    if (!entity) {
      console.warn('[flyToRoute] 未找到航线实体', route.unicode)
      return
    }

    window.viewer.flyTo(entity, {
      duration,
    })

    window.viewer.scene.requestRender()
  })
}
/**
 * 地图实体同步。
 * 右侧表格、插入、删除、开闭切换、保存都会走这里。
 */
function updateMapRoute(options?: {
  rebuildVertex?: boolean
  flyTo?: boolean
  duration?: number
}) {
  if (!routeManage || !selectedRoute.value?.unicode) return undefined

  normalizeRouteForBiz(selectedRoute.value)

  let entity

  if (routeManage.updateRouteEntity) {
    routeManage.updateRouteEntity(selectedRoute.value, {
      rebuildVertex: options?.rebuildVertex ?? true,
      silent: true,
    })

    entity = getRouteEntity(selectedRoute.value)
  } else {
    routeManage.removeRoute(selectedRoute.value)
    entity = routeManage.addAirLine(selectedRoute.value)
  }

  // 编辑状态下不要 selectRoute，否则会把 mode 从 editing 打回 selected，
  // 导致地图失去拖拽/右键/高亮，
  if (!isRouteEditing.value) {
    routeManage.selectRoute?.(selectedRoute.value.unicode)
  }

  const routeItem = routeManage.routesMap?.get?.(
    String(selectedRoute.value.unicode),
  )

  if (routeItem?.entity) {
    routeItem.entity.name = selectedRoute.value.name
    entity = routeItem.entity
  }

  window.viewer.scene.requestRender()

  if (options?.flyTo) {
    flyToRoute(selectedRoute.value, options.duration ?? 1.5)
  }

  return entity
}

function getRouteEntity(route: Airline) {
  if (!routeManage || !route?.unicode) return undefined

  const routeId = String(route.unicode)

  return (
    routeManage.routesMap?.get?.(routeId)?.entity ||
    window.viewer.entities.getById('航线' + routeId)
  )
}

/**
 * 统一选中并显示航线。
 */
function selectAndShowRoute(
  route: Airline,
  options?: { flyTo?: boolean; refreshWeather?: boolean },
) {
  if (!routeManage || !route || route.isVisible === false) return

  normalizeRouteForBiz(route)

  selectedRoute.value = route
  selectedRouteCode.value = route.unicode

  routeManage.routeParams.isClose = route.isClose

  let entity

  if (routeManage.updateRouteEntity) {
    routeManage.updateRouteEntity(route, {
      rebuildVertex: true,
      silent: true,
    })

    entity = getRouteEntity(route)
  } else {
    routeManage.removeRoute(route)
    entity = routeManage.addAirLine(route)
  }

  routeManage.selectRoute?.(route.unicode)

  routeDirty.value = false

  refreshSelectedRouteView({
    refreshWeather: options?.refreshWeather ?? true,
    forceRefreshPtList: true,
  })

  if (options?.flyTo) {
    flyToRoute(route, 2)
  }

  return entity
}

/**
 * 航线选择。
 */
function checkRoute(key: number | string) {
  if (!ensureRouteActionIdle()) {
    selectedRouteCode.value = selectedRoute.value?.unicode ?? null
    return
  }

  if (!isRouteVisible(key)) {
    uiMsg.warning('请先显示该航线')
    selectedRouteCode.value = selectedRoute.value?.unicode ?? null
    return
  }

  if (
    isRouteEditing.value &&
    routeDirty.value &&
    selectedRoute.value?.unicode &&
    String(key) !== String(selectedRoute.value.unicode)
  ) {
    uiMsg.warning('当前航线正在编辑，请先保存或取消编辑')
    selectedRouteCode.value = selectedRoute.value.unicode
    return
  }

  const route = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(key),
  )

  if (!route) {
    uiMsg.error('未找到航线')
    return
  }

  selectAndShowRoute(route, {
    flyTo: true,
    refreshWeather: true,
  })
}

function selectRouteById(routeId: string | number) {
  if (!ensureRouteActionIdle()) {
    return false
  }

  if (!isRouteVisible(routeId)) {
    console.warn('[selectRouteById] 航线已隐藏:', routeId)
    return false
  }

  const route = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(routeId),
  )

  if (!route) {
    console.warn('[selectRouteById] 未找到航线:', routeId)
    return false
  }

  selectAndShowRoute(route, {
    flyTo: true,
    refreshWeather: true,
  })

  return true
}

function handleRouteCreatedAndSelect(event: Event) {
  const customEvent = event as CustomEvent<{
    routeId: string | number
  }>

  const routeId = customEvent.detail?.routeId

  if (routeId == null) {
    return
  }

  selectRouteById(routeId)
}

function startEditSelectedRoute() {
  if (!selectedRoute.value?.unicode) {
    uiMsg.warning('请先选择一条航线')
    return
  }
  if (selectedRoute.value.isVisible === false) {
    uiMsg.warning('请先显示该航线')
    return
  }
  //询问routeStore 能否进入编辑状态
  if (!routeStore.startEditing()) {
    uiMsg.warning(
      routeStore.routeActionMode === 'losPointPicking'
        ? '请先完成或取消地图选点'
        : '请先结束当前航线绘制或编辑操作',
    )
    return
  }
  routeManage.addAirLine(selectedRoute.value)

  const ok = routeManage.startEditRoute?.(selectedRoute.value.unicode)

  if (!ok) {
    uiMsg.warning('进入编辑模式失败')
    routeStore.endRouteAction()
    return
  }

  isRouteEditing.value = true
  routeDirty.value = false //刚进入编辑模式，目前航线还没修改过
  uiMsg.info('已进入航线编辑模式')
}

async function saveRouteEdit(): Promise<boolean> {
  if (!selectedRoute.value?.unicode || !selectedRoute.value.points?.length) {
    uiMsg.warning('请先选择一条有效的航线')
    return false
  }

  if (
    selectedRoute.value.points.length <
    getMinimumRoutePointCount(selectedRoute.value)
  ) {
    uiMsg.warning(getRoutePointCountWarning(selectedRoute.value))
    return false
  }

  try {
    normalizeRouteForBiz(selectedRoute.value)

    routeStore.addRoute(selectedRoute.value)

    updateMapRoute({
      rebuildVertex: false,
    })

    routeManage.saveEditRoute?.(selectedRoute.value.unicode)

    isRouteEditing.value = false
    routeDirty.value = false
    routeStore.endRouteAction()

    refreshSelectedRouteView({
      refreshWeather: false,
      forceRefreshPtList: false,
    })

    await nextTick()

    flyToRoute(selectedRoute.value, 1.5)

    uiMsg.success('保存编辑成功')

    return true
  } catch (error) {
    console.error('[saveRouteEdit] 保存编辑失败：', error)
    uiMsg.error('保存编辑失败')

    return false
  }
}

function cancelRouteEdit() {
  if (!selectedRoute.value?.unicode) {
    uiMsg.warning('请先选择一条航线')
    return
  }

  const ok = routeManage.cancelEditRoute?.(selectedRoute.value.unicode)

  if (!ok) {
    uiMsg.warning('取消编辑失败')
    return
  }

  const route = routeStore.flyRoute.find(
    (element) =>
      String(element.unicode) === String(selectedRoute.value.unicode),
  )

  if (route) {
    selectedRoute.value = route
  }

  isRouteEditing.value = false
  routeDirty.value = false
  routeStore.endRouteAction()

  refreshSelectedRouteView({
    refreshWeather: false,
    forceRefreshPtList: true,
  })

  flyToRoute(selectedRoute.value, 1.5)
  uiMsg.info('已取消编辑')
  return true
}

/**
 * 保存航点编辑。
 */
function savePt() {
  saveRouteEdit()
}

/**
 * 右侧输入框修改经纬度/高度后，同步地图。
 */
function onRoutePointInputChanged() {
  if (!selectedRoute.value?.unicode) return

  routeDirty.value = true

  updateMapRoute({
    rebuildVertex: false,
  })

  scheduleProfileRefresh()
}

/**
 * 航线名称、类型等属性变化。
 */
function onRouteMetaChanged() {
  if (!selectedRoute.value?.unicode) return

  routeDirty.value = true
  updateMapRoute({
    rebuildVertex: false,
  })
}

function toNumber(value: any, defaultValue = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : defaultValue
}

function createPointBetween(ptA: any, ptB: any) {
  const newPt = newAirlinePt()

  newPt.lon = Number(((toNumber(ptA.lon) + toNumber(ptB.lon)) / 2).toFixed(6))

  newPt.lat = Number(((toNumber(ptA.lat) + toNumber(ptB.lat)) / 2).toFixed(6))

  newPt.alt = Number(((toNumber(ptA.alt) + toNumber(ptB.alt)) / 2).toFixed(2))

  newPt.speed = ptA.speed ?? ptB.speed ?? 0
  newPt.ch1 = 0
  newPt.ch2 = 3

  return newPt
}

/**
 * 沿着 base -> 远离 other 的方向延长一小段。
 * 用于非闭合航线首点前插、末点后插。
 */
function createPointByExtension(basePt: any, otherPt: any, factor = 0.25) {
  const newPt = newAirlinePt()

  const baseLon = toNumber(basePt.lon)
  const baseLat = toNumber(basePt.lat)
  const baseAlt = toNumber(basePt.alt)

  const otherLon = toNumber(otherPt.lon)
  const otherLat = toNumber(otherPt.lat)
  const otherAlt = toNumber(otherPt.alt)

  newPt.lon = Number((baseLon + (baseLon - otherLon) * factor).toFixed(6))
  newPt.lat = Number((baseLat + (baseLat - otherLat) * factor).toFixed(6))
  newPt.alt = Number((baseAlt + (baseAlt - otherAlt) * factor).toFixed(2))

  newPt.speed = basePt.speed ?? 0
  newPt.ch1 = 0
  newPt.ch2 = 3

  return newPt
}

/**
 * 在指定航点前生成新航点。
 */
function createPointBefore(index: number) {
  const route = selectedRoute.value
  const points = route.points

  if (!points || points.length < 2) return undefined

  const current = points[index]
  if (!current) return undefined

  // 闭合航线：第一个点前面，就是最后点和第一个点之间
  if (route.isClose) {
    const prevIndex = index === 0 ? points.length - 1 : index - 1
    const prev = points[prevIndex]

    return createPointBetween(prev, current)
  }

  // 非闭合航线：第一个点前面，沿第一个点远离第二个点方向延长
  if (index === 0) {
    const next = points[1]
    return createPointByExtension(current, next)
  }

  // 普通情况：插入前一个点和当前点的中点
  const prev = points[index - 1]
  return createPointBetween(prev, current)
}

/**
 * 在指定航点后生成新航点。
 */
function createPointAfter(index: number) {
  const route = selectedRoute.value
  const points = route.points

  if (!points || points.length < 2) return undefined

  const current = points[index]
  if (!current) return undefined

  // 闭合航线：最后点后面，就是最后点和第一个点之间
  if (route.isClose) {
    const nextIndex = index === points.length - 1 ? 0 : index + 1
    const next = points[nextIndex]

    return createPointBetween(current, next)
  }

  // 非闭合航线：最后点后面，沿最后一段方向向外延长
  if (index === points.length - 1) {
    const prev = points[index - 1]
    return createPointByExtension(current, prev)
  }

  // 普通情况：插入当前点和后一个点的中点
  const next = points[index + 1]
  return createPointBetween(current, next)
}
/**
 * 航点下拉操作。
 */
function handlePtSelect(key: any, index: number) {
  if (isRouteDrawing()) {
    uiMsg.warning('请先结束绘制')
    return
  }

  if (!selectedRoute.value?.points) return

  if (key === 'deletePt') {
    if (
      selectedRoute.value.points.length <=
      getMinimumRoutePointCount(selectedRoute.value)
    ) {
      uiMsg.warning(getRoutePointCountWarning(selectedRoute.value))
      return
    }

    selectedRoute.value.points.splice(index, 1)
  }

  if (key === 'insertBefore') {
    const newPt = createPointBefore(index)

    if (!newPt) {
      uiMsg.warning('插入航点失败')
      return
    }

    selectedRoute.value.points.splice(index, 0, newPt)
  }

  if (key === 'insertAfter') {
    const newPt = createPointAfter(index)

    if (!newPt) {
      uiMsg.warning('插入航点失败')
      return
    }

    selectedRoute.value.points.splice(index + 1, 0, newPt)
  }

  normalizeRouteForBiz(selectedRoute.value)
  routeDirty.value = true

  updateMapRoute({
    rebuildVertex: true,
  })

  refreshSelectedRouteView({
    refreshWeather: true,
    forceRefreshPtList: true,
  })
}

function prevPtWeather() {
  if (!selectedRoute.value?.points?.length) return

  routePtNumber.value -= 1

  const entity = window.viewer.entities.getById(
    selectedRoute.value.unicode + '-航点' + routePtNumber.value.toString(),
  )

  if (entity) {
    window.viewer.flyTo(entity, {
      duration: 1,
    })
  }

  refreshWeatherOfCurrentPoint()
}

function nextPtWeather() {
  if (!selectedRoute.value?.points?.length) return

  routePtNumber.value += 1

  const entity = window.viewer.entities.getById(
    selectedRoute.value.unicode + '-航点' + routePtNumber.value.toString(),
  )

  if (entity) {
    window.viewer.flyTo(entity, {
      duration: 1,
    })
  }

  refreshWeatherOfCurrentPoint()
}

function queryWeather(lon: number, lat: number, level?: number) {
  let response: Promise<any>

  if (level == null || level === -1) {
    response = query_surface_forecast(lon, lat)
  } else {
    response = query_upper_forecast(lon, lat, level)
  }

  response
    .then((res) => {
      if (!res.data.success) {
        notify('error', '气象信息查询失败', res.data.message)
        return
      }

      const weatherData = res.data.data

      const timeArr = weatherData.time.map((item) => {
        const i = item.indexOf('T')
        return item.slice(i + 1, i + 3) + '时'
      })

      if (!Reflect.has(weatherData, 'precip')) {
        weatherData.precip = Array.from({ length: timeArr.length }, () => 0)
      }

      setChartOptions(
        weatherChart,
        timeArr.slice(0, 8),
        weatherData.temp.slice(0, 8),
        weatherData.windSpeed.slice(0, 8),
        weatherData.wind360.slice(0, 8),
        weatherData.precip.slice(0, 8),
        weatherData.humidity.slice(0, 8),
      )
    })
    .catch((e) => {
      uiMsg.error('气象信息查询失败：' + e.message, {
        duration: 3000,
        keepAliveOnHover: true,
      })
    })
}

function levelChanged(key: string | number) {
  selectedLevel.value = Number(key)
  refreshWeatherOfCurrentPoint()
}

function handleRouteCloseChanged(value: boolean) {
  if (!selectedRoute.value?.unicode) return

  if (value && selectedRoute.value.points.length < 3) {
    selectedRoute.value.isClose = false
    uiMsg.warning('闭合航线至少需要 3 个航点')
    return
  }

  selectedRoute.value.isClose = value
  normalizeRouteForBiz(selectedRoute.value)

  routeDirty.value = true

  updateMapRoute({
    rebuildVertex: true,
  })

  refreshSelectedRouteView({
    refreshWeather: false,
    forceRefreshPtList: true,
  })
}

async function sendRouteToQT(routeUnicode: string | number) {
  const selectedRouteToUpload = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(routeUnicode),
  )

  if (!selectedRouteToUpload) {
    uiMsg.warning('未找到相应的航线')
    return
  }

  try {
    normalizeRouteForBiz(selectedRouteToUpload)

    const res = await invoke<string>('upload_route', {
      linkName: uavStore.udpName,
      route: selectedRouteToUpload,
    })

    uiMsg.info('航线' + selectedRouteToUpload.name + '已下发: ' + res)
  } catch (err: any) {
    uiMsg.error('航线发送失败：' + err)
    console.error(err)
  }
}

function delRoute(routeUnicode: string | number) {
  const selectedRouteToDelete = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(routeUnicode),
  )

  if (!selectedRouteToDelete) {
    uiMsg.warning('未找到相应的航线')
    return
  }

  if (routeManage) {
    routeManage.removeRoute(selectedRouteToDelete)
  }

  routeStore.removeRoute(String(routeUnicode))
  clearRouteProfileCache(routeUnicode)

  if (String(selectedRouteCode.value) === String(routeUnicode)) {
    clearSelectedRouteState()
  }

  uiMsg.success('航线 ' + selectedRouteToDelete.name + ' 已删除')
}

function isRouteVisible(routeUnicode: string | number) {
  const route = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(routeUnicode),
  )

  return Boolean(route && route.isVisible !== false)
}

function clearSelectedRouteState() {
  selectedRouteCode.value = null
  selectedRoute.value = newAirline()
  routePtNumber.value = 1
  isRouteEditing.value = false
  routeDirty.value = false

  cancelPendingProfileSampling()
  myChart?.clear()
  weatherChart?.clear()
}

function warnRouteVisibilityBusy() {
  if (isRouteDrawing()) {
    uiMsg.warning('请先完成航线绘制，再切换显示状态')
    return
  }

  if (isRouteEditing.value || routeManage?.mode === 'editing') {
    uiMsg.warning('请先保存或取消当前编辑，再切换显示状态')
    return
  }

  uiMsg.warning('请先结束当前航线操作')
}

function toggleRouteVisibility(routeUnicode: string | number) {
  if (!isRouteActionIdle()) {
    warnRouteVisibilityBusy()
    return
  }

  const route = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(routeUnicode),
  )

  if (!route) {
    uiMsg.warning('未找到相应的航线')
    return
  }

  const nextVisible = route.isVisible === false
  const routeItem = routeManage?.routesMap?.get?.(String(routeUnicode))

  if (
    routeItem &&
    !routeManage.setRouteVisibility?.(routeUnicode, nextVisible)
  ) {
    uiMsg.warning('航线显示状态切换失败')
    return
  }

  if (!routeStore.setRouteVisibility(routeUnicode, nextVisible)) {
    uiMsg.warning('航线显示状态切换失败')
    return
  }

  if (!routeItem) {
    const entity = getRouteEntity(route)
    if (entity) entity.show = nextVisible
    window.viewer.scene.requestRender()
  }

  if (
    !nextVisible &&
    String(selectedRouteCode.value) === String(routeUnicode)
  ) {
    clearSelectedRouteState()
  }
}

function importRoute() {
  if (!ensureRouteActionIdle()) {
    return
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.route'

  input.onchange = (e: any) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()

    reader.onload = (ev) => {
      if (!ensureRouteActionIdle()) {
        return
      }

      const text = ev.target?.result as string
      parseRouteFile(file.name, text)
    }

    reader.readAsText(file)
  }

  input.click()
}

function parseRouteFile(fileName: string, content: string) {
  if (!ensureRouteActionIdle()) {
    return
  }

  const lines = content.split('\n').filter((l) => l.trim().length > 0)

  if (lines.length === 0) {
    uiMsg.error('航线文件为空')
    return
  }

  const newRoute = newAirline()

  newRoute.name = fileName.replace(/\.route$/i, '')
  newRoute.unicode =
    Date.now().toString() + Math.floor(Math.random() * 1000).toString()

  let code = 1

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim())

    if (parts.length < 8) continue

    const nPt = parseInt(parts[1])

    if (nPt === 0) continue

    code = parseInt(parts[0])

    const pt = newAirlinePt()

    pt.nPt = nPt
    pt.lon = parseFloat(parts[2])
    pt.lat = parseFloat(parts[3])
    pt.alt = parseFloat(parts[4])
    pt.speed = parseFloat(parts[5])
    pt.ch1 = parseInt(parts[6])
    pt.ch2 = parseInt(parts[7])

    newRoute.points.push(pt)
  }

  if (newRoute.points.length <= 0) {
    uiMsg.error('航线文件解析失败，无有效航点')
    return
  }

  newRoute.code = code
  newRoute.PtNum = newRoute.points.length

  const lastPt = newRoute.points[newRoute.points.length - 1]
  newRoute.isClose = lastPt.ch1 === 0

  removeDuplicatedClosingPoint(newRoute)
  normalizeRouteForBiz(newRoute)

  if (newRoute.points.length < getMinimumRoutePointCount(newRoute)) {
    uiMsg.error(getRoutePointCountWarning(newRoute))
    return
  }

  routeStore.addRoute(newRoute)

  selectAndShowRoute(newRoute, {
    flyTo: true,
    refreshWeather: true,
  })

  uiMsg.success(`成功导入航线: ${newRoute.name}`)
}

function exportRoute() {
  if (
    !selectedRouteCode.value ||
    !selectedRoute.value ||
    selectedRoute.value.points.length === 0
  ) {
    uiMsg.warning('请先选择一条有效的航线')
    return
  }

  normalizeRouteForBiz(selectedRoute.value)

  const currentRoute = selectedRoute.value
  const code = currentRoute.code || 1

  let content = `${code}, 0, 0.000000, 0.000000, 0.00, 0.0, 00, 03\n`

  currentRoute.points.forEach((pt, index) => {
    const nPt = pt.nPt || index + 1
    const lon = Number(pt.lon ?? 0).toFixed(6)
    const lat = Number(pt.lat ?? 0).toFixed(6)
    const alt = Number(pt.alt ?? 0).toFixed(2)
    const speed = Number(pt.speed ?? 0).toFixed(1)

    let ch1Val = pt.ch1 ?? 0

    if (index === currentRoute.points.length - 1) {
      ch1Val = currentRoute.isClose ? 0 : 2
    }

    const ch1 = ch1Val.toString().padStart(2, '0')
    const ch2 = (pt.ch2 ?? 0).toString().padStart(2, '0')

    content += `${code}, ${nPt}, ${lon}, ${lat}, ${alt}, ${speed}, ${ch1}, ${ch2}\n`
  })

  const blob = new Blob([content], {
    type: 'text/plain;charset=utf-8',
  })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = `${currentRoute.name || '导出航线'}.route`
  a.click()

  URL.revokeObjectURL(url)

  uiMsg.success('航线文件已导出')
}

function backToHomePage() {
  /**
   * 非编辑状态：
   * 直接关闭航线管理页面。
   */
  if (!isRouteEditing.value) {
    sStore.showRouteManage = false
    return
  }

  /**
   * 编辑状态：
   * 询问用户是否保存。
   */
  dialog.warning({
    title: '退出航线编辑',
    content: '当前航线正在编辑，是否保存本次修改？',

    positiveText: '保存',
    negativeText: '不保存',

    closable: true,
    maskClosable: false,

    /**
     * 保存编辑
     */
    onPositiveClick: async () => {
      const success = await saveRouteEdit()

      /**
       * 保存失败时不关闭航线管理页面。
       */
      if (!success) {
        return false
      }

      sStore.showRouteManage = false

      return true
    },

    /**
     * 放弃编辑
     */
    onNegativeClick: () => {
      const success = cancelRouteEdit()

      /**
       * 取消编辑失败时不关闭页面。
       */
      if (!success) {
        return false
      }

      sStore.showRouteManage = false

      return true
    },
  })
}

//点击航线缩放到航线
function handlePtClick(RouteUnicode?: string | number) {
  if (!ensureRouteActionIdle()) {
    return
  }

  if (RouteUnicode == null || !isRouteVisible(RouteUnicode)) {
    uiMsg.warning('请先显示该航线')
    return
  }

  const route = routeStore.flyRoute.find(
    (element) => String(element.unicode) === String(RouteUnicode),
  )

  if (!route || !routeManage) return

  flyToRoute(route, 2)
}
</script>

<template>
  <n-config-provider :theme="darkTheme">
    <div class="route-manage-overlay">
      <div
        id="right"
        @pointerdown.capture="blockRouteManageWhenDrawing"
        @click.capture="blockRouteManageWhenDrawing"
        @keydown.capture="blockRouteManageWhenDrawing"
        @change.capture="blockRouteManageWhenDrawing"
        @wheel.capture="blockRouteManageWhenDrawing"
      >
        <n-layout class="route-manage-layout">
          <n-layout-header :bordered="true">
            <n-space justify="space-between" align="center">
              <n-space>
                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      quaternary
                      type="success"
                      size="large"
                      @click="importRoute"
                    >
                      <template #icon>
                        <n-icon><FolderOpenOutline /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  导入航线
                </n-popover>

                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      data-route-manage-close="true"
                      quaternary
                      type="success"
                      size="large"
                      @click="exportRoute"
                    >
                      <template #icon>
                        <n-icon><DownloadOutline /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  导出航线
                </n-popover>
              </n-space>

              <n-space>
                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      quaternary
                      type="success"
                      size="large"
                      @click="backToHomePage"
                    >
                      <template #icon>
                        <n-icon><ArrowRight /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  返回
                </n-popover>
              </n-space>
            </n-space>
          </n-layout-header>

          <n-layout-content
            class="route-manage-content"
            content-style="height: 100%; padding: 0; display: flex; flex-direction: column; overflow: hidden;"
          >
            <n-flex vertical class="route-overview">
              <n-ellipsis><h3>航线列表</h3></n-ellipsis>

              <n-radio-group
                class="route-list-group"
                v-model:value="selectedRouteCode"
                name="radiogroup"
                @update:value="checkRoute"
              >
                <n-scrollbar class="route-list-scrollbar">
                  <n-space vertical>
                    <n-space
                      v-for="r in routesListRef"
                      :key="r.value"
                      justify="space-between"
                      style="
                        margin-right: 1rem;
                        border-bottom: #383737 1px solid;
                      "
                      @click="handlePtClick(r.value)"
                    >
                      <n-space align="center" :wrap="false" :size="4">
                        <!-- <n-popover trigger="hover">
                          <template #trigger> -->
                        <n-button
                          data-route-visibility-toggle="true"
                          quaternary
                          circle
                          size="tiny"
                          :type="r.visible ? 'success' : 'default'"
                          :aria-label="r.visible ? '隐藏航线' : '显示航线'"
                          style="width: 1.5rem; height: 1.5rem"
                          @click.stop="toggleRouteVisibility(r.value)"
                        >
                          <template #icon>
                            <n-icon>
                              <EyeOutline v-if="r.visible" />
                              <EyeOffOutline v-else />
                            </n-icon>
                          </template>
                        </n-button>
                        <!-- </template>
                          {{ r.visible ? '隐藏航线' : '显示航线' }}
                        </n-popover> -->

                        <n-radio
                          :key="r.value"
                          :value="r.value"
                          :disabled="!r.visible"
                        >
                          {{ r.label }}
                        </n-radio>
                      </n-space>

                      <n-button-group>
                        <n-button
                          secondary
                          size="small"
                          type="info"
                          style="height: 1.3rem"
                          @click.stop="sendRouteToQT(r.value)"
                        >
                          下发
                        </n-button>

                        <n-button
                          secondary
                          size="small"
                          type="error"
                          style="height: 1.3rem; margin-bottom: 4px"
                          @click.stop="delRoute(r.value)"
                        >
                          删除
                        </n-button>
                      </n-button-group>
                    </n-space>
                  </n-space>
                </n-scrollbar>
              </n-radio-group>

              <n-divider style="margin: 0.2rem -0.5rem"></n-divider>

              <n-space vertical style="margin: 0.2rem 0.5rem">
                <n-space>
                  <n-ellipsis style="width: 4rem">航线名称</n-ellipsis>
                  <n-input
                    size="small"
                    style="width: 10rem"
                    v-model:value="selectedRoute.name"
                    :disabled="!hasSelectedRoute"
                    @update:value="onRouteMetaChanged"
                  ></n-input>
                </n-space>

                <n-space>
                  <n-space>
                    <n-ellipsis>开闭</n-ellipsis>
                    <n-switch
                      v-model:value="selectedRoute.isClose"
                      size="small"
                      :disabled="!hasSelectedRoute"
                      @update:value="handleRouteCloseChanged"
                    >
                      <template #checked>闭</template>
                      <template #unchecked>开</template>
                    </n-switch>
                  </n-space>

                  <n-space style="margin-left: 0.5rem">
                    <n-ellipsis>航点数</n-ellipsis>
                    <n-input-number
                      :show-button="false"
                      disabled
                      size="small"
                      style="width: 5rem"
                      v-model:value="selectedRoute.PtNum"
                    ></n-input-number>
                  </n-space>
                </n-space>

                <n-space>
                  <n-ellipsis style="width: 4rem">航线类型</n-ellipsis>
                  <n-select
                    style="width: 10rem"
                    size="small"
                    v-model:value="selectedRoute.code"
                    :options="routeCode"
                    :disabled="!hasSelectedRoute"
                    @update:value="onRouteMetaChanged"
                  />
                </n-space>
              </n-space>
            </n-flex>

            <n-divider class="section-divider"></n-divider>

            <n-space justify="center" class="route-tabs">
              <n-button-group>
                <n-button
                  size="small"
                  :type="activeTab === 'detail' ? 'primary' : 'default'"
                  @click="switchTab('detail')"
                >
                  航线详情
                </n-button>

                <n-button
                  size="small"
                  :type="activeTab === 'profile' ? 'primary' : 'default'"
                  @click="switchTab('profile')"
                >
                  地形剖面
                </n-button>

                <n-button
                  size="small"
                  :type="activeTab === 'weather' ? 'primary' : 'default'"
                  @click="switchTab('weather')"
                >
                  气象信息
                </n-button>
              </n-button-group>
            </n-space>

            <n-divider class="section-divider"></n-divider>

            <div v-show="activeTab === 'detail'" class="route-tab-panel">
              <n-flex vertical class="route-detail-panel">
                <n-space justify="space-around" style="margin-top: 0.5rem">
                  <n-ellipsis style="width: 2rem; margin-left: 0.2rem">
                    序号
                  </n-ellipsis>
                  <n-ellipsis style="width: 5.5rem">经度</n-ellipsis>
                  <n-ellipsis style="width: 5.5rem">纬度</n-ellipsis>
                  <n-ellipsis style="width: 3rem">高度</n-ellipsis>
                </n-space>

                <n-scrollbar class="route-tab-scrollbar">
                  <div v-if="selectedRoute.points.length > 0 && showPtList">
                    <n-space
                      v-for="(pt, index) in selectedRoute.points"
                      :key="`${selectedRoute.unicode}-${index}`"
                      justify="space-around"
                      style="margin: 0.2rem 0"
                    >
                      <n-dropdown
                        trigger="hover"
                        size="small"
                        placement="top-start"
                        :show-arrow="true"
                        :disabled="isRouteDrawing()"
                        :options="PtOptions"
                        @select="handlePtSelect($event, index)"
                      >
                        <n-button
                          secondary
                          type="info"
                          size="small"
                          style="width: 1.7rem; margin-left: 0.2rem"
                        >
                          {{ pt.nPt }}
                        </n-button>
                      </n-dropdown>

                      <n-input-number
                        size="small"
                        v-model:value="pt.lon"
                        :show-button="false"
                        style="width: 6rem"
                        placeholder="经度"
                        :max="180"
                        :min="-180"
                        @update:value="onRoutePointInputChanged"
                      ></n-input-number>

                      <n-input-number
                        size="small"
                        v-model:value="pt.lat"
                        :show-button="false"
                        style="width: 6rem"
                        placeholder="纬度"
                        :max="90"
                        :min="-90"
                        @update:value="onRoutePointInputChanged"
                      ></n-input-number>

                      <n-input-number
                        size="small"
                        v-model:value="pt.alt"
                        :show-button="false"
                        style="width: 6rem"
                        placeholder="高度"
                        :max="12000"
                        :min="-500"
                        @update:value="onRoutePointInputChanged"
                      ></n-input-number>
                    </n-space>
                  </div>

                  <n-space v-else justify="space-around">
                    <n-empty
                      style="margin-top: 3rem"
                      description="无内容"
                    ></n-empty>
                  </n-space>
                </n-scrollbar>

                <n-space justify="center" style="margin: 0.5rem 0">
                  <n-button
                    type="warning"
                    size="small"
                    :disabled="!canEditSelectedRoute"
                    @click="startEditSelectedRoute"
                  >
                    开始编辑
                  </n-button>

                  <n-button
                    type="info"
                    size="small"
                    :disabled="!hasSelectedRoute"
                    @click="savePt"
                  >
                    <template #icon>
                      <SaveOutline />
                    </template>
                    保存编辑
                  </n-button>

                  <n-button
                    size="small"
                    :disabled="!isRouteEditing"
                    @click="cancelRouteEdit"
                  >
                    取消编辑
                  </n-button>
                </n-space>
              </n-flex>
            </div>

            <div v-show="activeTab === 'profile'" class="route-tab-panel">
              <n-flex vertical class="route-profile-panel">
                <n-space justify="space-evenly" style="padding: 0 0.5rem">
                  <n-ellipsis>采样间隔</n-ellipsis>

                  <n-input-number
                    v-model:value="profileInterval"
                    size="small"
                    placeholder="默认1000米"
                    style="width: 8rem"
                    :min="100"
                    :step="100"
                    @update:value="handleProfileIntervalChanged"
                  ></n-input-number>

                  <n-button
                    type="success"
                    size="small"
                    :disabled="!hasSelectedRoute"
                    @click="redrawRouteProfile"
                  >
                    重新绘图
                  </n-button>
                </n-space>

                <div v-show="hasSelectedRoute" id="echarts-profile"></div>
              </n-flex>
            </div>

            <div
              v-show="activeTab === 'weather' && hasSelectedRoute"
              class="route-tab-panel"
            >
              <n-flex vertical class="route-weather-panel">
                <n-space justify="space-around" class="routePtSelector">
                  <n-button
                    size="small"
                    @click="prevPtWeather"
                    :disabled="routePtNumber <= 1 || !hasSelectedRoute"
                  >
                    <template #icon><ArrowBackOutline /></template>
                  </n-button>

                  <n-ellipsis>航点 {{ routePtNumber }}</n-ellipsis>

                  <n-button
                    size="small"
                    @click="nextPtWeather"
                    :disabled="
                      !hasSelectedRoute ||
                      selectedRoute.points.length <= routePtNumber
                    "
                  >
                    <template #icon><ArrowForwardOutline /></template>
                  </n-button>
                </n-space>

                <n-space justify="center">
                  <n-ellipsis>{{ nowTime }}</n-ellipsis>

                  <n-select
                    style="width: 10rem"
                    size="small"
                    :options="levelOptions"
                    v-model:value="selectedLevel"
                    @update:value="levelChanged"
                    placeholder="选择高度层"
                    :disabled="!hasSelectedRoute"
                  ></n-select>
                </n-space>

                <n-scrollbar
                  x-scrollable
                  id="weatherChart"
                  class="route-weather-chart"
                ></n-scrollbar>
              </n-flex>
            </div>
          </n-layout-content>
        </n-layout>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.route-manage-overlay {
  display: flex;
  justify-content: flex-end;
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 10;
}

#right {
  width: clamp(360px, 26vw, 480px);
  max-width: 100vw;
  height: 100vh;
  pointer-events: auto;
  background: rgba(16, 16, 20, 0.75);
  backdrop-filter: blur(6px);
}

#right :deep(.n-layout),
#right :deep(.n-layout-scroll-container),
#right :deep(.n-layout-content),
#right :deep(.n-layout-header) {
  background: transparent !important;
}

.route-manage-layout {
  height: 100%;
}

.route-manage-content {
  height: calc(100% - 61px);
}

#right :deep(.route-manage-content > .n-layout-scroll-container) {
  overflow: hidden;
}

.route-overview {
  flex: 0 1 42%;
  min-height: 0;
  margin: 0.5rem 1rem 0;
  overflow: hidden;
}

.route-overview h3 {
  margin: 0.5rem 0;
}

.route-list-group {
  display: block;
  flex: 1;
  min-height: 0;
}

.route-list-scrollbar,
.route-tab-scrollbar {
  height: 100%;
}

.section-divider {
  flex: none;
  margin: 0.2rem -0.5rem;
}

.route-tabs {
  flex: none;
  margin: 0.3rem 0;
}

.route-tab-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.route-detail-panel,
.route-profile-panel,
.route-weather-panel {
  height: 100%;
  min-height: 0;
}

.route-profile-panel {
  margin: 0.5rem 0;
}

#echarts-profile {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.routePtSelector {
  width: 100%;
  font-weight: bold;
  color: #63e2b7;
}

.route-weather-chart {
  flex: 1;
  min-height: 0;
  width: 100%;
}

@media (max-width: 600px) {
  #right {
    width: 100vw;
  }
}

.routePtSelector:hover {
  background: rgb(24 24 28);
}
</style>
