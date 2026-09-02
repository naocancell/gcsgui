/**
 * 文件描述：Milestone 4 深度解耦对抗性与压力测试套件
 * 角色：EMPIRICAL CHALLENGER
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as Cesium from 'cesium'

// Mock Naive UI message & notification for headless testing
vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return {
    ...actual,
    useMessage: () => ({
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      loading: vi.fn(() => ({ destroy: vi.fn() })),
    }),
    useNotification: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    }),
  }
})

// 1. 文件 I/O
import {
  getMinimumRoutePointCount,
  getRoutePointCountWarning,
  normalizeRouteForBiz,
  removeDuplicatedClosingPoint,
  useRouteFileIO,
} from '@/composables/useRouteFileIO'

// 2. 航线编辑数学与交互
import {
  toNumber,
  createPointBetween,
  createPointByExtension,
  createPointBefore,
  createPointAfter,
} from '@/composables/useRouteEditor'

// 3. 地形剖面与预警计算
import {
  calculateProfileRange,
  computeProfileX,
  computeProfileY,
  getAircraftLabel,
  profileWidth,
  profileHeight,
  profilePadding,
} from '@/composables/useTerrainWarningProfile'

// 4. 模拟电子围栏与伴飞
import {
  formatFenceDistance,
  extractMonitoredPlanes,
} from '@/composables/useSimulatedFence'
import {
  constrainCompanionOffset,
} from '@/composables/useAircraftCompanion'

// 5. 数据导入与路径规整
import {
  normalizeAssetPath,
  createLocalTilesetUrl,
  type LocalAsset,
} from '@/composables/useDataImporter'

// 6. 航线地形剖面图表
import {
  getEffectiveProfileInterval,
  getRouteProfileDistances,
  MAX_ROUTE_PROFILE_SAMPLES,
} from '@/composables/useRouteProfileChart'

describe('EMPIRICAL CHALLENGER: Milestone 4 God Component Deconstruction Adversarial Suite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('1. 航线文件 I/O 极端与对抗场景 (Route File I/O Edge Cases)', () => {
    it('空文本、纯空白、非法字符应被安全拦截或丢弃', () => {
      let imported: any = null
      const io = useRouteFileIO(() => true, (r) => { imported = r })

      const emptyRes = io.parseRouteFile('empty.route', '   \n\n\t  ')
      expect(emptyRes).toBeNull()

      const corruptRes = io.parseRouteFile('corrupt.route', 'invalid,format\nfoo,bar')
      expect(corruptRes).toBeNull()
      expect(imported).toBeNull()
    })

    it('标准 CSV 含有 nPt=0 引导行时应正确滤除且解析真实航点', () => {
      const csv = `
1, 0, 0.000000, 0.000000, 0.00, 0.0, 00, 03
1, 1, 110.123456, 20.123456, 300.50, 25.0, 00, 03
1, 2, 110.234567, 20.234567, 400.00, 30.0, 00, 03
1, 3, 110.345678, 20.345678, 500.00, 30.0, 02, 01
`
      let imported: any = null
      const io = useRouteFileIO(() => true, (r) => { imported = r })
      const res = io.parseRouteFile('test_flight.route', csv)

      expect(res).not.toBeNull()
      expect(res!.points.length).toBe(3)
      expect(res!.points[0].nPt).toBe(1)
      expect(res!.points[0].lon).toBe(110.123456)
      expect(res!.points[2].nPt).toBe(3)
      expect(res!.isClose).toBe(false)
      expect(imported).toBe(res)
    })

    it('闭合航线导入如果首末点重复，应精准去重并保持 isClose 为 true', () => {
      const route: any = {
        isClose: true,
        points: [
          { lon: 110.0, lat: 20.0, alt: 100 },
          { lon: 111.0, lat: 21.0, alt: 200 },
          { lon: 112.0, lat: 22.0, alt: 300 },
          { lon: 110.0, lat: 20.0, alt: 100 }, // 重复首点
        ],
      }
      removeDuplicatedClosingPoint(route)
      expect(route.points.length).toBe(3)
      expect(route.PtNum).toBe(3)
      expect(route.points[2].ch1).toBe(0) // 闭合航线末点 ch1 为 0
      expect(route.points[2].ch2).toBe(1) // 末点 ch2 为 1
    })

    it('非闭合航线即使首末点坐标相同，也不应误删末点', () => {
      const route: any = {
        isClose: false,
        points: [
          { lon: 110.0, lat: 20.0, alt: 100 },
          { lon: 111.0, lat: 21.0, alt: 200 },
          { lon: 110.0, lat: 20.0, alt: 100 },
        ],
      }
      removeDuplicatedClosingPoint(route)
      expect(route.points.length).toBe(3)
    })

    it('点数不足下限时应严格校验并返回对应警告', () => {
      expect(getMinimumRoutePointCount({ isClose: false })).toBe(2)
      expect(getMinimumRoutePointCount({ isClose: true })).toBe(3)

      expect(getRoutePointCountWarning({ isClose: false })).toContain('2 个航点')
      expect(getRoutePointCountWarning({ isClose: true })).toContain('3 个航点')
    })
  })

  describe('2. 航线几何插值与航点编辑对抗 (Waypoint Interpolation & Editing)', () => {
    it('toNumber 能稳健处理各种非法、边界、字符串类型', () => {
      expect(toNumber(undefined, 5)).toBe(5)
      expect(toNumber(null, 9)).toBe(9)
      expect(toNumber(NaN, 0)).toBe(0)
      expect(toNumber('not-a-number', -1)).toBe(-1)
      expect(toNumber('-12.34', 0)).toBe(-12.34)
      expect(toNumber(0, 100)).toBe(0)
    })

    it('createPointBetween: 两点中点插值在负值与零边界下的数值精度', () => {
      const ptA = { lon: -110.5, lat: -20.25, alt: 0, speed: 20 }
      const ptB = { lon: 110.5, lat: 20.25, alt: 500, speed: 40 }
      const mid = createPointBetween(ptA, ptB)

      expect(mid.lon).toBe(0)
      expect(mid.lat).toBe(0)
      expect(mid.alt).toBe(250)
      expect(mid.ch1).toBe(0)
      expect(mid.ch2).toBe(3)
    })

    it('createPointByExtension: 沿外插向量向外延伸', () => {
      const base = { lon: 100, lat: 20, alt: 300, speed: 20 }
      const other = { lon: 90, lat: 10, alt: 200, speed: 20 }
      const ext = createPointByExtension(base, other, 0.5)
      expect(ext.lon).toBe(105)
      expect(ext.lat).toBe(25)
      expect(ext.alt).toBe(350)
    })

    it('闭合航线在首尾插入航点应体现环形拓扑 (Circular Ring Topology)', () => {
      const closedRoute: any = {
        isClose: true,
        points: [
          { lon: 0, lat: 0, alt: 100 },
          { lon: 10, lat: 0, alt: 100 },
          { lon: 10, lat: 10, alt: 100 },
          { lon: 0, lat: 10, alt: 100 },
        ],
      }

      const beforeHead = createPointBefore(closedRoute, 0)
      expect(beforeHead).toBeDefined()
      expect(beforeHead!.lon).toBe(0)
      expect(beforeHead!.lat).toBe(5)

      const afterTail = createPointAfter(closedRoute, 3)
      expect(afterTail).toBeDefined()
      expect(afterTail!.lon).toBe(0)
      expect(afterTail!.lat).toBe(5)
    })

    it('非闭合航线在首尾插入航点应向外延长', () => {
      const openRoute: any = {
        isClose: false,
        points: [
          { lon: 100, lat: 20, alt: 100 },
          { lon: 102, lat: 20, alt: 100 },
          { lon: 104, lat: 20, alt: 100 },
        ],
      }

      const beforeHead = createPointBefore(openRoute, 0)
      expect(beforeHead).toBeDefined()
      expect(beforeHead!.lon).toBeLessThan(100)

      const afterTail = createPointAfter(openRoute, 2)
      expect(afterTail).toBeDefined()
      expect(afterTail!.lon).toBeGreaterThan(104)
    })

    it('单点或空点航线插值保护', () => {
      const emptyRoute: any = { isClose: false, points: [] }
      const singlePointRoute: any = { isClose: false, points: [{ lon: 1, lat: 1, alt: 1 }] }

      expect(createPointBefore(emptyRoute, 0)).toBeUndefined()
      expect(createPointAfter(emptyRoute, 0)).toBeUndefined()
      expect(createPointBefore(singlePointRoute, 0)).toBeUndefined()
      expect(createPointAfter(singlePointRoute, 0)).toBeUndefined()
    })
  })

  describe('3. 地形剖面高度计算与预警投影 (Terrain Warning Profile Mapping)', () => {
    it('平坦地面 (min == max) 或单高度点应有安全间隙填充', () => {
      const flatPoints = [
        { terrainHeight: 500, flightHeight: 500 },
        { terrainHeight: 500, flightHeight: 500 },
      ]
      const range = calculateProfileRange(flatPoints)
      expect(range).not.toBeNull()
      expect(range!.max - range!.min).toBeGreaterThanOrEqual(40)
      expect(range!.min).toBe(480)
      expect(range!.max).toBe(520)
    })

    it('空数据时 calculateProfileRange 返回 null，computeProfileY 安全回退', () => {
      expect(calculateProfileRange([])).toBeNull()
      const fallbackY = computeProfileY(100, null, profileHeight, profilePadding)
      expect(fallbackY).toBe(profileHeight - profilePadding)
    })

    it('computeProfileX 在距离为 0 与超限值时的映射', () => {
      const startX = computeProfileX(0, 10000, 340, 28)
      expect(startX).toBe(28)

      const midX = computeProfileX(5000, 10000, 340, 28)
      expect(midX).toBe(28 + (340 - 56) * 0.5)

      const endX = computeProfileX(10000, 10000, 340, 28)
      expect(endX).toBe(340 - 28)
    })

    it('getAircraftLabel 应全面覆盖所有无人机类型', () => {
      const mockUavStore: any = {
        uavInfoMap: new Map([['uav_99', { uavSeries: 'FP98', uavId: '990' }]]),
      }
      expect(getAircraftLabel({ kind: 'uavInfo', key: 'uav_99' } as any, mockUavStore)).toBe('FP98-990')
      expect(getAircraftLabel({ kind: 'fp95', key: 'fp95:A01' } as any, mockUavStore)).toBe('FP95-A01')
      expect(getAircraftLabel({ kind: 'fp981c', key: 'fp981c:C01' } as any, mockUavStore)).toBe('FP981C-C01')
    })
  })

  describe('4. 模拟电子围栏与伴飞约束 (Simulated Fence & Companion Constraints)', () => {
    it('formatFenceDistance 各种边界值格式化测试', () => {
      expect(formatFenceDistance(0)).toBe('0 m')
      expect(formatFenceDistance(9999.4)).toBe('9999 m')
      expect(formatFenceDistance(10000)).toBe('10000 m')
      expect(formatFenceDistance(10001)).toBe('10.0 km')
      expect(formatFenceDistance(15360)).toBe('15.4 km')
    })

    it('extractMonitoredPlanes 面对 NaN、畸形与多机状态时的过滤提取', () => {
      const mockStore: any = {
        uavInfoMap: new Map([
          ['valid1', { uavId: 1, uavSeries: 'FP98', longitude: 109.0, latitude: 20.0, relativeAltitude: 100, groundSpeed: 10, headingAngle: 0, pitchAngle: 0, rollAngle: 0, time: 0 }],
          ['invalidLon', { uavId: 2, uavSeries: 'FP98', longitude: NaN, latitude: 20.0 }],
          ['invalidLat', { uavId: 3, uavSeries: 'FP98', longitude: 109.0, latitude: undefined }],
        ]),
        fp981cMap: new Map([
          ['validFP', { c2: { gps_longitude: 1_095_000_000, gps_latitude: 205_000_000, hb_height: 200, uav_id: '981' } }],
          ['invalidFP', { c1: {} }],
        ]),
      }
      const planes = extractMonitoredPlanes(mockStore)
      expect(planes.length).toBe(2)
      expect(planes.map((p) => p.lon)).toEqual([109.0, 109.5])
    })

    it('constrainCompanionOffset 应在零/小向量输入下保持安全非零偏移', () => {
      const nearZero = new Cesium.Cartesian3(0, 0, 0)
      constrainCompanionOffset(nearZero, 30, 80)
      expect(nearZero.z).toBeGreaterThanOrEqual(30)
      const dist = Cesium.Cartesian3.magnitude(nearZero)
      expect(dist).toBeGreaterThanOrEqual(80)
    })
  })

  describe('5. 本地 3D Tiles / 资产导入与路径规整 (Data Importer & Path Resolution)', () => {
    it('normalizeAssetPath 应消除冗余反斜杠和层级回退', () => {
      expect(normalizeAssetPath('a\\b\\..\\c\\.\\d')).toBe('a/c/d')
      expect(normalizeAssetPath('/root//nested/file.json')).toBe('root/nested/file.json')
    })

    it('createLocalTilesetUrl 缺少 tileset.json 应抛出清晰的错误', async () => {
      const dummyAssets: LocalAsset[] = [
        { path: 'models/tree.b3dm', file: new File(['data'], 'tree.b3dm') },
      ]
      await expect(createLocalTilesetUrl(dummyAssets)).rejects.toThrow('所选目录中未找到 tileset.json')
    })
  })

  describe('6. 地形剖面分析与图表采样算法 (Route Profile Chart Sampling)', () => {
    it('getEffectiveProfileInterval 在超长航线时自适应抬升采样步长，防止 OOM', () => {
      const longDistanceArr = [0, 50_000_000] // 50,000 km
      const step = getEffectiveProfileInterval(longDistanceArr, 1, 100)
      expect(step).toBeGreaterThan(100)
      expect(step).toBeGreaterThanOrEqual(Math.ceil(50_000_000 / MAX_ROUTE_PROFILE_SAMPLES))
    })

    it('getRouteProfileDistances 累计距离单调递增且起点为 0', () => {
      const pts = [
        Cesium.Cartesian3.fromDegrees(109.0, 20.0, 100),
        Cesium.Cartesian3.fromDegrees(109.1, 20.0, 100),
        Cesium.Cartesian3.fromDegrees(109.2, 20.0, 100),
      ]
      const dists = getRouteProfileDistances(pts)
      expect(dists.length).toBe(3)
      expect(dists[0]).toBe(0)
      expect(dists[1]).toBeGreaterThan(0)
      expect(dists[2]).toBeGreaterThan(dists[1])
    })
  })
})
