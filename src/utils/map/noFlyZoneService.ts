import {
  bbox,
  booleanIntersects,
  booleanPointInPolygon,
  circle,
  lineString,
  point,
  polygon,
} from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'

export type RouteCoordinate = {
  lon: number
  lat: number
}

export type NoFlyZoneConflict = {
  zoneId: string
  areaId: string
  name: string
  level: number
}

export type NoFlyZoneRecord = NoFlyZoneConflict & {
  color: string
  feature: Feature<Polygon>
  bounds: [number, number, number, number]
}

type RawNoFlyZone = Record<string, any>

const LEVEL_COLORS: Record<number, string> = {
  1: '#2F80ED',
  2: '#E5484D',
  3: '#F59E0B',
}

function normalizeCoordinate(value: unknown) {
  const coordinate = Number(value)
  return Number.isFinite(coordinate) ? coordinate : undefined
}
//标准化处理航点数据
function normalizeRing(rawRing: unknown): Position[] | undefined {
  if (!Array.isArray(rawRing)) return undefined

  const ring = rawRing
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return undefined
      const longitude = normalizeCoordinate(coordinate[0])
      const latitude = normalizeCoordinate(coordinate[1])
      if (longitude === undefined || latitude === undefined) return undefined
      return [longitude, latitude] as Position
    })
    .filter((coordinate): coordinate is Position => coordinate !== undefined)

  if (ring.length < 3) return undefined

  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first])
  }

  return ring.length >= 4 ? ring : undefined
}

function boundsOverlap(
  left: [number, number, number, number],
  right: [number, number, number, number],
) {
  return !(
    left[2] < right[0] ||
    left[0] > right[2] ||
    left[3] < right[1] ||
    left[1] > right[3]
  )
}
//获取禁飞区的唯一标识符
function getAreaId(area: RawNoFlyZone) {
  // 尝试获取禁飞区的唯一编号，并统一转换成字符串；如果数据里没有编号，自动生成一个临时编号
  return String(area.area_id ?? area.id ?? `nfz-${Date.now()}`)
}

export function getNoFlyZoneLevelColor(level: number, fallback?: string) {
  return LEVEL_COLORS[level] ?? (fallback || '#8E8E93')
}

class NoFlyZoneService {
  //records 是保存标准化禁飞区的 Map
  private records = new Map<string, NoFlyZoneRecord>()
  private loaded = false

  isLoaded() {
    return this.loaded
  }

  getRecords() {
    return Array.from(this.records.values())
  }

  replaceAreas(areas: RawNoFlyZone[]) {
    this.records.clear()//清除map中的禁飞区记录
    //解析每个禁飞区数据
    areas.forEach((area) => this.addArea(area))
    this.loaded = true
    return this.getRecords()
  }

  addArea(area: RawNoFlyZone) {
    const areaId = getAreaId(area)
    this.removeArea(areaId)//删除已存在的禁飞区记录，避免重复
    //如果禁飞区包含有效的子区域，就处理子区域；否则把禁飞区本身当成唯一的待处理区域
    const sourceItems =
      Array.isArray(area.sub_areas) && area.sub_areas.length
        ? area.sub_areas
        : [area]
    //本次新创建得禁飞区记录，用于更新cesium显示
    const createdRecords: NoFlyZoneRecord[] = []

    sourceItems.forEach((item: RawNoFlyZone, itemIndex: number) => {
      const level = Number(item.level ?? area.level ?? 0)
      const color = getNoFlyZoneLevelColor(
        level,
        String(item.color ?? area.color ?? ''),
      )
      const name = String(item.name ?? area.name ?? `禁飞区 ${areaId}`)
      //获取子区域或父区域得多边形坐标值
      const polygonPoints = item.polygon_points ?? area.polygon_points
      //确保数据是数组
      const rawPolygons = Array.isArray(polygonPoints) ? polygonPoints : []
      /*
        遍历所有多边形（子区域内可能存在多个多边形）
        rawRing：当前多边形的全部坐标
        polygonIndex：当前是第几个多边形，从0开始
      */
      
      rawPolygons.forEach((rawRing: unknown, polygonIndex: number) => {
        const ring = normalizeRing(rawRing)
        if (!ring) return
        //从线环数组创建一个多边形要素
        const feature = polygon([ring])
        const zoneId = `${areaId}:${itemIndex}:${polygonIndex}`
        const record: NoFlyZoneRecord = {
          zoneId,
          areaId,
          name,
          level,
          color,
          feature,
          bounds: bbox(feature) as [number, number, number, number],
        }
        this.records.set(zoneId, record)
        createdRecords.push(record)
      })
      //是多边形就结束  是圆形则单独处理圆形
      if (rawPolygons.length > 0) return

      const longitude = normalizeCoordinate(item.lng ?? area.lng)
      const latitude = normalizeCoordinate(item.lat ?? area.lat)
      const radius = Number(item.radius ?? area.radius ?? 0)
      if (
        longitude === undefined ||
        latitude === undefined ||
        !Number.isFinite(radius) ||
        radius <= 0
      ) {
        return
      }

      const feature = circle([longitude, latitude], radius / 1000, {
        steps: 64,
        units: 'kilometers',
      })
      const zoneId = `${areaId}:${itemIndex}:circle`
      const record: NoFlyZoneRecord = {
        zoneId,
        areaId,
        name,
        level,
        color,
        feature,
        bounds: bbox(feature) as [number, number, number, number],
      }
      this.records.set(zoneId, record)
      createdRecords.push(record)
    })

    return createdRecords
  }

  removeArea(areaId: string | number) {
    const normalizedAreaId = String(areaId)
    const removedZoneIds: string[] = []

    this.records.forEach((record, zoneId) => {
      if (record.areaId !== normalizedAreaId) return
      this.records.delete(zoneId)
      removedZoneIds.push(zoneId)
    })

    return removedZoneIds
  }

  clear() {
    this.records.clear()
    this.loaded = false
  }
//检查一组航线经纬度是否落入、接触或穿过任意禁飞区。如果有冲突，返回第一个冲突禁飞区；没有冲突则返回 null
  findRouteConflict(
    routePoints: RouteCoordinate[],
    isClose = false,//是否闭合航线
  ): NoFlyZoneConflict | null {
    if (!this.loaded || this.records.size === 0) return null

    const coordinates = routePoints
      .map((routePoint) => {
        const longitude = normalizeCoordinate(routePoint?.lon)
        const latitude = normalizeCoordinate(routePoint?.lat)
        if (longitude === undefined || latitude === undefined) return undefined
        return [longitude, latitude] as [number, number]
      })
      .filter(
        (coordinate): coordinate is [number, number] =>
          coordinate !== undefined,
      )

    if (coordinates.length === 0) return null

    if (coordinates.length === 1) {
      const routePoint = point(coordinates[0])
      const routeBounds: [number, number, number, number] = [
        coordinates[0][0],
        coordinates[0][1],
        coordinates[0][0],
        coordinates[0][1],
      ]

      for (const record of this.records.values()) {
        if (!boundsOverlap(routeBounds, record.bounds)) continue
        if (booleanPointInPolygon(routePoint, record.feature)) return record
      }
      return null
    }

    const lineCoordinates = [...coordinates]
    if (isClose && coordinates.length >= 3) {
      lineCoordinates.push(coordinates[0])
    }
    const routeLine = lineString(lineCoordinates)
    const routeBounds = bbox(routeLine) as [number, number, number, number]

    for (const record of this.records.values()) {
      if (!boundsOverlap(routeBounds, record.bounds)) continue
      if (booleanIntersects(routeLine, record.feature)) return record
    }

    return null
  }
}

export function formatNoFlyZoneConflictMessage(
  conflict: NoFlyZoneConflict,
  action = '此操作',
) {
  const levelLabel = conflict.level > 0 ? `${conflict.level}级` : ''
  return `${action}将使航线进入或穿过${levelLabel}禁飞区“${conflict.name}”，已禁止`
}

export const noFlyZoneService = new NoFlyZoneService()
