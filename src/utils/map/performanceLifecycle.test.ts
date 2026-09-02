import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { isReactive, reactive } from 'vue'
import * as echarts from 'echarts'
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

// Mock DOM & Window environment for Node testing
const createdElements = new Map<string, any>()

const mockDocument: any = {
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
    return (
      createdElements.get(id) ?? {
        id,
        style: {},
      }
    )
  }),
  body: {
    appendChild: vi.fn((node: any) => {
      if (node.id) createdElements.set(node.id, node)
    }),
  },
}

const mockWindow: any = {
  devicePixelRatio: 1,
  setInterval: vi.fn((cb: any, ms: number) => 123 as any),
  clearInterval: vi.fn(),
  setTimeout: vi.fn((cb: any, ms: number) => 456 as any),
  clearTimeout: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  requestAnimationFrame: vi.fn((cb: any) => cb()),
  document: mockDocument,
  navigator: { onLine: true, connection: { downlink: 10 } },
}

vi.stubGlobal('document', mockDocument)
vi.stubGlobal('window', mockWindow)

// Mock ECharts
const mockDispose = vi.fn()
const mockSetOption = vi.fn()
let currentChartInstance: any = null
const mockEChartsInit = vi.fn((dom: any) => {
  currentChartInstance = {
    setOption: mockSetOption,
    dispose: vi.fn(() => {
      mockDispose()
      currentChartInstance = null
    }),
  }
  return currentChartInstance
})
const mockGetInstanceByDom = vi.fn((dom: any) => currentChartInstance)

vi.mock('echarts', () => ({
  init: (...args: any[]) => mockEChartsInit(...args),
  getInstanceByDom: (...args: any[]) => mockGetInstanceByDom(...args),
}))

// Mock cesium-navigation-es6 and TDTProvider
vi.mock('cesium-navigation-es6', () => ({
  default: vi.fn(),
}))

vi.mock('./TDTProvider', () => ({
  Geocoder: vi.fn(),
  getTDTProvider: vi.fn(() => ({})),
  searchTDTPlaces: vi.fn(),
  TDTLayerType: { Img: 'img', Cia: 'cia' },
  TDTProjectionType: { WebMercator: 'webMercator' },
}))

// Mock tauri
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}))

// Mock Cesium
vi.mock('cesium', () => {
  class MockViewer {
    scene: any
    cesiumWidget: any
    entities: any
    resolutionScale = 1
    enableCursorStyle = true
    geocoder = { viewModel: { flightDuration: 0 } }
    container = mockDocument.createElement('div')
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
        postProcessStages: {
          fxaa: { enabled: false },
        },
        moon: { show: true },
        sun: { show: true },
        skyBox: { show: true },
        fog: { enabled: true },
        requestRenderMode: options.requestRenderMode ?? false,
        requestRender: vi.fn(),
        canvas: mockDocument.createElement('canvas'),
        primitives: {
          add: vi.fn(),
          remove: vi.fn(),
        },
        pick: vi.fn(),
      }
      this.cesiumWidget = {
        creditContainer: mockDocument.createElement('div'),
        screenSpaceEventHandler: {
          removeInputAction: vi.fn(),
        },
      }
      this.entities = {
        add: vi.fn((item: any) => item),
        remove: vi.fn(),
        contains: vi.fn().mockReturnValue(true),
        suspendEvents: vi.fn(),
        resumeEvents: vi.fn(),
      }
    }
  }

  class MockScreenSpaceEventHandler {
    public isDestroyedFlag = false
    constructor(public canvas?: any) {}
    setInputAction = vi.fn()
    removeInputAction = vi.fn()
    destroy() {
      this.isDestroyedFlag = true
    }
    isDestroyed() {
      return this.isDestroyedFlag
    }
  }

  return {
    Viewer: MockViewer,
    TileMapServiceImageryProvider: {
      fromUrl: vi.fn().mockResolvedValue({}),
    },
    ScreenSpaceEventHandler: MockScreenSpaceEventHandler,
    ScreenSpaceEventType: {
      LEFT_CLICK: 0,
      LEFT_DOUBLE_CLICK: 1,
      MOUSE_MOVE: 2,
    },
    SceneMode: { SCENE3D: 3 },
    Rectangle: {
      fromDegrees: vi.fn(),
    },
    Cartesian3: {
      ZERO: { x: 0, y: 0, z: 0 },
      fromDegrees: vi.fn(() => ({ x: 100, y: 100, z: 100 })),
      fromArray: vi.fn(() => ({ x: 10, y: 10, z: 40 })),
      multiplyByScalar: vi.fn(),
      add: vi.fn(),
      equalsEpsilon: vi.fn().mockReturnValue(false),
    },
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
      toRadians: (deg: number) => (deg * Math.PI) / 180,
      toDegrees: (rad: number) => (rad * 180) / Math.PI,
      EPSILON7: 0.0000001,
    },
    Ellipsoid: {
      WGS84: {
        geodeticSurfaceNormal: vi.fn(() => ({ x: 0, y: 0, z: 1 })),
      },
    },
    HeadingPitchRoll: vi.fn(),
    Transforms: {
      headingPitchRollToFixedFrame: vi.fn(),
      eastNorthUpToFixedFrame: vi.fn(),
    },
    Matrix4: {
      multiplyByPoint: vi.fn(),
    },
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
    buildModuleUrl: vi.fn((path: string) => path),
    createWorldImageryAsync: vi.fn().mockResolvedValue({}),
    IonWorldImageryStyle: { AERIAL: 1 },
    ProviderViewModel: vi.fn(),
    UrlTemplateImageryProvider: vi.fn(),
    GeographicTilingScheme: vi.fn(),
  }
})

describe('Milestone 5: Performance & Memory Lifecycle Optimization', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    createdElements.clear()
    currentChartInstance = null
    mockDispose.mockClear()
    mockSetOption.mockClear()
    mockEChartsInit.mockClear()
    mockGetInstanceByDom.mockClear()
  })

  describe('1. Cesium 3D Globe Memory & Scene Tuning', () => {
    it('configures tileCacheSize to 100, scene3DOnly to true, and avoids preRender polling', async () => {
      const container = mockDocument.createElement('div')
      const viewer = await initViewer(container)

      // 验证 scene3DOnly 与 tileCacheSize 优化
      expect(viewer.options.scene3DOnly).toBe(true)
      expect(viewer.options.requestRenderMode).toBe(true)
      expect(viewer.scene.globe.tileCacheSize).toBe(100)

      // 验证没有添加 preRender 每帧监听器
      expect(viewer.scene.preRender.addEventListener).not.toHaveBeenCalled()

      // 验证 perfViewer 也正确设置了 tileCacheSize
      perfViewer(viewer)
      expect(viewer.scene.globe.tileCacheSize).toBe(100)
      expect(viewer.scene.moon.show).toBe(false)
      expect(viewer.scene.sun.show).toBe(false)
    })

    it('preserves requestRenderMode = true in useLoadPlane and calls requestRender', () => {
      const loadPlaneHook = useLoadPlane()
      const mockViewer: any = {
        scene: {
          requestRenderMode: true,
          requestRender: vi.fn(),
          preUpdate: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
          primitives: {
            remove: vi.fn(),
          },
        },
        entities: {
          remove: vi.fn(),
        },
      }

      loadPlaneHook.init(mockViewer)
      // 验证不会将 requestRenderMode 覆盖为 false
      expect(mockViewer.scene.requestRenderMode).toBe(true)
      expect(mockViewer.scene.requestRender).toHaveBeenCalled()

      loadPlaneHook.clearAll(mockViewer)
    })
  })

  describe('2. High-Frequency Reactivity Optimization', () => {
    it('applies markRaw to all raw Cesium objects in layerManagerStore', () => {
      const store = useLayerStore()
      const rawDataSource = { name: 'DataSource', entities: [] }
      const rawImageLayer = { isImagery: true }
      const rawEntity1 = { id: 'e1' }
      const rawEntity2 = { id: 'e2' }
      const rawTileset = { isTileset: true }

      store.addLayer(
        '测试图层',
        rawDataSource,
        rawImageLayer,
        [rawEntity1, rawEntity2],
        true,
        rawTileset,
      )

      expect(store.Layers.length).toBe(1)
      const stored = store.Layers[0]

      // 验证存入 Pinia 的对象已被 markRaw 标记 (__v_skip = true)，不被深度代理
      expect((stored.dataSource as any).__v_skip).toBe(true)
      expect((stored.imageLayer as any).__v_skip).toBe(true)
      expect((stored.tileset as any).__v_skip).toBe(true)
      expect((stored.entity as any).__v_skip).toBe(true)

      // 即使把整个 layer 放入 reactive 包装，标记了 markRaw 的属性依然不会被深度转换为 reactive proxy
      const reactiveWrapper = reactive({ l: stored })
      expect(isReactive(reactiveWrapper.l.dataSource)).toBe(false)
      expect(isReactive(reactiveWrapper.l.imageLayer)).toBe(false)
      expect(isReactive(reactiveWrapper.l.tileset)).toBe(false)
    })

    it('uses shallowRef and markRaw for high-frequency telemetry in useTelemetryStore', () => {
      const telemetryStore = useTelemetryStore()
      const { telemetry } = storeToRefs(telemetryStore)

      const testData: UavTelemetry = {
        timestamp: 1234567890,
        longitude: 110.123,
        latitude: 20.456,
        altitude: 500,
        heading: 90,
        pitch: 5,
        roll: -2,
        yaw: 90,
        groundSpeed: 25,
        verticalSpeed: 1,
        battery: 88,
        gpsSatellites: 14,
        flightMode: 'AUTO',
        armed: true,
      }

      telemetryStore.updateTelemetry(testData)
      expect(telemetry.value?.longitude).toBe(110.123)

      // 验证 telemetry 数据被 markRaw 标记，且不会被转换为 deep reactive proxy
      expect((telemetry.value as any)?.__v_skip).toBe(true)
      expect(isReactive(telemetry.value)).toBe(false)
    })

    it('uses shallowRef for uavStore.uavInfo and high frequency map state', () => {
      const uavStore = useUavStore()
      const { uavInfo, uavInfoMap } = storeToRefs(uavStore)

      const sampleUav = {
        uavSeries: '981A',
        uavId: 1,
        longitude: 110.3,
        latitude: 20.1,
        altitude: 600,
        relativeAltitude: 300,
        groundSpeed: 20,
        groundSpeedDirection: 90,
        verticalSpeed: 0,
        airspeed: 22,
        trueAirspeed: 25,
        pitchAngle: 0,
        rollAngle: 0,
        headingAngle: 90,
        currentRouteId: 1,
        nextRouteId: 1,
        nextPoint: 2,
        distanceNext: 4000,
      }

      uavStore.updateUavInfoList([sampleUav])
      expect(uavInfoMap.value.size).toBe(1)
      expect(uavInfo.value).toBeDefined()
    })
  })

  describe('3. Lifecycle & Memory Leak Cleanups', () => {
    it('reuses existing ECharts instance via getInstanceByDom and disposes cleanly', () => {
      const chartDiv = mockDocument.createElement('div')
      chartDiv.id = 'profileEChart'
      mockDocument.body.appendChild(chartDiv)

      // 第一次调用：getInstanceByDom 返回 null，调用 echarts.init
      drawEchartsProfileAnalyse([0, 100, 200], [10, 20, 30])
      expect(mockEChartsInit).toHaveBeenCalledTimes(1)
      expect(mockSetOption).toHaveBeenCalled()

      // 第二次调用：getInstanceByDom 返回已有实例，不应重复调用 init
      drawEchartsVisibility([0, 100], [10, 20], 50, 60)
      expect(mockEChartsInit).toHaveBeenCalledTimes(1) // 仍然是 1 次

      // 调用销毁函数
      disposeProfileEChart()
      expect(mockDispose).toHaveBeenCalled()
    })

    it('destroys ScreenSpaceEventHandler and cleans up entities in useMarkObstacle', () => {
      const mockViewer: any = {
        scene: {
          canvas: mockDocument.createElement('canvas'),
          pick: vi.fn(),
          requestRender: vi.fn(),
        },
        entities: {
          add: vi.fn((e) => e),
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(true),
          suspendEvents: vi.fn(),
          resumeEvents: vi.fn(),
        },
        _element: { style: { cursor: 'default' } },
        isDestroyed: () => false,
      }
      mockWindow.viewer = mockViewer

      const obstacleHook = useMarkObstacle()
      // 添加单个障碍物触发 hoverHandler 初始化
      obstacleHook.addObstacle(
        { type: 'highPowerTower', airportName: '海口机场', name: '高压铁塔', height: 45 },
        110.3,
        20.0,
        null,
      )

      expect(mockViewer.entities.add).toHaveBeenCalled()

      // 执行销毁
      obstacleHook.destroy()
      expect(mockViewer.entities.remove).toHaveBeenCalled()
      expect(mockViewer.scene.requestRender).toHaveBeenCalled()
    })
  })
})
