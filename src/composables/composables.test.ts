/**
 * 文件描述：新增 Composables 业务逻辑单元测试套件
 */
import { describe, it, expect } from 'vitest'
import * as Cesium from 'cesium'

// 1. 数据导入与路径处理
import {
  normalizeAssetPath,
  dataOptions,
  isAbortError,
} from '@/composables/useDataImporter'

// 2. 伴飞与姿态
import {
  constrainCompanionOffset,
  getAircraftHeading,
} from '@/composables/useAircraftCompanion'

// 3. 模拟电子围栏
import {
  formatFenceDistance,
  extractMonitoredPlanes,
} from '@/composables/useSimulatedFence'

// 4. 通信配置
import {
  baudRateOptions,
  serialProtocolOptions,
  linkKindOptions,
  udpProtocolOptions,
} from '@/composables/useCommsSettings'

// 5. 地形剖面与预警计算
import {
  calculateProfileRange,
  computeProfileX,
  computeProfileY,
  getAircraftLabel,
  profileWidth,
  profileHeight,
  profilePadding,
} from '@/composables/useTerrainWarningProfile'

// 6. 航线文件 IO
import {
  getMinimumRoutePointCount,
  getRoutePointCountWarning,
  normalizeRouteForBiz,
  removeDuplicatedClosingPoint,
} from '@/composables/useRouteFileIO'

// 7. 航线地形剖面图表
import {
  getProfilePoints,
  getEffectiveProfileInterval,
  getRouteProfileCacheKey,
} from '@/composables/useRouteProfileChart'

// 8. 航线交互编辑与几何工具
import {
  toNumber,
  createPointBetween,
  createPointByExtension,
  createPointBefore,
  createPointAfter,
  calculateSegmentDistance,
  calculateMidpointAndHeading,
  interpolateWaypoints,
  calculateRouteTotalDistance,
  cloneRoutePoints,
  createRouteSnapshot,
  applyPointOperation,
  PtOptions,
  routeCode,
} from '@/composables/routeGeometryUtils'

describe('Composables Unit Test Suite', () => {
  describe('1. useDataImporter Logic', () => {
    it('normalizeAssetPath 应正确规整 Windows 路径与相对路径', () => {
      expect(normalizeAssetPath('dir\\subdir\\file.json')).toBe('dir/subdir/file.json')
      expect(normalizeAssetPath('dir/./subdir/../file.json')).toBe('dir/file.json')
      expect(normalizeAssetPath('a/b/c/../../d')).toBe('a/d')
    })

    it('dataOptions 应包含预期的 4 种数据格式', () => {
      const keys = dataOptions.map((opt) => opt.key)
      expect(keys).toEqual(['kml', 'geojson', 'shp', '3dtiles'])
    })

    it('isAbortError 应正确判定 DOMException AbortError', () => {
      const abortErr = new DOMException('User cancelled', 'AbortError')
      const generalErr = new Error('Network error')
      expect(isAbortError(abortErr)).toBe(true)
      expect(isAbortError(generalErr)).toBe(false)
    })
  })

  describe('2. useAircraftCompanion Logic', () => {
    it('constrainCompanionOffset 应限制最小高度 (30m) 与最小距离 (80m)', () => {
      const offset = new Cesium.Cartesian3(0, 0, 10)
      constrainCompanionOffset(offset, 30, 80)
      expect(offset.z).toBeGreaterThanOrEqual(30)
      const magnitude = Cesium.Cartesian3.magnitude(offset)
      expect(magnitude).toBeGreaterThanOrEqual(80)
    })

    it('getAircraftHeading 应从不同机型 metadata 中正确读取航向角', () => {
      const mockUavStore: any = {
        uavInfoMap: new Map([['uav_1', { headingAngle: 123.4 }]]),
        fp95Aggregate: { uavId: '95', frame81: { headingAngle: 45.6 } },
        fp981cMap: new Map([['c1', { c1: { head_angle: 8000 } }]]),
      }
      expect(getAircraftHeading({ kind: 'uavInfo', key: 'uav_1' }, mockUavStore)).toBe(123.4)
      expect(getAircraftHeading({ kind: 'fp95', key: 'fp95:95' }, mockUavStore)).toBe(45.6)
      expect(getAircraftHeading({ kind: 'fp981c', key: 'fp981c:c1' }, mockUavStore)).toBe(80)
    })
  })

  describe('3. useSimulatedFence Logic', () => {
    it('formatFenceDistance 应将米格式化为友好字符串 (米或千米)', () => {
      expect(formatFenceDistance(1500)).toBe('1500 m')
      expect(formatFenceDistance(12000)).toBe('12.0 km')
    })

    it('extractMonitoredPlanes 应准确筛选并标准化无人机状态', () => {
      const mockUavStore: any = {
        uavInfoMap: new Map([
          ['1', { longitude: 110, latitude: 30, uavSeries: 'UAV', uavId: '1' }],
        ]),
        fp981cMap: new Map(),
      }
      const monitored = extractMonitoredPlanes(mockUavStore)
      expect(monitored.length).toBe(1)
      expect(monitored[0].id).toBe('UAV:1')
    })
  })

  describe('4. useCommsSettings Logic', () => {
    it('通信选项枚举应包含必要的标准波特率与链路类型', () => {
      const baudValues = baudRateOptions.map((b) => b.value)
      expect(baudValues).toContain(115200)
      expect(baudValues).toContain(9600)

      const kindValues = linkKindOptions.map((k) => k.value)
      expect(kindValues).toContain('serial')
      expect(kindValues).toContain('udp-unicast')

      const serialProtocols = serialProtocolOptions.map((p) => p.value)
      expect(serialProtocols).toContain('FP981C')

      const udpProtocols = udpProtocolOptions.map((p) => p.value)
      expect(udpProtocols).toContain('UAVInfo')
    })
  })

  describe('5. useTerrainWarningProfile Math', () => {
    it('calculateProfileRange 应正确计算地形与航线高度的极值及跨度', () => {
      const points = [
        { terrainHeight: 100, flightHeight: 200 },
        { terrainHeight: 150, flightHeight: 300 },
      ]
      const range = calculateProfileRange(points)
      expect(range).not.toBeNull()
      expect(range!.min).toBeLessThan(100)
      expect(range!.max).toBeGreaterThan(300)
    })

    it('computeProfileX 和 computeProfileY 应将地理数据映射到 SVG 画布坐标范围', () => {
      const x = computeProfileX(5000, 10000, profileWidth, profilePadding)
      expect(x).toBeGreaterThanOrEqual(profilePadding)
      expect(x).toBeLessThanOrEqual(profileWidth - profilePadding)

      const y = computeProfileY(200, { min: 50, max: 350 }, profileHeight, profilePadding)
      expect(y).toBeGreaterThanOrEqual(profilePadding)
      expect(y).toBeLessThanOrEqual(profileHeight - profilePadding)
    })

    it('getAircraftLabel 应正确提取并回退显示名称', () => {
      const mockUavStore: any = {
        uavInfoMap: new Map([['uav_1', { uavSeries: 'FP', uavId: '01' }]]),
      }
      expect(getAircraftLabel({ kind: 'uavInfo', key: 'uav_1' }, mockUavStore)).toBe('FP-01')
      expect(getAircraftLabel({ kind: 'fp95', key: 'fp95:99' }, mockUavStore)).toBe('FP95-99')
    })
  })

  describe('6. useRouteFileIO Business Rules', () => {
    it('闭合航线至少需要 3 个航点，非闭合航线至少需要 2 个航点', () => {
      expect(getMinimumRoutePointCount({ isClose: true })).toBe(3)
      expect(getMinimumRoutePointCount({ isClose: false })).toBe(2)
      expect(getRoutePointCountWarning({ isClose: true })).toContain('3')
      expect(getRoutePointCountWarning({ isClose: false })).toContain('2')
    })

    it('removeDuplicatedClosingPoint 应移除与首点重复的闭合航线尾点', () => {
      const route: any = {
        isClose: true,
        points: [
          { lon: 110.123456, lat: 30.123456, alt: 100 },
          { lon: 110.2, lat: 30.2, alt: 150 },
          { lon: 110.123456, lat: 30.123456, alt: 100 },
        ],
      }
      removeDuplicatedClosingPoint(route)
      expect(route.points).toHaveLength(2)
    })

    it('normalizeRouteForBiz 应正确计算总航点数并规范标志位', () => {
      const route: any = {
        name: '测试航线',
        isClose: false,
        points: [
          { lon: 100, lat: 20, alt: 100 },
          { lon: 100.01, lat: 20.01, alt: 100 },
        ],
      }
      normalizeRouteForBiz(route)
      expect(route.PtNum).toBe(2)
      expect(route.points[0].nPt).toBe(1)
      expect(route.points[1].nPt).toBe(2)
    })
  })

  describe('7. useRouteProfileChart Cache & Sampling', () => {
    it('getEffectiveProfileInterval 应限制采样间距与最大采样点限制', () => {
      const routeDistanceArr = [0, 500, 1000]
      const interval = getEffectiveProfileInterval(routeDistanceArr, 2, 100)
      expect(interval).toBeGreaterThanOrEqual(100)
    })

    it('getProfilePoints 在闭合航线时应临时追加首点', () => {
      const route: any = {
        isClose: true,
        points: [
          { lon: 100, lat: 20, alt: 100 },
          { lon: 101, lat: 21, alt: 100 },
          { lon: 102, lat: 20, alt: 100 },
        ],
      }
      const pts = getProfilePoints(route)
      expect(pts).toHaveLength(4)
      expect(pts[3].lon).toBe(100)
    })

    it('getRouteProfileCacheKey 应生成唯一且幂等的缓存标识', () => {
      const route: any = {
        unicode: 'route_123',
        isClose: true,
        points: [{ lon: 100, lat: 20, alt: 100 }],
      }
      const key1 = getRouteProfileCacheKey(route, 1000)
      const key2 = getRouteProfileCacheKey(route, 1000)
      const keyDiff = getRouteProfileCacheKey(route, 500)
      expect(key1).toBe(key2)
      expect(key1).not.toBe(keyDiff)
    })
  })

  describe('8. routeGeometryUtils Math & Editing Logic', () => {
    it('toNumber 应正确转换数字或使用默认值', () => {
      expect(toNumber('123.45')).toBe(123.45)
      expect(toNumber(null, 10)).toBe(10)
      expect(toNumber(undefined, 0)).toBe(0)
    })

    it('createPointBetween 应精确计算两点中点坐标与高度', () => {
      const ptA = { lon: 100, lat: 20, alt: 100, speed: 25 }
      const ptB = { lon: 102, lat: 22, alt: 300, speed: 35 }
      const mid = createPointBetween(ptA, ptB)
      expect(mid.lon).toBe(101)
      expect(mid.lat).toBe(21)
      expect(mid.alt).toBe(200)
      expect(mid.ch2).toBe(3)
    })

    it('createPointByExtension 应沿远离方向延长外插新航点', () => {
      const base = { lon: 102, lat: 22, alt: 300, speed: 30 }
      const other = { lon: 100, lat: 20, alt: 200, speed: 30 }
      const ext = createPointByExtension(base, other, 0.5)
      expect(ext.lon).toBe(103)
      expect(ext.lat).toBe(23)
      expect(ext.alt).toBe(350)
    })

    it('createPointBefore 和 createPointAfter 应正确处理首末点插入', () => {
      const route: any = {
        isClose: false,
        points: [
          { lon: 100, lat: 20, alt: 100 },
          { lon: 102, lat: 22, alt: 200 },
          { lon: 104, lat: 24, alt: 300 },
        ],
      }

      const beforeMid = createPointBefore(route, 1)
      expect(beforeMid?.lon).toBe(101)

      const afterMid = createPointAfter(route, 1)
      expect(afterMid?.lon).toBe(103)

      const afterEnd = createPointAfter(route, 2)
      expect(afterEnd?.lon).toBeGreaterThan(104)
    })

    it('calculateSegmentDistance 与 calculateRouteTotalDistance 应准确计算距离', () => {
      const p1 = { lon: 116.397128, lat: 39.916527 }
      const p2 = { lon: 116.407128, lat: 39.916527 }
      const dist = calculateSegmentDistance(p1, p2)
      expect(dist).toBeGreaterThan(800)
      expect(dist).toBeLessThan(900)

      const totalDist = calculateRouteTotalDistance([p1, p2, p1], true)
      expect(totalDist).toBeCloseTo(dist * 2, -1)
    })

    it('calculateMidpointAndHeading 应准确计算中点与真北航向角', () => {
      const p1 = { lon: 116.0, lat: 39.0 }
      const p2 = { lon: 116.0, lat: 40.0 }
      const { midLon, midLat, heading } = calculateMidpointAndHeading(p1, p2)
      expect(midLon).toBe(116.0)
      expect(midLat).toBe(39.5)
      expect(heading).toBeCloseTo(0, 1)
    })

    it('interpolateWaypoints 应在两航点之间线性插值过渡点', () => {
      const s = { lon: 100, lat: 20, alt: 100, speed: 10 }
      const e = { lon: 104, lat: 24, alt: 500, speed: 50 }
      const pts = interpolateWaypoints(s, e, 3)
      expect(pts).toHaveLength(3)
      expect(pts[0].lon).toBe(101)
      expect(pts[1].lon).toBe(102)
      expect(pts[2].lon).toBe(103)
      expect(pts[1].alt).toBe(300)
      expect(pts[1].speed).toBe(30)
    })

    it('cloneRoutePoints 与 createRouteSnapshot 应产生深拷贝快照', () => {
      const route: any = {
        unicode: 'test_1',
        isClose: true,
        points: [{ lon: 100, lat: 20, alt: 100 }],
      }
      const snapshot = createRouteSnapshot(route)
      expect(snapshot?.points).toHaveLength(1)
      expect(snapshot?.isClose).toBe(true)

      // 验证快照为深拷贝独立对象
      snapshot!.points[0].lon = 105
      expect(route.points[0].lon).toBe(100)
    })

    it('applyPointOperation 应正确处理删除和插入', () => {
      const route: any = {
        isClose: false,
        points: [
          { lon: 100, lat: 20, alt: 100 },
          { lon: 102, lat: 22, alt: 200 },
          { lon: 104, lat: 24, alt: 300 },
        ],
      }
      const delRes = applyPointOperation(route, 'deletePt', 1)
      expect(delRes.success).toBe(true)
      if (delRes.success) {
        expect(delRes.points).toHaveLength(2)
        expect(delRes.points[0].lon).toBe(100)
        expect(delRes.points[1].lon).toBe(104)
      }

      const insRes = applyPointOperation(route, 'insertBefore', 1)
      expect(insRes.success).toBe(true)
      if (insRes.success) {
        expect(insRes.points).toHaveLength(4)
        expect(insRes.points[1].lon).toBe(101)
      }
    })
  })
})
