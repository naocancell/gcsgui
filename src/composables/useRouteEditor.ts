/**
 * 文件描述：航线交互式编辑与航点管理 Composable
 */
import { ref, computed, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import { useRouteStore } from '@/store/RouteStore'
import { useUavStore } from '@/store/uavStore'
import type { Airline } from '@/types/entityoptions'
import { newAirline } from '@/core/gis/types'
import {
  normalizeRouteForBiz,
  getMinimumRoutePointCount,
  getRoutePointCountWarning,
} from '@/composables/useRouteFileIO'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/utils/logger'
import {
  PtOptions,
  routeCode,
  cloneRoutePoints,
  createRouteSnapshot,
  findRouteByUnicode,
  validateRouteNoFlyZone,
  getRouteEntity,
  flyToRouteEntity,
  syncRouteEntityToViewer,
  applyPointOperation,
  blockDrawingEvent,
} from '@/composables/routeGeometryUtils'

export * from '@/composables/routeGeometryUtils'

export function useRouteEditor(callbacks?: {
  onRouteChanged?: () => void
  onRouteSelected?: (route: Airline) => void
  onClearCache?: (routeCode: string | number) => void
}) {
  const uiMsg = useMessage()
  const routeStore = useRouteStore()
  const uavStore = useUavStore()

  const isRouteEditing = ref(false)
  const routeDirty = ref(false)
  const selectedRouteCode = ref<string | number | null>(null)
  const selectedRoute = ref<Airline>(newAirline())
  const showPtList = ref(true)

  let lastValidRouteSnapshot: { points: any[]; isClose: boolean } | null = null
  const lastBlockTipAt = { value: 0 }

  const routesListRef = computed(() =>
    routeStore.flyRoute.map((r) => ({
      value: r.unicode,
      label: r.name,
      visible: r.isVisible !== false,
    })),
  )

  const hasSelectedRoute = computed(
    () => !!selectedRoute.value?.unicode && selectedRoute.value.isVisible !== false && (selectedRoute.value.points?.length ?? 0) > 0,
  )

  const canEditSelectedRoute = computed(
    () => hasSelectedRoute.value && !isRouteEditing.value && routeStore.routeActionMode === 'idle',
  )

  function isRouteActionIdle(): boolean {
    const m = window.routeManageViewer?.mode
    return routeStore.routeActionMode === 'idle' && !isRouteEditing.value && m !== 'drawing' && m !== 'editing'
  }

  function isRouteDrawing(): boolean {
    return routeStore.routeActionMode === 'drawing' || window.routeManageViewer?.mode === 'drawing'
  }

  function ensureRouteActionIdle(): boolean {
    if (isRouteActionIdle()) return true
    if (routeStore.routeActionMode === 'losPointPicking') uiMsg.warning('请先完成或取消地图选点')
    else if (isRouteDrawing()) uiMsg.warning('请先结束绘制')
    else uiMsg.warning('请结束绘制或编辑')
    return false
  }

  function rememberValidRoute(route = selectedRoute.value) {
    lastValidRouteSnapshot = createRouteSnapshot(route)
  }

  function restoreLastValidRoute() {
    if (!lastValidRouteSnapshot || !selectedRoute.value) return
    selectedRoute.value.points = cloneRoutePoints(lastValidRouteSnapshot.points)
    selectedRoute.value.isClose = lastValidRouteSnapshot.isClose
    normalizeRouteForBiz(selectedRoute.value)
  }

  function checkNoFlyZone(route: Airline, action: string): boolean {
    return validateRouteNoFlyZone(route, action, (msg) => uiMsg.warning(msg))
  }

  function refreshPtList() {
    showPtList.value = false
    nextTick(() => { showPtList.value = true })
  }

  function flyToRoute(route: Airline, duration = 1.5) {
    nextTick(() => flyToRouteEntity(route, duration))
  }

  function updateMapRoute(options?: { rebuildVertex?: boolean; flyTo?: boolean; duration?: number }) {
    const rmv = window.routeManageViewer
    if (!rmv || !selectedRoute.value?.unicode) return undefined
    const entity = syncRouteEntityToViewer(rmv, selectedRoute.value, options?.rebuildVertex ?? true)
    const id = String(selectedRoute.value.unicode)
    if (!isRouteEditing.value && String(rmv.selectedRouteId ?? '') !== id) {
      rmv.selectRoute?.(selectedRoute.value.unicode)
    }
    if (options?.flyTo) flyToRoute(selectedRoute.value, options.duration ?? 1.5)
    return entity
  }

  function selectAndShowRoute(route: Airline, options?: { flyTo?: boolean; refreshWeather?: boolean }) {
    const rmv = window.routeManageViewer
    if (!rmv || !route || route.isVisible === false) return
    selectedRoute.value = route
    selectedRouteCode.value = route.unicode
    rememberValidRoute(route)
    rmv.routeParams.isClose = route.isClose
    const entity = syncRouteEntityToViewer(rmv, route, true)
    rmv.selectRoute?.(route.unicode)
    routeDirty.value = false
    refreshPtList()
    if (options?.flyTo) flyToRoute(route, 2)
    callbacks?.onRouteSelected?.(route)
    return entity
  }

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
    if (isRouteEditing.value && routeDirty.value && selectedRoute.value?.unicode && String(key) !== String(selectedRoute.value.unicode)) {
      uiMsg.warning('当前航线正在编辑，请先保存或取消编辑')
      selectedRouteCode.value = selectedRoute.value.unicode
      return
    }
    const route = findRouteByUnicode(routeStore.flyRoute, key)
    if (!route) return uiMsg.error('未找到航线')
    selectAndShowRoute(route, { flyTo: true, refreshWeather: true })
  }

  function selectRouteById(routeId: string | number) {
    if (!ensureRouteActionIdle() || !isRouteVisible(routeId)) return false
    const route = findRouteByUnicode(routeStore.flyRoute, routeId)
    if (!route) return false
    selectAndShowRoute(route, { flyTo: true, refreshWeather: true })
    return true
  }

  function handleRouteCreatedAndSelect(event: Event) {
    const routeId = (event as CustomEvent<{ routeId: string | number }>).detail?.routeId
    if (routeId != null) selectRouteById(routeId)
  }

  function startEditSelectedRoute() {
    if (!selectedRoute.value?.unicode) return uiMsg.warning('请先选择一条航线')
    if (selectedRoute.value.isVisible === false) return uiMsg.warning('请先显示该航线')
    if (!routeStore.startEditing()) {
      return uiMsg.warning(routeStore.routeActionMode === 'losPointPicking' ? '请先完成或取消地图选点' : '请先结束当前航线绘制或编辑操作')
    }
    const rmv = window.routeManageViewer
    rmv?.addAirLine(selectedRoute.value)
    if (!rmv?.startEditRoute?.(selectedRoute.value.unicode)) {
      uiMsg.warning('进入编辑模式失败')
      return routeStore.endRouteAction()
    }
    isRouteEditing.value = true
    routeDirty.value = false
    uiMsg.info('已进入航线编辑模式')
  }

  async function saveRouteEdit(): Promise<boolean> {
    if (!selectedRoute.value?.unicode || !selectedRoute.value.points?.length) {
      uiMsg.warning('请先选择一条有效的航线')
      return false
    }
    if (selectedRoute.value.points.length < getMinimumRoutePointCount(selectedRoute.value)) {
      uiMsg.warning(getRoutePointCountWarning(selectedRoute.value))
      return false
    }
    try {
      normalizeRouteForBiz(selectedRoute.value)
      if (!checkNoFlyZone(selectedRoute.value, '保存航线')) {
        restoreLastValidRoute()
        updateMapRoute({ rebuildVertex: true })
        return false
      }
      routeStore.addRoute(selectedRoute.value)
      updateMapRoute({ rebuildVertex: false })
      window.routeManageViewer?.saveEditRoute?.(selectedRoute.value.unicode)
      isRouteEditing.value = false
      routeDirty.value = false
      routeStore.endRouteAction()
      rememberValidRoute(selectedRoute.value)
      await nextTick()
      flyToRoute(selectedRoute.value, 1.5)
      uiMsg.success('保存编辑成功')
      callbacks?.onRouteChanged?.()
      return true
    } catch (err) {
      logger.error('[saveRouteEdit] 保存编辑失败：', err)
      uiMsg.error('保存编辑失败')
      return false
    }
  }

  function cancelRouteEdit() {
    if (!selectedRoute.value?.unicode) return uiMsg.warning('请先选择一条航线')
    if (!window.routeManageViewer?.cancelEditRoute?.(selectedRoute.value.unicode)) {
      uiMsg.warning('取消编辑失败')
      return false
    }
    const route = findRouteByUnicode(routeStore.flyRoute, selectedRoute.value.unicode)
    if (route) selectedRoute.value = route
    isRouteEditing.value = false
    routeDirty.value = false
    routeStore.endRouteAction()
    refreshPtList()
    flyToRoute(selectedRoute.value, 1.5)
    uiMsg.info('已取消编辑')
    callbacks?.onRouteChanged?.()
    return true
  }

  function handlePtSelect(key: any, index: number) {
    if (isRouteDrawing()) return uiMsg.warning('请先结束绘制')
    if (!selectedRoute.value?.points) return
    const opRes = applyPointOperation(selectedRoute.value, key, index)
    if (!opRes.success) return uiMsg.warning(opRes.error)
    const candidateRoute = { ...selectedRoute.value, points: opRes.points }
    normalizeRouteForBiz(candidateRoute)
    if (!checkNoFlyZone(candidateRoute, key === 'deletePt' ? '删除航点' : '添加航点')) return

    selectedRoute.value.points = candidateRoute.points
    normalizeRouteForBiz(selectedRoute.value)
    routeDirty.value = true
    updateMapRoute({ rebuildVertex: true })
    refreshPtList()
    rememberValidRoute(selectedRoute.value)
    callbacks?.onRouteChanged?.()
  }

  function onRoutePointInputChanged() {
    if (!selectedRoute.value?.unicode) return
    normalizeRouteForBiz(selectedRoute.value)
    if (!checkNoFlyZone(selectedRoute.value, '修改航线')) {
      restoreLastValidRoute()
      updateMapRoute({ rebuildVertex: true })
      refreshPtList()
      return
    }
    routeDirty.value = true
    updateMapRoute({ rebuildVertex: false })
    callbacks?.onRouteChanged?.()
  }

  function onRouteMetaChanged() {
    if (!selectedRoute.value?.unicode) return
    routeDirty.value = true
    updateMapRoute({ rebuildVertex: false })
  }

  function handleRouteCloseChanged(value: boolean) {
    if (!selectedRoute.value?.unicode) return
    if (value && selectedRoute.value.points.length < 3) {
      selectedRoute.value.isClose = false
      return uiMsg.warning('闭合航线至少需要 3 个航点')
    }
    const prevClose = Boolean(selectedRoute.value.isClose)
    selectedRoute.value.isClose = value
    normalizeRouteForBiz(selectedRoute.value)
    if (!checkNoFlyZone(selectedRoute.value, value ? '闭合航线' : '修改航线')) {
      selectedRoute.value.isClose = prevClose
      restoreLastValidRoute()
      updateMapRoute({ rebuildVertex: true })
      return
    }
    routeDirty.value = true
    updateMapRoute({ rebuildVertex: true })
    refreshPtList()
    rememberValidRoute(selectedRoute.value)
    callbacks?.onRouteChanged?.()
  }

  async function sendRouteToQT(routeUnicode: string | number) {
    const route = findRouteByUnicode(routeStore.flyRoute, routeUnicode)
    if (!route) return uiMsg.warning('未找到相应的航线')
    try {
      normalizeRouteForBiz(route)
      const res = await invoke<string>('upload_route', { linkName: uavStore.udpName, route })
      uiMsg.info('航线' + route.name + '已下发: ' + res)
    } catch (err: any) {
      uiMsg.error('航线发送失败：' + err)
    }
  }

  function isRouteVisible(routeUnicode: string | number): boolean {
    const route = findRouteByUnicode(routeStore.flyRoute, routeUnicode)
    return Boolean(route && route.isVisible !== false)
  }

  function clearSelectedRouteState() {
    selectedRouteCode.value = null
    selectedRoute.value = newAirline()
    isRouteEditing.value = false
    routeDirty.value = false
  }

  function delRoute(routeUnicode: string | number) {
    const route = findRouteByUnicode(routeStore.flyRoute, routeUnicode)
    if (!route) return uiMsg.warning('未找到相应的航线')
    window.routeManageViewer?.removeRoute(route)
    routeStore.removeRoute(String(routeUnicode))
    callbacks?.onClearCache?.(routeUnicode)
    if (String(selectedRouteCode.value) === String(routeUnicode)) clearSelectedRouteState()
    uiMsg.success('航线 ' + route.name + ' 已删除')
  }

  function toggleRouteVisibility(routeUnicode: string | number) {
    if (!isRouteActionIdle()) return uiMsg.warning('请先结束当前航线操作')
    const route = findRouteByUnicode(routeStore.flyRoute, routeUnicode)
    if (!route) return uiMsg.warning('未找到相应的航线')
    const nextVis = route.isVisible === false
    const item = window.routeManageViewer?.routesMap?.get?.(String(routeUnicode))
    if (item && !window.routeManageViewer.setRouteVisibility?.(routeUnicode, nextVis)) return uiMsg.warning('航线显示状态切换失败')
    if (!routeStore.setRouteVisibility(routeUnicode, nextVis)) return uiMsg.warning('航线显示状态切换失败')
    if (!item) {
      const entity = getRouteEntity(route)
      if (entity) entity.show = nextVis
      window.viewer?.scene?.requestRender()
    }
    if (!nextVis && String(selectedRouteCode.value) === String(routeUnicode)) clearSelectedRouteState()
  }

  function blockRouteManageWhenDrawing(event: Event) {
    blockDrawingEvent(event, isRouteDrawing(), lastBlockTipAt, () => uiMsg.warning('请先结束绘制'))
  }

  return {
    isRouteEditing, routeDirty, selectedRouteCode, selectedRoute, showPtList, routesListRef,
    hasSelectedRoute, canEditSelectedRoute, PtOptions, routeCode, isRouteActionIdle, isRouteDrawing,
    ensureRouteActionIdle, rememberValidRoute, restoreLastValidRoute, checkNoFlyZone, refreshPtList,
    flyToRoute, updateMapRoute, selectAndShowRoute, checkRoute, selectRouteById,
    handleRouteCreatedAndSelect, startEditSelectedRoute, saveRouteEdit, cancelRouteEdit, handlePtSelect,
    onRoutePointInputChanged, onRouteMetaChanged, handleRouteCloseChanged, sendRouteToQT, delRoute,
    isRouteVisible, toggleRouteVisibility, clearSelectedRouteState, blockRouteManageWhenDrawing,
  }
}
