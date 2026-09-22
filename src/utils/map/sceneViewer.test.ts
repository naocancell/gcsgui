import { beforeAll, describe, expect, it, vi } from 'vitest'
import { initViewer } from './sceneViewer'

beforeAll(() => {
  if (typeof globalThis.document === 'undefined') {
    const mockDocument: any = {
      createElement: vi.fn((tag: string) => ({
        tagName: tag.toUpperCase(),
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    }
    Object.defineProperty(globalThis, 'document', {
      value: mockDocument,
      configurable: true,
      writable: true,
    })
  }
  if (typeof globalThis.window === 'undefined') {
    const mockWindow: any = {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      document: globalThis.document,
    }
    Object.defineProperty(globalThis, 'window', {
      value: mockWindow,
      configurable: true,
      writable: true,
    })
  }
})

// Mock Cesium 模块
vi.mock('cesium', () => {
  class MockViewer {
    public imageryProviderViewModels: any[]
    public selectedImageryProviderViewModel: any
    public cesiumWidget: any
    public scene: any
    public geocoder: any

    constructor(
      public container: any,
      public options: any,
    ) {
      this.imageryProviderViewModels = options.imageryProviderViewModels
      this.selectedImageryProviderViewModel =
        options.selectedImageryProviderViewModel
      this.cesiumWidget = {
        creditContainer: { style: {} },
        screenSpaceEventHandler: {
          removeInputAction: vi.fn(),
        },
      }
      this.scene = {
        globe: {},
        screenSpaceCameraController: {},
        requestRender: vi.fn(),
      }
      this.geocoder = {
        viewModel: {},
      }
    }
  }

  class MockProviderViewModel {
    public name: string
    public tooltip: string
    public category: string
    public creationFunction: () => any

    constructor(options: any) {
      this.name = options.name
      this.tooltip = options.tooltip
      this.category = options.category
      this.creationFunction = options.creationFunction
    }
  }

  return {
    Viewer: MockViewer,
    ProviderViewModel: MockProviderViewModel,
    TileMapServiceImageryProvider: {
      fromUrl: vi.fn().mockResolvedValue({}),
    },
    UrlTemplateImageryProvider: vi.fn(),
    WebMapTileServiceImageryProvider: vi.fn(),
    GeographicTilingScheme: vi.fn(),
    WebMercatorTilingScheme: vi.fn(),
    ScreenSpaceEventType: {
      LEFT_CLICK: 0,
      LEFT_DOUBLE_CLICK: 1,
    },
    SceneMode: { SCENE3D: 3 },
    Rectangle: { fromDegrees: vi.fn() },
    Cartesian3: { fromDegrees: vi.fn() },
    buildModuleUrl: vi.fn((path: string) => path),
    createWorldImageryAsync: vi.fn(),
    IonWorldImageryStyle: { AERIAL: 1 },
    IonGeocoderService: vi.fn(),
    GeocodeType: { SEARCH: 0, AUTOCOMPLETE: 1 },
  }
})

vi.mock('cesium-navigation-es6', () => {
  return {
    default: vi.fn(),
  }
})

describe('sceneViewer 初始化底图与默认选择测试', () => {
  it('应包含天地图影像与天地图地形，且默认选中的底图为天地图影像', async () => {
    const mockContainer: any = { style: {} }
    const viewer: any = await initViewer(mockContainer)

    const viewModels = viewer.imageryProviderViewModels
    expect(viewModels).toBeDefined()

    // 验证包含天地图影像和天地图地形
    const tdtImg = viewModels.find((vm: any) => vm.name === '天地图影像')
    const tdtTerrain = viewModels.find((vm: any) => vm.name === '天地图地形')
    expect(tdtImg).toBeDefined()
    expect(tdtTerrain).toBeDefined()

    // 验证默认选中的底图是天地图影像，而不是离线地图
    expect(viewer.selectedImageryProviderViewModel).toBe(tdtImg)
    expect(viewer.selectedImageryProviderViewModel.name).toBe('天地图影像')

    // 验证天地图地形 creationFunction 正常执行并返回图层
    const terrainLayers = tdtTerrain.creationFunction()
    expect(Array.isArray(terrainLayers)).toBe(true)
    expect(terrainLayers.length).toBeGreaterThanOrEqual(2)
  })
})
