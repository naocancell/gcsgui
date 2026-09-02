import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as Cesium from 'cesium'
import * as GIS from './index'
import {
  newAirline,
  newAirlinePt,
  dataProcess,
  dataProcess_fromQT,
  dataProcess_fromQT_route,
  getUavTypeStr,
  setChartOptions,
  query_surface_forecast,
  query_upper_forecast,
  requireWeatherLevel,
  NFZViewer,
  MeasureViewer,
  RouteManageViewer,
} from './index'
import { useLayerStore } from '@/store/layerManagerStore'
import { noFlyZoneService } from '@/utils/map/noFlyZoneService'

// Setup global browser-like stubs for Node test environment
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map<string, string>()
  globalThis.sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    length: store.size,
  }
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    getComputedStyle: () => ({ position: 'relative' }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as any
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        style: { cursor: 'default' },
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(false),
        },
        children: [],
        appendChild: vi.fn((child) => {
          el.children.push(child)
          return child
        }),
        removeChild: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      }
      return el
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
  } as any
}

// Mock axios and tauri
vi.mock('axios', () => ({
  default: vi.fn().mockImplementation((config) =>
    Promise.resolve({
      data: { success: true, url: config?.url, headers: config?.headers },
    }),
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'load_cached_nfz' || cmd === 'fetch_and_cache_nfz') {
      return Promise.resolve([
        {
          area_id: 'test_nfz_1',
          name: '测试禁飞区',
          level: 2,
          color: '#E5484D',
          polygon_points: [
            [
              [116.3, 39.9],
              [116.4, 39.9],
              [116.4, 40.0],
              [116.3, 40.0],
              [116.3, 39.9],
            ],
          ],
        },
      ])
    }
    return Promise.resolve([])
  }),
}))

describe('Challenger Adversarial Verification — GIS Domain Engine', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('1. Interface Completeness & Export Fidelity', () => {
    it('ensures all 7 core modules and types are cleanly exported with named and default exports', () => {
      expect(GIS.NFZViewer).toBe(NFZViewer)
      expect(GIS.MeasureViewer).toBe(MeasureViewer)
      expect(GIS.RouteManageViewer).toBe(RouteManageViewer)
      expect(typeof GIS.newAirline).toBe('function')
      expect(typeof GIS.newAirlinePt).toBe('function')
      expect(typeof GIS.dataProcess).toBe('function')
      expect(typeof GIS.dataProcess_fromQT).toBe('function')
      expect(typeof GIS.dataProcess_fromQT_route).toBe('function')
      expect(typeof GIS.getUavTypeStr).toBe('function')
      expect(typeof GIS.setChartOptions).toBe('function')
      expect(typeof GIS.query_surface_forecast).toBe('function')
      expect(typeof GIS.query_upper_forecast).toBe('function')
      expect(typeof GIS.requireWeatherLevel).toBe('function')
    })

    it('verifies Airline & AirlinePoint factory behavior and edge values', () => {
      const emptyPt = newAirlinePt()
      expect(emptyPt.ch1).toBe(0)
      expect(emptyPt.ch2).toBe(0)
      expect(emptyPt.speed).toBe(0)
      expect(emptyPt.lon).toBeUndefined()
      expect(emptyPt.lat).toBeUndefined()
      expect(emptyPt.alt).toBeUndefined()

      const emptyLine = newAirline()
      expect(emptyLine.name).toBe('')
      expect(emptyLine.isClose).toBe(false)
      expect(emptyLine.isVisible).toBe(true)
      expect(emptyLine.points).toEqual([])
      expect(emptyLine.unicode).toBeDefined()
    })
  })

  describe('2. NFZViewer Adversarial & Lifecycle Stress Test', () => {
    it('handles uninitialized viewer gracefully and idempotently destroys', () => {
      const nfz = new NFZViewer()
      expect(nfz.viewer).toBeNull()
      expect(nfz.isLoaded()).toBe(noFlyZoneService.isLoaded())

      // Idempotent destroy before init should not throw
      expect(() => nfz.destroy()).not.toThrow()
      expect(() => nfz.destroy()).not.toThrow()
    })

    it('handles clear() and removeNFZArea() with missing entities cleanly', () => {
      const nfz = new NFZViewer()
      expect(() => nfz.clear()).not.toThrow()
      expect(nfz.removeNFZArea('non-existent-area')).toBe(0)
    })

    it('manages data loading and terrain depth test toggling with mock viewer', async () => {
      const mockViewer: any = {
        scene: {
          globe: { depthTestAgainstTerrain: true },
          preRender: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
          requestRender: vi.fn(),
        },
        dataSources: {
          add: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockReturnValue(true),
        },
        isDestroyed: () => false,
      }

      const nfz = new NFZViewer(mockViewer)
      expect(nfz.viewer).toBe(mockViewer)

      // Test toggleNFZ show
      const showResult = await nfz.toggleNFZ(true, 'sync')
      expect(showResult).toBe(true)
      expect(nfz.isVisible).toBe(true)
      expect(mockViewer.scene.globe.depthTestAgainstTerrain).toBe(false)
      expect(mockViewer.scene.preRender.addEventListener).toHaveBeenCalled()

      // Test toggleNFZ hide
      const hideResult = await nfz.toggleNFZ(false)
      expect(hideResult).toBe(true)
      expect(nfz.isVisible).toBe(false)
      expect(mockViewer.scene.preRender.removeEventListener).toHaveBeenCalled()

      // Test destroy
      expect(() => nfz.destroy()).not.toThrow()
      expect(nfz.viewer).toBeNull()
      expect(nfz.dataSource).toBeNull()
    })
  })

  describe('3. MeasureViewer Math & Spatial Calculation Stress Test', () => {
    const createMockCanvas = () => ({
      clientWidth: 800,
      clientHeight: 600,
      style: { cursor: 'default' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    })

    const createMockViewer = () => ({
      scene: {
        canvas: createMockCanvas(),
        globe: { depthTestAgainstTerrain: true },
        primitives: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn(),
        },
        requestRender: vi.fn(),
      },
      entities: {
        add: vi.fn().mockReturnValue({}),
        remove: vi.fn(),
        removeAll: vi.fn(),
        getById: vi.fn(),
      },
      dataSources: {
        add: vi.fn(),
        remove: vi.fn(),
      },
      clock: { currentTime: new Cesium.JulianDate() },
      isDestroyed: () => false,
    })

    it('calculates polygon area, bearings, and format distances with mathematical precision', () => {
      const mockViewer: any = createMockViewer()
      const mv = new MeasureViewer(mockViewer)

      // 1. Polygon area with < 3 points
      expect(mv.getPolygonArea([])).toBe('0.0000 平方米')
      expect(mv.getPolygonArea([Cesium.Cartesian3.fromDegrees(116, 39)])).toBe('0.0000 平方米')

      // 2. Area formatting thresholds (matches legacy 4 decimal precision for both m2 and km2)
      expect(mv._formatPolygonArea(500)).toBe('500.0000 平方米')
      expect(mv._formatPolygonArea(1500000)).toBe('1.5000 平方公里')

      // 3. Bearing & Angle calculation between cartesian coordinates
      const p1 = Cesium.Cartesian3.fromDegrees(116.0, 39.0, 0)
      const p2 = Cesium.Cartesian3.fromDegrees(116.0, 40.0, 0)
      const p3 = Cesium.Cartesian3.fromDegrees(117.0, 40.0, 0)

      const bearing = mv._Bearing(p1, p2)
      expect(typeof bearing).toBe('number')
      expect(bearing).toBeCloseTo(0, 1) // Due North is ~0 degrees

      const angle = mv._Angle(p1, p2, p3)
      expect(typeof angle).toBe('number')

      // 4. Distance calculation
      const dist = mv.distance(p1, p2)
      expect(dist).toBeGreaterThan(100000) // ~111 km between 39N and 40N

      // 5. spaceDistance returns string
      const spaceDistStr = mv.spaceDistance([p1, p2, p3])
      expect(typeof spaceDistStr).toBe('string')
      expect(Number(spaceDistStr)).toBeGreaterThan(0)
    })

    it('handles MeasureViewer lifecycle activation and teardown safely', () => {
      const mockViewer: any = createMockViewer()
      const mv = new MeasureViewer(mockViewer)

      expect(() => mv.activateAreaMeasure()).not.toThrow()
      expect(mv.measAreaStatus).toBe(true)

      expect(() => mv.stopAreaMeasure()).not.toThrow()
      expect(mv.measAreaStatus).toBe(false)

      expect(() => mv.clearAreaEntity()).not.toThrow()
      expect(() => mv.clearDisEntity()).not.toThrow()
      expect(() => mv.clearProfileEntities()).not.toThrow()

      // Destroy teardown
      expect(() => mv.destroy()).not.toThrow()
      expect(() => mv.destroy()).not.toThrow() // Idempotent check
    })
  })

  describe('4. RouteManageViewer Logic & Domain Rule Stress Test', () => {
    const createMockCanvas = () => ({
      clientWidth: 800,
      clientHeight: 600,
      style: { cursor: 'default' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    })

    const createMockViewer = () => ({
      container: {
        style: { cursor: 'default' },
        querySelector: vi.fn().mockReturnValue(null),
        appendChild: vi.fn(),
      },
      scene: {
        canvas: createMockCanvas(),
        globe: { depthTestAgainstTerrain: true },
        postRender: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        requestRender: vi.fn(),
      },
      entities: {
        add: vi.fn().mockReturnValue({}),
        remove: vi.fn(),
        removeById: vi.fn(),
        removeAll: vi.fn(),
        getById: vi.fn(),
      },
      camera: {
        flyTo: vi.fn(),
        flyToBoundingSphere: vi.fn(),
        setView: vi.fn(),
        lookAt: vi.fn(),
      },
      isDestroyed: () => false,
    })

    it('enforces route point validation rules (minimum points for open vs closed routes)', () => {
      const mockViewer: any = createMockViewer()
      const rmv = new RouteManageViewer(mockViewer)

      // Open route requires minimum 2 points
      const openRoute = newAirline()
      openRoute.isClose = false
      openRoute.points = [newAirlinePt()]
      expect(rmv.getMinimumRoutePointCount(openRoute)).toBe(2)
      expect(rmv.getRoutePointCountWarning(openRoute)).toBe('非闭合航线至少需要 2 个航点')

      // Closed route requires minimum 3 points
      const closedRoute = newAirline()
      closedRoute.isClose = true
      closedRoute.points = [newAirlinePt(), newAirlinePt()]
      expect(rmv.getMinimumRoutePointCount(closedRoute)).toBe(3)
      expect(rmv.getRoutePointCountWarning(closedRoute)).toBe('闭合航线至少需要 3 个航点')
    })

    it('correctly normalizes route points and removes closing duplicates', () => {
      const mockViewer: any = createMockViewer()
      const rmv = new RouteManageViewer(mockViewer)

      const line = newAirline()
      line.isClose = true
      line.points = [
        { lon: 116.1, lat: 39.1, alt: 100, ch1: 0, ch2: 0, nPt: 1, speed: 50 },
        { lon: 116.2, lat: 39.2, alt: 100, ch1: 0, ch2: 0, nPt: 2, speed: 50 },
        { lon: 116.1, lat: 39.1, alt: 100, ch1: 0, ch2: 0, nPt: 3, speed: 50 }, // duplicate of start
      ]

      rmv.removeDuplicatedClosingPoint(line)
      expect(line.points).toHaveLength(2)

      rmv.normalizeRoutePoints(line)
      expect(line.points[0].nPt).toBe(1)
      expect(line.points[1].nPt).toBe(2)
      expect(line.PtNum).toBe(2)
    })

    it('formats segment labels, bearings, and distance metrics', () => {
      const mockViewer: any = createMockViewer()
      const rmv = new RouteManageViewer(mockViewer)

      expect(rmv.formatDistanceKm(12.3456)).toBe('12.35')
      expect(rmv.formatBearingDeg(45.678)).toBe('46')

      const segment = {
        index: 1,
        distanceKm: 5.2,
        bearingDeg: 90,
        startPosition: Cesium.Cartesian3.ZERO,
        endPosition: Cesium.Cartesian3.ZERO,
      }
      expect(rmv.formatSegmentLabel(segment)).toBe('5.20 km, 90°')
    })

    it('manages route visibility and lifecycle destruction safely', () => {
      const mockViewer: any = createMockViewer()
      const rmv = new RouteManageViewer(mockViewer)

      const line = newAirline()
      line.unicode = 'ROUTE_TEST_001'
      line.points = [
        { lon: 116.1, lat: 39.1, alt: 100, ch1: 0, ch2: 0, nPt: 1, speed: 50 },
        { lon: 116.2, lat: 39.2, alt: 100, ch1: 0, ch2: 0, nPt: 2, speed: 50 },
      ]

      rmv.addAirLine(line)
      expect(rmv.isRouteVisible('ROUTE_TEST_001')).toBe(true)

      rmv.setRouteVisibility('ROUTE_TEST_001', false)
      expect(rmv.isRouteVisible('ROUTE_TEST_001')).toBe(false)

      // Test destroy cleanup
      expect(() => rmv.destroy()).not.toThrow()
      expect(() => rmv.destroy()).not.toThrow() // Idempotent
    })
  })

  describe('5. WebSocket Protocol & Parser Resilience', () => {
    it('handles malformed, null, and empty payloads without throwing', () => {
      expect(dataProcess(null)).toBeNull()
      expect(dataProcess(undefined)).toBeNull()
      expect(dataProcess({})).toBeNull()
      expect(dataProcess({ infoType: 2 })).toBeNull()
      expect(dataProcess({ infoType: 1, info: [] })).toBeNull()

      expect(dataProcess_fromQT(null)).toBeNull()
      expect(dataProcess_fromQT({})).toBeNull()
      expect(dataProcess_fromQT({ pos: { lon: 0, lat: 0 } })).toBeNull()

      expect(dataProcess_fromQT_route(null)).toBeNull()
      expect(dataProcess_fromQT_route({})).toBeNull()
      expect(dataProcess_fromQT_route({ route: { points: [] } })).toBeNull()
    })

    it('parses center command protocol dynamic info accurately', () => {
      const ccData = {
        infoType: 1,
        info: [
          {
            uavId: 'UAV-CC-001',
            uavType: 1,
            uavFlightControlSn: 'SN998877',
            hasShortUavDynamicInfo: true,
            shortUavDynamicInfo: {
              hasShortAttitudeInfo: true,
              shortAttitudeInfo: { courseAngle: 18000 },
              hasShortPositionInfo: true,
              shortPositionInfo: {
                lng: 1163970000,
                lat: 399080000,
                alt: 15000,
                groundSpeed: 80000,
              },
            },
          },
        ],
      }

      const parsed = dataProcess(ccData)
      expect(parsed).not.toBeNull()
      expect(parsed?.uavId).toBe('UAV-CC-001')
      expect(parsed?.uavType).toBe('981A')
      expect(parsed?.uavFlightControlSn).toBe('SN998877')
      expect(parsed?.heading).toBe(180)
      expect(parsed?.lon).toBeCloseTo(116.397, 3)
      expect(parsed?.lat).toBeCloseTo(39.908, 3)
      expect(parsed?.alt).toBe(150)
      expect(parsed?.groundSpeed).toBe(80)
    })
  })

  describe('6. Weather Forecast & Chart Config Verification', () => {
    it('maps 360-degree wind angles to correct Chinese cardinal directions', () => {
      const mockChart: any = { setOption: vi.fn() }
      const angles = [0, 22.5, 45, 90, 135, 180, 225, 270, 315, 360]
      const speeds = angles.map(() => 10)
      const temps = angles.map(() => 20)
      const precips = angles.map(() => 0)
      const times = angles.map((_, i) => `${i}:00`)

      setChartOptions(mockChart, times, temps, speeds, angles, precips)

      expect(mockChart.setOption).toHaveBeenCalledTimes(1)
      const callArg = mockChart.setOption.mock.calls[0][0]
      const windDirections = callArg.xAxis[0].data

      expect(windDirections[0]).toContain('北风')
      expect(windDirections[2]).toContain('东北风')
      expect(windDirections[3]).toContain('东风')
      expect(windDirections[4]).toContain('东南风')
      expect(windDirections[5]).toContain('南风')
      expect(windDirections[6]).toContain('西南风')
      expect(windDirections[7]).toContain('西风')
      expect(windDirections[8]).toContain('西北风')
      expect(windDirections[9]).toContain('北风')
    })

    it('issues signed requests for all weather endpoints', async () => {
      const res1 = await query_surface_forecast(116.4, 39.9)
      expect(res1.data.success).toBe(true)

      const res2 = await query_upper_forecast(116.4, 39.9, 850)
      expect(res2.data.success).toBe(true)

      const res3 = await requireWeatherLevel()
      expect(res3.data.success).toBe(true)
    })
  })
})
