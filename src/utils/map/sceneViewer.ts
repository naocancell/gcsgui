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
  ImageryLayer,
  RequestScheduler,
  SceneMode,
  Rectangle,
  buildModuleUrl,
} from 'cesium'
import CesiumNavigation from 'cesium-navigation-es6'

//离线地球底图
const earth_native = TileMapServiceImageryProvider.fromUrl(
  // 'node_modules/cesium/Build/CesiumUnminified/Assets/Textures/NaturalEarthII',
  // buildModuleUrl('Assets/Textures/NaturalEarthII'),
  '/Cesium/Assets/Textures/NaturalEarthII',
)
/**
 * Viewer初始化
 * @param container :id或HTML对象
 * @returns :viewer对象
 */
function initViewer(container: string | Element): Viewer {
  //未联网状态加载默认本地底图，保证地球有底图显示
  const viewer = new Viewer(container as HTMLElement, {
    infoBox: false, //是否显示点击要素之后显示的信息
    homeButton: false, //是否显示Home按钮
    navigationHelpButton: false, //是否显示帮助信息控件
    timeline: false, //是否显示时间线控件
    animation: false, //是否显示动画控件
    sceneModePicker: true, //是否显示投影方式控件
    sceneMode: SceneMode.SCENE3D, //设置场景模式，3D球体
    // terrain: Cesium.Terrain.fromWorldTerrain(),
    baseLayerPicker: false, //是否显示图层选择控件
    requestRenderMode: true, //启用请求渲染模式
    scene3DOnly: false, //每个几何实例将只能以3D渲染以节省GPU内存
    fullscreenButton: false, //右下角 全屏控件
    orderIndependentTranslucency: false,
    contextOptions: { webgl: { alpha: true } },
    maximumRenderTimeChange: Infinity, // 无操作时自动渲染帧率，设为数字会消耗性能，Infinity为无操作不渲染
    // mapProjection: new Cesium.WebMercatorProjection(),
    baseLayer: ImageryLayer.fromProviderAsync(earth_native, {}),
  })
  //去除cesium logo，隐藏版本信息
  const creditContainer = viewer.cesiumWidget.creditContainer as HTMLDivElement
  creditContainer.style.display = 'none'
  // 开启深度检测
  viewer.scene.globe.depthTestAgainstTerrain = true
  // 水雾特效
  viewer.scene.globe.showGroundAtmosphere = true
  // 设置更高的缩放惯性以使缩放操作更平滑
  viewer.scene.screenSpaceCameraController.inertiaZoom = 0.9
  // 限制相机缩放
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1 //相机的高度的最小值
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 10350000 //相机高度的最大值
  // 设置设备像素比，可能会影响渲染性能
  // viewer.resolutionScale = window.devicePixelRatio
  // 视图重绘后确保清晰度
  viewer.scene.preRender.addEventListener(function () {
    if (viewer.resolutionScale !== window.devicePixelRatio) {
      viewer.resolutionScale = window.devicePixelRatio
    }
  })
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
  // 关闭太阳，月亮，天空盒，雾等相关特效
  viewer.scene.moon.show = false
  viewer.scene.fog.enabled = false
  viewer.scene.sun.show = false
  viewer.scene.skyBox.show = false
  // 优化加载WMTS图层速度
  RequestScheduler.maximumRequestsPerServer = 18 // 设置cesium请求调度器的最大并发数量
  RequestScheduler.throttleRequests = false //关闭请求调度器的请求节流
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
