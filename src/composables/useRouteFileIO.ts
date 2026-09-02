/**
 * 文件描述：航线文件 IO Composable (.route CSV 文件导入导出)
 */
import type { Airline } from '@/types/entityoptions'
import { newAirline, newAirlinePt } from '@/core/gis/types'
import { useMessage } from 'naive-ui'
import { useRouteStore } from '@/store/RouteStore'
import {
  formatNoFlyZoneConflictMessage,
  noFlyZoneService,
} from '@/utils/map/noFlyZoneService'

export function getMinimumRoutePointCount(route: Pick<Airline, 'isClose'>): number {
  return route.isClose ? 3 : 2
}

export function getRoutePointCountWarning(route: Pick<Airline, 'isClose'>): string {
  const minimum = getMinimumRoutePointCount(route)
  return `${route.isClose ? '闭合' : '非闭合'}航线至少需要 ${minimum} 个航点`
}

/**
 * 统一整理航线业务字段。
 */
export function normalizeRouteForBiz(route: Airline) {
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

/**
 * 如果导入文件里已经把首点重复写到了末尾，闭合航线只保留真实航点。
 */
export function removeDuplicatedClosingPoint(route: Airline) {
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

export function useRouteFileIO(
  isRouteActionIdle: () => boolean,
  onRouteImported?: (route: Airline) => void,
) {
  const uiMsg = useMessage()
  const routeStore = useRouteStore()

  function parseRouteFile(fileName: string, content: string): Airline | null {
    if (!isRouteActionIdle()) return null

    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) {
      uiMsg.error('航线文件为空')
      return null
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
      return null
    }

    newRoute.code = code
    newRoute.PtNum = newRoute.points.length

    const lastPt = newRoute.points[newRoute.points.length - 1]
    newRoute.isClose = lastPt.ch1 === 0

    removeDuplicatedClosingPoint(newRoute)
    normalizeRouteForBiz(newRoute)

    if (newRoute.points.length < getMinimumRoutePointCount(newRoute)) {
      uiMsg.error(getRoutePointCountWarning(newRoute))
      return null
    }

    const conflict = noFlyZoneService.findRouteConflict(
      newRoute.points || [],
      newRoute.isClose,
    )
    if (conflict) {
      uiMsg.warning(formatNoFlyZoneConflictMessage(conflict, '导入航线'))
      return null
    }

    routeStore.addRoute(newRoute)
    onRouteImported?.(newRoute)
    uiMsg.success(`成功导入航线: ${newRoute.name}`)
    return newRoute
  }

  function importRoute() {
    if (!isRouteActionIdle()) return

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.route'

    input.onchange = (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (ev) => {
        if (!isRouteActionIdle()) return
        const text = ev.target?.result as string
        parseRouteFile(file.name, text)
      }
      reader.readAsText(file)
    }

    input.click()
  }

  function exportRoute(selectedRoute: Airline | null) {
    if (!selectedRoute?.unicode || !selectedRoute.points?.length) {
      uiMsg.warning('请先选择一条有效的航线')
      return
    }

    normalizeRouteForBiz(selectedRoute)

    const code = selectedRoute.code || 1
    let content = `${code}, 0, 0.000000, 0.000000, 0.00, 0.0, 00, 03\n`

    selectedRoute.points.forEach((pt, index) => {
      const nPt = pt.nPt || index + 1
      const lon = Number(pt.lon ?? 0).toFixed(6)
      const lat = Number(pt.lat ?? 0).toFixed(6)
      const alt = Number(pt.alt ?? 0).toFixed(2)
      const speed = Number(pt.speed ?? 0).toFixed(1)

      let ch1Val = pt.ch1 ?? 0
      if (index === selectedRoute.points.length - 1) {
        ch1Val = selectedRoute.isClose ? 0 : 2
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
    a.download = `${selectedRoute.name || '导出航线'}.route`
    a.click()
    URL.revokeObjectURL(url)

    uiMsg.success('航线文件已导出')
  }

  return {
    importRoute,
    parseRouteFile,
    exportRoute,
    removeDuplicatedClosingPoint,
    getMinimumRoutePointCount,
    getRoutePointCountWarning,
    normalizeRouteForBiz,
  }
}
