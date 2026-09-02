/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-13 09:32:21
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-16 10:58:25
 * @Description:
 */
// Viewer初始化
import {
  Viewer,
  TileMapServiceImageryProvider,
  ScreenSpaceEventType,
  RequestScheduler,
  SceneMode,
  Rectangle,
  Cartesian3,
  GeocodeType,
  IonGeocoderService,
  buildModuleUrl,
  createWorldImageryAsync,
  IonWorldImageryStyle,
  ProviderViewModel,
  UrlTemplateImageryProvider,
  GeographicTilingScheme,
  ArcGisMapServerImageryProvider,
  OpenStreetMapImageryProvider
} from 'cesium'
import type { ImageryProvider, Scene } from 'cesium'
import CesiumNavigation from 'cesium-navigation-es6'
import {
  Geocoder as tdtGeocoder,
  getTDTProvider,
  searchTDTPlaces,
  TDTLayerType,
  TDTProjectionType,
} from './TDTProvider'

// 防御性保护：防止在时钟 tick 阶段因为生命周期/异步加载导致 _dataSourceDisplay 暂未就绪或已销毁时抛出异常导致红框
if (typeof Viewer !== 'undefined' && Viewer.prototype && !(Viewer.prototype as any)._safeOnTickPatched) {
  const originalOnTick = Viewer.prototype._onTick
  Viewer.prototype._onTick = function (clock: any) {
    if (!this._dataSourceDisplay || (typeof this.isDestroyed === 'function' && this.isDestroyed())) {
      return
    }
    return originalOnTick.call(this, clock)
  }
  ;(Viewer.prototype as any)._safeOnTickPatched = true
}

// 离线地球底图异步加载，带 800ms 超时回退保护
async function getLocalImageryProvider(): Promise<ImageryProvider | undefined> {
  try {
    const p = TileMapServiceImageryProvider.fromUrl(
      '/Cesium/Assets/Textures/NaturalEarthII',
    )
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 800))
    return await Promise.race([p, timeout])
  } catch {
    return undefined
  }
}

function createImageryProviderViewModels(
  localImageryProvider?: ImageryProvider,
): ProviderViewModel[] {
  const baseLayers = localImageryProvider ? [localImageryProvider] : []

  return [
    new ProviderViewModel({
      name: '天地图影像',
      tooltip: '天地图卫星影像与中文注记',
      iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/TDT.png'),
      category: '影像底图',
      creationFunction: () => [
        ...baseLayers,
        getTDTProvider(TDTLayerType.Img, TDTProjectionType.WebMercator),
        getTDTProvider(TDTLayerType.Cia, TDTProjectionType.WebMercator),
      ],
    }),
    new ProviderViewModel({
      name: 'Bing 影像',
      tooltip: 'Cesium ion 提供的 Bing 全球卫星影像',
      iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/bingAerial.png'),
      category: '影像底图',
      creationFunction: () => [
        ...baseLayers,
        getTDTProvider(TDTLayerType.Img, TDTProjectionType.WebMercator),
        getTDTProvider(TDTLayerType.Cia, TDTProjectionType.WebMercator),
      ],
    }),
    new ProviderViewModel({
      name: 'Google 影像',
      tooltip: 'Google 卫星影像（需要可访问 Google 地图服务）',
      iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/mapboxSatellite.png'),
      category: '影像底图',
      creationFunction: () => [
        ...baseLayers,
        new UrlTemplateImageryProvider({
          url: 'https://tileser.giiiis.com/timetile/0/{z}/{x}/{y}.jpg',
          minimumLevel: 0,
          maximumLevel: 20,
          tilingScheme: new GeographicTilingScheme(),
        }),
        getTDTProvider(TDTLayerType.Cia, TDTProjectionType.WebMercator),
      ],
    }),
    new ProviderViewModel({
      name: 'ArcGIS 影像',
      tooltip: 'ArcGIS 影像',
      iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/ArcGisMapServiceWorldImagery.png'),
      category: '影像底图',
      creationFunction: () => [
        ...baseLayers,
        new UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          minimumLevel: 0,
          maximumLevel: 18,
        }),
        getTDTProvider(TDTLayerType.Cia, TDTProjectionType.WebMercator),
      ],
    }),
  ]
}

/** 将天地图地理编码响应适配为 Cesium 的搜索服务接口。 */
class TiandituGeocoderService {
  private async searchPlaces(keyword: string) {
    try {
      const response = await searchTDTPlaces(keyword)
      return (response.data.pois ?? []).flatMap((poi) => {
        const [lonText, latText] = poi.lonlat.split(',')
        const lon = Number(lonText)
        const lat = Number(latText)
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return []

        return [
          {
            displayName: poi.address
              ? `${poi.name} (${poi.address})`
              : poi.name,
            destination: Cartesian3.fromDegrees(lon, lat),
          },
        ]
      })
    } catch (error) {
      console.warn('天地图地名联想失败:', error)
      return []
    }
  }

  async geocode(query: string, type: GeocodeType = GeocodeType.SEARCH) {
    const keyword = query.trim()
    if (!keyword) return []

    if (type === GeocodeType.AUTOCOMPLETE) {
      return keyword.length >= 2 ? this.searchPlaces(keyword) : []
    }

    try {
      const response = await tdtGeocoder(keyword)
      const { location, msg, status } = response.data
      const lon = Number(location?.lon)
      const lat = Number(location?.lat)

      if (status === '0' && Number.isFinite(lon) && Number.isFinite(lat)) {
        return [
          {
            displayName: location?.keyWord || keyword,
            destination: Cartesian3.fromDegrees(lon, lat),
          },
        ]
      }
      console.warn('天地图地理编码失败:', msg)
    } catch (error) {
      console.warn('天地图地理编码请求失败:', error)
    }

    return this.searchPlaces(keyword)
  }
}

/** 中文使用天地图，其余输入保持使用 Cesium 默认的 Ion 搜索。 */
class HybridGeocoderService {
  private readonly tianditu = new TiandituGeocoderService()
  private ion?: IonGeocoderService

  setScene(scene: Scene) {
    this.ion = new IonGeocoderService({ scene })
  }

  get credit() {
    return this.ion?.credit
  }

  geocode(query: string, type?: GeocodeType) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(query)) {
      return this.tianditu.geocode(query, type)
    }
    return this.ion?.geocode(query, type) ?? Promise.resolve([])
  }
}
/**
 * Viewer初始化
 * @param container :id或HTML对象
 * @returns :viewer对象
 */
async function initViewer(container: string | Element): Promise<Viewer> {
  const localImageryProvider = await getLocalImageryProvider()
  const imageryProviderViewModels =
    createImageryProviderViewModels(localImageryProvider)
  const geocoderService = new HybridGeocoderService()

  //未联网状态加载默认本地底图，保证地球有底图显示
  const viewer = new Viewer(container as HTMLElement, {
    infoBox: false, //是否显示点击要素之后显示的信息
    geocoder: [geocoderService],
    homeButton: false, //是否显示Home按钮
    navigationHelpButton: false, //是否显示帮助信息控件
    timeline: false, //是否显示时间线控件
    animation: false, //是否显示动画控件
    sceneModePicker: false, //当 scene3DOnly 为 true 时必须禁用 sceneModePicker，避免 Cesium 抛出 DeveloperError 崩溃
    sceneMode: SceneMode.SCENE3D, //设置场景模式，3D球体
    baseLayerPicker: true, //显示Cesium自带的底图选择控件
    imageryProviderViewModels,
    selectedImageryProviderViewModel: imageryProviderViewModels[0],
    terrainProviderViewModels: [],
    targetFrameRate: 60, //活动场景固定以最高 60 FPS 调度
    requestRenderMode: true, //启用请求渲染模式
    scene3DOnly: true, //每个几何实例将只能以3D渲染以节省GPU内存
    fullscreenButton: false, //右下角 全屏控件
    orderIndependentTranslucency: false,
    contextOptions: { webgl: { alpha: true } },
    maximumRenderTimeChange: 0.5, // 限制最大无操作渲染间隔为 0.5s，确保异步瓦片下载后自动刷新呈现
  })
  // 设置搜索结果定位的飞行时间，单位为秒
  viewer.geocoder.viewModel.flightDuration = 2
  geocoderService.setScene(viewer.scene)
  //去除cesium logo，隐藏版本信息
  const creditContainer = viewer.cesiumWidget.creditContainer as HTMLDivElement
  creditContainer.style.display = 'none'
  // 开启深度检测
  viewer.scene.globe.depthTestAgainstTerrain = true
  // 限制瓦片缓存大小，防止内存与显存无限膨胀
  viewer.scene.globe.tileCacheSize = 100
  // 水雾特效
  viewer.scene.globe.showGroundAtmosphere = true
  // 设置更高的缩放惯性以使缩放操作更平滑
  viewer.scene.screenSpaceCameraController.inertiaZoom = 0.3
  // 限制相机缩放
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1 //相机的高度的最小值
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 13050000 //相机高度的最大值
  // 设置设备像素比（初始化时设置一次，避免每帧 preRender 监听产生额外开销）
  const renderScale = Math.min(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    1,
  )
  viewer.resolutionScale = renderScale
  // 去掉entity的点击事件（双击、单击）
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    ScreenSpaceEventType.LEFT_CLICK,
  )
  return viewer
}

/**
 * 性能优化
 * @param viewer :场景Viewer
 */
function perfViewer(viewer: Viewer) {
  // 抗锯齿
  // 是否支持图像渲染像素化处理
  // if (Cesium.FeatureDetection.supportsImageRenderingPixelated()) {
  //   viewer.resolutionScale = window.devicePixelRatio
  // }
  viewer.scene.postProcessStages.fxaa.enabled = true
  // 限制瓦片缓存大小
  viewer.scene.globe.tileCacheSize = 100
  // 关闭太阳，月亮，天空盒，雾等相关特效
  viewer.scene.moon.show = false
  viewer.scene.fog.enabled = false
  viewer.scene.sun.show = false
  viewer.scene.skyBox.show = false
  // 优化加载WMTS图层速度
  RequestScheduler.maximumRequestsPerServer = 8 // 白膜加载时限制单服务器并发，避免请求和解析任务同时堆积
  RequestScheduler.throttleRequests = true // 让 Cesium 根据优先级调度可见瓦片
}

function showNavigator(viewer: Viewer) {
  const options: any = {}
  // 用于在使用重置导航重置地图视图时设置默认视图控制。接受的值是Cesium.Cartographic 和 Cesium.Rectangle
  options.defaultResetView = Rectangle.fromDegrees(80, 22, 130, 50)
  options.enableCompass = true //罗盘组件 true启用，false禁用
  options.enableCompassOuterRing = true //罗盘外环组件 true启用，false禁用
  options.enableZoomControls = true //缩放组件 true启用，false禁用
  options.enableDistanceLegend = true //比例尺组件 true启用，false禁用
  new CesiumNavigation(viewer, options)
}
export { initViewer, perfViewer, showNavigator }
