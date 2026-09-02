import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { isReactive, nextTick, reactive, watch } from 'vue'
import { useLayerStore } from '@/store/layerManagerStore'
import { useUavStore } from '@/store/uavStore'
import { useTelemetryStore, type UavTelemetry } from '@/store/useTelemetryStore'
import {
  drawEchartsProfileAnalyse,
  drawEchartsVisibility,
  disposeProfileEChart,
} from '@/utils/map/SpatialAnalysis'
import { useMarkObstacle } from '@/hooks/useMarkObstacle'
import { useLoadPlane } from '@/hooks/useLoadPlane'
import { initViewer, perfViewer } from '@/utils/map/sceneViewer'

// Mock DOM
const domNodes = new Map<string, any>()
const mockDoc: any = {
  createElement: vi.fn((tag: string) => {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      id: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      appendChild: vi.fn(),
      remove: vi.fn(),
    }
    return el
  }),
  getElementById: vi.fn((id: string) => {
    return domNodes.get(id) ?? { id, style: {} }
  }),
  body: {
    appendChild: vi.fn((node: any) => {
      if (node.id) domNodes.set(node.id, node)
    }),
  },
}

const mockWin: any = {
  devicePixelRatio: 2,
  setInterval: vi.fn((cb: any, ms: number) => 101 as any),
  clearInterval: vi.fn(),
  setTimeout: vi.fn((cb: any, ms: number) => 202 as any),
  clearTimeout: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  requestAnimationFrame: vi.fn((cb: any) => cb()),
  document: mockDoc,
  navigator: { onLine: true, connection: { downlink: 10 } },
}

vi.stubGlobal('document', mockDoc)
vi.stubGlobal('window', mockWin)

const mocks = vi.hoisted(() => {
  let chartDisposeCalls = 0
  let chartSetOptionCalls = 0
  let activeChart: any = null
  return {
    getDisposeCalls: () => chartDisposeCalls,
    getSetOptionCalls: () => chartSetOptionCalls,
    reset: () => {
      chartDisposeCalls = 0
      chartSetOptionCalls = 0
      activeChart = null
    },
    mockInit: vi.fn((dom: any) => {
      activeChart = {
        setOption: vi.fn(() => {
          chartSetOptionCalls++
        }),
        dispose: vi.fn(() => {
          chartDisposeCalls++
          activeChart = null
        }),
      }
      return activeChart
    }),
    mockGetInstanceByDom: vi.fn((dom: any) => activeChart),
  }
})

vi.mock('echarts', () => ({
  init: (...args: any[]) => mocks.mockInit(...args),
  getInstanceByDom: (...args: any[]) => mocks.mockGetInstanceByDom(...args),
}))

vi.mock('cesium-navigation-es6', () => ({ default: vi.fn() }))
vi.mock('./TDTProvider', () => ({
  Geocoder: vi.fn(),
  getTDTProvider: vi.fn(() => ({})),
  searchTDTPlaces: vi.fn(),
  TDTLayerType: { Img: 'img', Cia: 'cia' },
  TDTProjectionType: { WebMercator: 'webMercator' },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('cesium', () => {
  class MockCesiumViewer {
    scene: any
    cesiumWidget: any
    entities: any
    resolutionScale = 1
    geocoder = { viewModel: { flightDuration: 0 } }
    container = mockDoc.createElement('div')
    constructor(container: any, public options: any = {}) {
      this.scene = {
        globe: {
          tileCacheSize: 0,
          depthTestAgainstTerrain: false,
          showGroundAtmosphere: false,
        },
        screenSpaceCameraController: {
          inertiaZoom: 0,
          minimumZoomDistance: 0,
          maximumZoomDistance: 0,
        },
        preRender: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        preUpdate: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        postProcessStages: { fxaa: { enabled: false } },
        moon: { show: true },
        sun: { show: true },
        skyBox: { show: true },
        fog: { enabled: true },
        requestRenderMode: options.requestRenderMode ?? false,
        requestRender: vi.fn(),
        canvas: mockDoc.createElement('canvas'),
        primitives: {
          add: vi.fn(),
          remove: vi.fn(),
        },
        pick: vi.fn(),
      }
      this.cesiumWidget = {
        creditContainer: mockDoc.createElement('div'),
        screenSpaceEventHandler: {
          removeInputAction: vi.fn(),
        },
      }
      this.entities = {
        add: vi.fn((e: any) => e),
        remove: vi.fn(),
        contains: vi.fn().mockReturnValue(true),
        suspendEvents: vi.fn(),
        resumeEvents: vi.fn(),
      }
    }
  }

  class MockHandler {
    private destroyed = false
    constructor(public canvas?: any) {}
    setInputAction = vi.fn()
    removeInputAction = vi.fn()
    destroy() {
      this.destroyed = true
    }
    isDestroyed() {
      return this.destroyed
    }
  }

  class MockCartesian3 {
    public x: number
    public y: number
    public z: number
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    static ZERO = new MockCartesian3(0, 0, 0)
    static fromDegrees = vi.fn((lon: number, lat: number, alt = 0) => new MockCartesian3(lon, lat, alt))
    static fromArray = vi.fn((arr: number[]) => new MockCartesian3(arr[0], arr[1], arr[2]))
    static multiplyByScalar = vi.fn((v: MockCartesian3, s: number, result: MockCartesian3) => {
      result.x = v.x * s
      result.y = v.y * s
      result.z = v.z * s
      return result
    })
    static add = vi.fn((a: MockCartesian3, b: MockCartesian3, result: MockCartesian3) => {
      result.x = a.x + b.x
      result.y = a.y + b.y
      result.z = a.z + b.z
      return result
    })
    static equalsEpsilon = vi.fn().mockReturnValue(false)
  }

  return {
    Viewer: MockCesiumViewer,
    TileMapServiceImageryProvider: {
      fromUrl: vi.fn().mockResolvedValue({}),
    },
    ScreenSpaceEventHandler: MockHandler,
    ScreenSpaceEventType: {
      LEFT_CLICK: 0,
      LEFT_DOUBLE_CLICK: 1,
      MOUSE_MOVE: 2,
    },
    SceneMode: { SCENE3D: 3 },
    Rectangle: { fromDegrees: vi.fn() },
    Cartesian3: MockCartesian3,
    Cartesian2: vi.fn(),
    Color: {
      WHITE: 'white',
      BLACK: { withAlpha: vi.fn() },
      YELLOW: 'yellow',
      RED: { withAlpha: vi.fn() },
      CYAN: { withAlpha: vi.fn() },
    },
    LabelStyle: { FILL_AND_OUTLINE: 1 },
    HeightReference: { CLAMP_TO_GROUND: 1 },
    DistanceDisplayCondition: vi.fn(),
    NearFarScalar: vi.fn(),
    HorizontalOrigin: { CENTER: 0 },
    VerticalOrigin: { BOTTOM: 1 },
    CallbackProperty: vi.fn((cb: any) => cb),
    Math: {
      toRadians: (d: number) => (d * Math.PI) / 180,
      toDegrees: (r: number) => (r * 180) / Math.PI,
      EPSILON7: 1e-7,
    },
    Ellipsoid: {
      WGS84: {
        geodeticSurfaceNormal: vi.fn(() => new MockCartesian3(0, 0, 1)),
      },
    },
    HeadingPitchRoll: vi.fn(),
    Transforms: {
      headingPitchRollToFixedFrame: vi.fn(),
      eastNorthUpToFixedFrame: vi.fn(),
    },
    Matrix4: { multiplyByPoint: vi.fn() },
    Cartographic: {
      fromCartesian: vi.fn(() => ({ longitude: 1.5, latitude: 0.5 })),
    },
    Model: {
      fromGltfAsync: vi.fn().mockResolvedValue({
        modelMatrix: null,
      }),
    },
    ColorBlendMode: { MIX: 0 },
    RequestScheduler: {
      maximumRequestsPerServer: 4,
      throttleRequests: false,
    },
    GeocodeType: { SEARCH: 1, AUTOCOMPLETE: 2 },
    IonGeocoderService: vi.fn(),
    buildModuleUrl: vi.fn((p: string) => p),
    createWorldImageryAsync: vi.fn().mockResolvedValue({}),
    IonWorldImageryStyle: { AERIAL: 1 },
    ProviderViewModel: vi.fn(),
    UrlTemplateImageryProvider: vi.fn(),
    GeographicTilingScheme: vi.fn(),
  }
})

describe('EMPIRICAL CHALLENGER: Milestone 5 Adversarial Verification Suite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    domNodes.clear()
    mocks.reset()
  })

  describe('1. Pinia markRaw & Deep Proxy Isolation Stress Test', () => {
    it('guarantees that circular and massive WebGL-like objects are NEVER deep-proxied by Pinia', () => {
      const store = useLayerStore()

      // 构造包含深度循环引用与大量字段的复杂原生对象
      const cyclicNativeObject: any = {
        glContext: { canvas: {}, id: 'webgl2' },
        subNodes: [],
      }
      cyclicNativeObject.self = cyclicNativeObject
      for (let i = 0; i < 500; i++) {
        cyclicNativeObject.subNodes.push({ index: i, parent: cyclicNativeObject })
      }

      store.addLayer(
        '复杂图层',
        cyclicNativeObject,
        cyclicNativeObject,
        [cyclicNativeObject],
        true,
        cyclicNativeObject,
      )

      expect(store.Layers.length).toBe(1)
      const layer = store.Layers[0]

      // 验证原生对象被标记了 __v_skip
      expect((layer.dataSource as any).__v_skip).toBe(true)
      expect((layer.imageLayer as any).__v_skip).toBe(true)
      expect((layer.tileset as any).__v_skip).toBe(true)
      expect((layer.entity as any).__v_skip).toBe(true)

      // 验证在 Vue reactive 作用下，内部对象依然保持非 reactive 状态
      const stateProxy = reactive({ layers: store.Layers })
      expect(isReactive(stateProxy.layers[0].dataSource)).toBe(false)
      expect(isReactive(stateProxy.layers[0].dataSource.glContext)).toBe(false)
      expect(isReactive(stateProxy.layers[0].dataSource.subNodes[0])).toBe(false)
    })

    it('ensures high-frequency shallowRef store updates trigger sync & async watchers accurately', async () => {
      const telemetryStore = useTelemetryStore()
      const { telemetry } = storeToRefs(telemetryStore)

      let syncTriggerCount = 0
      let asyncTriggerCount = 0
      let latestSyncAlt = 0
      let latestAsyncAlt = 0

      // 同步 watcher：每次触发
      watch(
        telemetry,
        (val) => {
          if (val) {
            syncTriggerCount++
            latestSyncAlt = val.altitude
          }
        },
        { flush: 'sync' },
      )

      // 异步 watcher：微任务合并调度
      watch(
        telemetry,
        (val) => {
          if (val) {
            asyncTriggerCount++
            latestAsyncAlt = val.altitude
          }
        },
      )

      // 模拟 100 帧高频更新
      for (let i = 1; i <= 100; i++) {
        const frame: UavTelemetry = {
          timestamp: 100000 + i,
          longitude: 110.0 + i * 0.0001,
          latitude: 20.0 + i * 0.0001,
          altitude: 100 + i,
          heading: (i * 5) % 360,
          pitch: 0,
          roll: 0,
          yaw: 0,
          groundSpeed: 30,
          verticalSpeed: 0,
          battery: 95,
          gpsSatellites: 16,
          flightMode: 'AUTO',
          armed: true,
        }
        telemetryStore.updateTelemetry(frame)
      }

      // 同步 watcher 接收到全部 100 次通知
      expect(syncTriggerCount).toBe(100)
      expect(latestSyncAlt).toBe(200)

      // 等待微任务 flush
      await nextTick()

      // 异步 watcher 成功合并并接收到最新一帧数据
      expect(asyncTriggerCount).toBe(1)
      expect(latestAsyncAlt).toBe(200)
      expect(telemetry.value?.altitude).toBe(200)
    })
  })

  describe('2. Cesium On-Demand Render Mode & Cycle Verification', () => {
    it('verifies that all mutation points in useLoadPlane consistently trigger requestRender', async () => {
      const loadPlane = useLoadPlane()
      const uavStore = useUavStore()

      const mockViewer: any = {
        scene: {
          requestRenderMode: true,
          requestRender: vi.fn(),
          preUpdate: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
          primitives: {
            add: vi.fn(),
            remove: vi.fn(),
          },
        },
        entities: {
          add: vi.fn((e: any) => e),
          remove: vi.fn(),
        },
      }

      loadPlane.init(mockViewer)
      expect(mockViewer.scene.requestRender).toHaveBeenCalled()

      const initialCallCount = mockViewer.scene.requestRender.mock.calls.length

      // 模拟收到单架飞机数据
      uavStore.updateUavInfoList([
        {
          uavSeries: '981A',
          uavId: 101,
          longitude: 110.1,
          latitude: 20.1,
          altitude: 500,
          relativeAltitude: 300,
          groundSpeed: 25,
          groundSpeedDirection: 90,
          verticalSpeed: 0,
          airspeed: 25,
          trueAirspeed: 25,
          pitchAngle: 0,
          rollAngle: 0,
          headingAngle: 90,
          currentRouteId: 1,
          nextRouteId: 1,
          nextPoint: 2,
          distanceNext: 3000,
        },
      ])

      // 等待 Vue watcher 异步执行
      await nextTick()

      // 验证收到数据触发了 requestRender
      expect(mockViewer.scene.requestRender.mock.calls.length).toBeGreaterThan(
        initialCallCount,
      )

      // 清理
      loadPlane.clearAll(mockViewer)
      expect(mockViewer.scene.preUpdate.removeEventListener).toHaveBeenCalled()
    })
  })

  describe('3. Lifecycle Cleanups, Idempotency & Zero Error Defense', () => {
    it('verifies disposeProfileEChart is completely idempotent and safe against non-existent DOM', () => {
      // 1. DOM 不存在时调用
      expect(() => disposeProfileEChart()).not.toThrow()

      // 2. DOM 存在但无 chart 时调用
      const dom = mockDoc.createElement('div')
      dom.id = 'profileEChart'
      mockDoc.body.appendChild(dom)
      expect(() => disposeProfileEChart()).not.toThrow()

      // 3. 创建图表后连续多次调用销毁
      drawEchartsProfileAnalyse([0, 10], [100, 200])
      expect(mocks.getSetOptionCalls()).toBe(1)

      disposeProfileEChart()
      expect(mocks.getDisposeCalls()).toBe(1)

      // 再次销毁应静默跳过，绝不报错
      expect(() => disposeProfileEChart()).not.toThrow()
      expect(mocks.getDisposeCalls()).toBe(1)
    })

    it('verifies useMarkObstacle.destroy behavior when window.viewer is initialized', () => {
      const mockViewer: any = {
        scene: {
          canvas: mockDoc.createElement('canvas'),
          pick: vi.fn(),
          requestRender: vi.fn(),
        },
        entities: {
          add: vi.fn((e: any) => e),
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(true),
          suspendEvents: vi.fn(),
          resumeEvents: vi.fn(),
        },
        _element: { style: { cursor: 'default' } },
        isDestroyed: () => false,
      }
      mockWin.viewer = mockViewer

      const obstacle = useMarkObstacle()
      expect(() => obstacle.destroy()).not.toThrow()
      expect(() => obstacle.destroy()).not.toThrow()
    })
  })
})
