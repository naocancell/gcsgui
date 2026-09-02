/**
 * 文件描述：航线几何计算与航点插值工具模块 (Route Geometry & Waypoint Utilities)
 */
import type { Airline } from '@/types/entityoptions'
import { newAirlinePt } from '@/core/gis/types'
import {
  formatNoFlyZoneConflictMessage,
  noFlyZoneService,
} from '@/utils/map/noFlyZoneService'
import {
  normalizeRouteForBiz,
  getMinimumRoutePointCount,
  getRoutePointCountWarning,
} from '@/composables/useRouteFileIO'

/**
 * 航点右键快捷操作选项
 */
export const PtOptions = [
  { label: '在前面插入', key: 'insertBefore' },
  { label: '在后面插入', key: 'insertAfter' },
  { label: '删除航点', key: 'deletePt' },
]

/**
 * 任务航线编号与名称选项
 */
export const routeCode = [
  { label: '任务航线1', value: 1 },
  { label: '任务航线2', value: 2 },
  { label: '任务航线3', value: 3 },
  { label: '任务航线4', value: 4 },
  { label: '任务航线5', value: 5 },
]

/**
 * 安全转换为有效数值
 */
export function toNumber(value: any, defaultValue = 0): number {
  if (value == null) return defaultValue
  const num = Number(value)
  return Number.isFinite(num) ? num : defaultValue
}

/**
 * 深度复制航点列表
 */
export function cloneRoutePoints(points?: any[]): any[] {
  if (!points || !Array.isArray(points)) return []
  return points.map((p) => ({ ...p }))
}

/**
 * 创建航线快照数据
 */
export function createRouteSnapshot(route?: Airline): { points: any[]; isClose: boolean } | null {
  if (!route?.points) return null
  return {
    points: cloneRoutePoints(route.points),
    isClose: Boolean(route.isClose),
  }
}

/**
 * 查找指定 unicode 的航线
 */
export function findRouteByUnicode(routes: Airline[], unicode: string | number): Airline | undefined {
  if (!routes || unicode == null) return undefined
  return routes.find((r) => String(r.unicode) === String(unicode))
}

/**
 * 校验航线禁飞区冲突
 */
export function validateRouteNoFlyZone(route: Airline, action: string, warningCallback?: (msg: string) => void): boolean {
  const conflict = noFlyZoneService.findRouteConflict(route.points || [], route.isClose)
  if (!conflict) return true
  const msg = formatNoFlyZoneConflictMessage(conflict, action)
  warningCallback?.(msg)
  return false
}

/**
 * 获取航线对应的地图 Entity
 */
export function getRouteEntity(route: Airline) {
  const rmv = window.routeManageViewer
  if (!rmv || !route?.unicode) return undefined
  const id = String(route.unicode)
  return rmv.routesMap?.get?.(id)?.entity || window.viewer?.entities?.getById('航线' + id)
}

/**
 * 飞向指定航线视角
 */
export function flyToRouteEntity(route: Airline, duration = 1.5) {
  const rmv = window.routeManageViewer
  if (!rmv || !route?.unicode || !window.viewer) return
  if (rmv.flyToRoute?.(route, duration)) return
  const entity = getRouteEntity(route)
  if (entity) {
    window.viewer.flyTo(entity, { duration })
    window.viewer.scene?.requestRender()
  }
}

/**
 * 同步航线实体至地图 Viewer
 */
export function syncRouteEntityToViewer(rmv: any, route: Airline, rebuildVertex = true): any {
  if (!rmv || !route?.unicode) return undefined
  normalizeRouteForBiz(route)
  let entity: any
  if (rmv.updateRouteEntity) {
    rmv.updateRouteEntity(route, { rebuildVertex, silent: true })
    entity = getRouteEntity(route)
  } else {
    rmv.removeRoute(route)
    entity = rmv.addAirLine(route)
  }
  const id = String(route.unicode)
  const item = rmv.routesMap?.get?.(id)
  if (item?.entity) {
    item.entity.name = route.name
    entity = item.entity
  }
  window.viewer?.scene?.requestRender()
  return entity
}

/**
 * 在两航点之间生成中点航点
 */
export function createPointBetween(ptA: any, ptB: any) {
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
 * 根据基准点和参考点延伸方向生成外插航点
 */
export function createPointByExtension(basePt: any, otherPt: any, factor = 0.25) {
  const newPt = newAirlinePt()
  const bLon = toNumber(basePt.lon), bLat = toNumber(basePt.lat), bAlt = toNumber(basePt.alt)
  const oLon = toNumber(otherPt.lon), oLat = toNumber(otherPt.lat), oAlt = toNumber(otherPt.alt)
  newPt.lon = Number((bLon + (bLon - oLon) * factor).toFixed(6))
  newPt.lat = Number((bLat + (bLat - oLat) * factor).toFixed(6))
  newPt.alt = Number((bAlt + (bAlt - oAlt) * factor).toFixed(2))
  newPt.speed = basePt.speed ?? 0
  newPt.ch1 = 0
  newPt.ch2 = 3
  return newPt
}

/**
 * 在指定索引前生成新航点
 */
export function createPointBefore(route: Airline, index: number) {
  const points = route.points
  if (!points || points.length < 2) return undefined
  const current = points[index]
  if (!current) return undefined
  if (route.isClose) {
    const prev = points[index === 0 ? points.length - 1 : index - 1]
    return createPointBetween(prev, current)
  }
  if (index === 0) return createPointByExtension(current, points[1])
  return createPointBetween(points[index - 1], current)
}

/**
 * 在指定索引后生成新航点
 */
export function createPointAfter(route: Airline, index: number) {
  const points = route.points
  if (!points || points.length < 2) return undefined
  const current = points[index]
  if (!current) return undefined
  if (route.isClose) {
    const next = points[index === points.length - 1 ? 0 : index + 1]
    return createPointBetween(current, next)
  }
  if (index === points.length - 1) return createPointByExtension(current, points[index - 1])
  return createPointBetween(current, points[index + 1])
}

/**
 * 执行航点增删操作
 */
export function applyPointOperation(
  route: Airline,
  key: string,
  index: number,
): { success: true; points: any[] } | { success: false; error: string } {
  if (!route.points) return { success: false, error: '航点列表为空' }
  const points = cloneRoutePoints(route.points)
  if (key === 'deletePt') {
    if (points.length <= getMinimumRoutePointCount(route)) {
      return { success: false, error: getRoutePointCountWarning(route) }
    }
    points.splice(index, 1)
    return { success: true, points }
  }
  if (key === 'insertBefore') {
    const pt = createPointBefore(route, index)
    if (!pt) return { success: false, error: '插入航点失败' }
    points.splice(index, 0, pt)
    return { success: true, points }
  }
  if (key === 'insertAfter') {
    const pt = createPointAfter(route, index)
    if (!pt) return { success: false, error: '插入航点失败' }
    points.splice(index + 1, 0, pt)
    return { success: true, points }
  }
  return { success: true, points }
}

/**
 * 计算两点间的大圆距离 (米)
 */
export function calculateSegmentDistance(
  p1: { lon: number; lat: number },
  p2: { lon: number; lat: number },
): number {
  const R = 6378137 // 地球平均半径 (米)
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180
  const lat1 = (p1.lat * Math.PI) / 180
  const lat2 = (p2.lat * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Number((R * c).toFixed(2))
}

/**
 * 计算两点间的中点坐标与真北航向角 (度)
 */
export function calculateMidpointAndHeading(
  p1: { lon: number; lat: number },
  p2: { lon: number; lat: number },
): { midLon: number; midLat: number; heading: number } {
  const midLon = Number(((toNumber(p1.lon) + toNumber(p2.lon)) / 2).toFixed(6))
  const midLat = Number(((toNumber(p1.lat) + toNumber(p2.lat)) / 2).toFixed(6))

  const dLon = ((toNumber(p2.lon) - toNumber(p1.lon)) * Math.PI) / 180
  const lat1 = (toNumber(p1.lat) * Math.PI) / 180
  const lat2 = (toNumber(p2.lat) * Math.PI) / 180

  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  let heading = (Math.atan2(y, x) * 180) / Math.PI
  heading = Number(((heading + 360) % 360).toFixed(2))

  return { midLon, midLat, heading }
}

/**
 * 在两航点之间线性插值生成指定数量的过渡航点
 */
export function interpolateWaypoints(startPt: any, endPt: any, count: number): any[] {
  if (count <= 0) return []
  const result: any[] = []
  const sLon = toNumber(startPt.lon), sLat = toNumber(startPt.lat), sAlt = toNumber(startPt.alt)
  const eLon = toNumber(endPt.lon), eLat = toNumber(endPt.lat), eAlt = toNumber(endPt.alt)
  const sSpeed = toNumber(startPt.speed, 0), eSpeed = toNumber(endPt.speed, 0)

  for (let i = 1; i <= count; i++) {
    const ratio = i / (count + 1)
    const pt = newAirlinePt()
    pt.lon = Number((sLon + (eLon - sLon) * ratio).toFixed(6))
    pt.lat = Number((sLat + (eLat - sLat) * ratio).toFixed(6))
    pt.alt = Number((sAlt + (eAlt - sAlt) * ratio).toFixed(2))
    pt.speed = Number((sSpeed + (eSpeed - sSpeed) * ratio).toFixed(1))
    pt.ch1 = 0
    pt.ch2 = 3
    result.push(pt)
  }
  return result
}

/**
 * 计算整条航线的总航程 (米)
 */
export function calculateRouteTotalDistance(points: any[], isClose = false): number {
  if (!points || points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += calculateSegmentDistance(points[i], points[i + 1])
  }
  if (isClose && points.length >= 3) {
    total += calculateSegmentDistance(points[points.length - 1], points[0])
  }
  return Number(total.toFixed(2))
}

/**
 * 绘制中拦截点击事件防误触
 */
export function blockDrawingEvent(
  event: Event,
  isDrawing: boolean,
  lastTipTimeRef: { value: number },
  warnTip?: () => void,
) {
  if (!isDrawing) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-route-manage-close="true"]') || target?.closest('[data-route-visibility-toggle="true"]')) return
  const now = Date.now()
  if (now - lastTipTimeRef.value > 800) {
    warnTip?.()
    lastTipTimeRef.value = now
  }
  event.preventDefault()
  event.stopPropagation()
  ;(event as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
}
