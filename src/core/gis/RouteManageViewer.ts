import * as Cesium from 'cesium'
import { Cartesian3 } from 'cesium'
import { noFlyZoneService, type NFZConflict } from '@/utils/map/noFlyZoneService'
import type { Airline, AirlinePoint } from '@/types/entityoptions'

export type RouteManageMode = 'idle' | 'drawing' | 'selected' | 'editing'

export interface RouteItem {
  line: Airline
  entity: Cesium.Entity
  vertexEntities: Cesium.Entity[]
  dirty: boolean
  backupPoints?: AirlinePoint[]
  editPositions?: Cesium.Cartesian3[]
  visible: boolean
}

export interface RouteVertexInfo {
  routeId: string
  vertexIndex: number
  entity?: Cesium.Entity
}

export interface DragVertexInfo extends RouteVertexInfo {
  dragPlane?: Cesium.Plane
  fixedAlt?: number
}

export interface SegmentMetrics {
  distanceKm: number
  bearingDeg: number
}

export interface SegmentLabelData {
  start: Cesium.Cartesian3
  end: Cesium.Cartesian3
  distanceKm: number
  bearingDeg: number
  totalKm?: number
}

export interface ProjectionResult {
  insertAfterIndex: number
  projectionCartesian: Cesium.Cartesian3
  t: number
}

export interface NoFlyZoneViolationEvent {
  conflict: NFZConflict
  action: string
}

export interface CameraControllerBackup {
  enableInputs: boolean
  enableRotate: boolean
  enableTranslate: boolean
  enableZoom: boolean
  enableTilt: boolean
  enableLook: boolean
}

export interface CameraViewBackup {
  destination: Cesium.Cartesian3
  heading: number
  pitch: number
  roll: number
}

/**
 * 航线管理与交互可视化类 (RouteManageViewer)
 * 负责航线的加载展示、航线绘制、航点拖拽编辑、禁飞区冲突校验、正俯视锁定以及航段距离/航向动态标签渲染
 */
export class RouteManageViewer {
  public viewer: Cesium.Viewer
  public scene: Cesium.Scene

  // 绘制航线配置参数
  public routeParams: {
    isClose: boolean
    height: number
  } = {
    isClose: false,
    height: 0,
  }

  public dragPlane?: Cesium.Plane
  public keepAltitudeOnDrag = true

  // 绘制状态临时变量
  public positions: Cesium.Cartesian3[] = []
  public temPositions: Cesium.Cartesian3[] = []
  public vertexEntities: Cesium.Entity[] = []
  public lineEntity?: Cesium.Entity
  public lineEntitys: Cesium.Entity[] = []

  public handler?: Cesium.ScreenSpaceEventHandler
  public drawResolve?: (value: [any[], Cesium.Entity[]]) => void
  public drawReject?: (reason?: any) => void
  public keydownHandler?: (event: KeyboardEvent) => void
  public preventContextMenu?: (event: MouseEvent) => void
  public drawMenuEl?: HTMLDivElement
  public drawNoFlyZoneConflict?: NFZConflict | null

  // 航线编辑状态
  public mode: RouteManageMode = 'idle'
  public routesMap: Map<string, RouteItem> = new Map()

  // 选中和编辑变量
  public selectedRouteId?: string
  public dragInfo?: DragVertexInfo
  public activeVertexInfo?: RouteVertexInfo

  public selectHandler?: Cesium.ScreenSpaceEventHandler
  public editHandler?: Cesium.ScreenSpaceEventHandler
  public editKeydownHandler?: (event: KeyboardEvent) => void
  public editPreventContextMenu?: (event: MouseEvent) => void
  public editMenuEl?: HTMLDivElement

  public cameraControllerBackup?: CameraControllerBackup

  // 外部事件回调
  public onRouteSelected?: (routeId: string, line: Airline) => void
  public onRouteChanged?: (line: Airline) => void
  public onEditStateChanged?: (editing: boolean) => void
  public onVertexSelected?: (info: RouteVertexInfo | null) => void
  public onNoFlyZoneViolation?: (event: NoFlyZoneViolationEvent) => void
  public lastNoFlyZoneWarningAt = 0

  // 航线样式
  public normalLineMaterial = Cesium.Color.ORANGE
  public selectedLineMaterial = Cesium.Color.DEEPSKYBLUE
  public editingLineMaterial = Cesium.Color.YELLOW

  // 编辑状态选中航点
  public selectedEditVertexEntity?: Cesium.Entity
  public selectedEditVertexInfo?: RouteVertexInfo

  // 航段动态标签
  public segmentLabelMaxCameraDistance = 300000
  public segmentLabelMinPixelLength = 64
  public segmentLabelLayer?: HTMLDivElement
  public routeSegmentLabelEls: Map<string, HTMLDivElement[]> = new Map()
  public drawSegmentLabelEls: HTMLDivElement[] = []

  // 编辑视角锁定
  public editViewPitch = Cesium.Math.toRadians(-89.9)
  public editViewLocked = false
  public editViewControllerBackup?: CameraControllerBackup
  public editViewCameraBackup?: CameraViewBackup

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
    this.scene = viewer.scene

    this.enableRouteSelect()

    this.updateSegmentLabels = this.updateSegmentLabels.bind(this)
    this.createSegmentLabelLayer()
    this.viewer.scene.postRender.addEventListener(this.updateSegmentLabels)

    this.enforceEditViewPitch = this.enforceEditViewPitch.bind(this)
  }

  public getMinimumRoutePointCount(route = this.routeParams): number {
    return route?.isClose ? 3 : 2
  }

  public getRoutePointCountWarning(route = this.routeParams): string {
    const minimum = this.getMinimumRoutePointCount(route)
    return `${route?.isClose ? '闭合' : '非闭合'}航线至少需要 ${minimum} 个航点`
  }

  /**
   * 进入编辑模式，锁定正俯视视角
   * @param line 航线数据
   */
  public lockEditView(line: Airline): void {
    if (this.editViewLocked) return

    const camera = this.viewer.camera
    const scene = this.viewer.scene
    const controller = scene.screenSpaceCameraController

    this.editViewControllerBackup = {
      enableInputs: controller.enableInputs,
      enableRotate: controller.enableRotate,
      enableTranslate: controller.enableTranslate,
      enableZoom: controller.enableZoom,
      enableTilt: controller.enableTilt,
      enableLook: controller.enableLook,
    }

    this.editViewCameraBackup = {
      destination: Cesium.Cartesian3.clone(camera.positionWC),
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    }

    this.editViewLocked = true
    controller.enableInputs = true
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableZoom = true
    controller.enableTilt = false
    controller.enableLook = false

    scene.postRender.removeEventListener(this.enforceEditViewPitch)

    const finishFocus = () => {
      if (!this.editViewLocked) return
      if (this.mode !== 'editing') return
      this.enforceEditViewPitch()
      scene.requestRender()
    }

    const focused = this.focusRouteForEdit(line, {
      duration: 0.6,
      complete: finishFocus,
      cancel: finishFocus,
    })

    if (!focused) {
      camera.setView({
        destination: Cesium.Cartesian3.clone(camera.positionWC),
        orientation: {
          heading: camera.heading,
          pitch: this.editViewPitch,
          roll: 0,
        },
      })
      finishFocus()
    }
  }

  /**
   * 帧渲染回调中强制保持正俯视俯仰角
   */
  public enforceEditViewPitch(): void {
    if (!this.editViewLocked) return
    if (this.mode !== 'editing') return

    const camera = this.viewer.camera
    const tolerance = Cesium.Math.toRadians(0.05)

    const pitchChanged = Math.abs(camera.pitch - this.editViewPitch) > tolerance
    const rollChanged = Math.abs(camera.roll) > tolerance

    if (!pitchChanged && !rollChanged) {
      return
    }

    camera.setView({
      destination: Cesium.Cartesian3.clone(camera.positionWC),
      orientation: {
        heading: camera.heading,
        pitch: this.editViewPitch,
        roll: 0,
      },
    })
  }

  /**
   * 解除航线编辑视角锁定
   * @param restoreView 是否恢复进入编辑前的相机姿态
   */
  public unlockEditView(restoreView = false): void {
    if (!this.editViewLocked) return

    this.editViewLocked = false
    this.viewer.camera.cancelFlight()
    this.viewer.scene.postRender.removeEventListener(this.enforceEditViewPitch)

    const controller = this.viewer.scene.screenSpaceCameraController
    if (this.editViewControllerBackup) {
      controller.enableInputs = this.editViewControllerBackup.enableInputs
      controller.enableRotate = this.editViewControllerBackup.enableRotate
      controller.enableTranslate = this.editViewControllerBackup.enableTranslate
      controller.enableZoom = this.editViewControllerBackup.enableZoom
      controller.enableTilt = this.editViewControllerBackup.enableTilt
      controller.enableLook = this.editViewControllerBackup.enableLook
    }

    if (restoreView && this.editViewCameraBackup) {
      this.viewer.camera.setView({
        destination: this.editViewCameraBackup.destination,
        orientation: {
          heading: this.editViewCameraBackup.heading,
          pitch: this.editViewCameraBackup.pitch,
          roll: this.editViewCameraBackup.roll,
        },
      })
    }

    this.editViewControllerBackup = undefined
    this.editViewCameraBackup = undefined
    this.viewer.scene.requestRender()
  }

  /**
   * 加载并显示航线实体
   * @param line 航线数据
   * @param options 配置项
   */
  public addAirLine(
    line: Airline,
    options: { showVertex?: boolean } = {},
  ): Cesium.Entity | undefined {
    if (!line || !line.unicode || !Array.isArray(line.points)) {
      return undefined
    }

    const routeId = String(line.unicode)
    const showVertex = options.showVertex ?? true
    const visible = line.isVisible !== false
    line.isVisible = visible

    this.removeRouteEntities(routeId)
    this.normalizeRoutePoints(line)
    const renderPositions = this.getRouteRenderPositions(line)

    const airlineEntity = new Cesium.Entity({
      name: line.name,
      id: '航线' + routeId,
      show: visible,
      polyline: {
        positions: renderPositions,
        width: this.selectedRouteId === routeId ? 4 : 3,
        material:
          this.selectedRouteId === routeId
            ? this.selectedLineMaterial
            : this.normalLineMaterial,
        arcType: Cesium.ArcType.GEODESIC,
        granularity: 500 / Cesium.Ellipsoid.WGS84.maximumRadius,
        clampToGround: false,
      },
    })
    ;(airlineEntity as any)._routeId = routeId
    ;(airlineEntity as any)._entityType = 'routeLine'

    this.viewer.entities.add(airlineEntity)

    const vertexEntities = line.points.map((_, index) => {
      return this.createRouteVertexEntity(line, index, showVertex && visible)
    })

    this.routesMap.set(routeId, {
      line,
      entity: airlineEntity,
      vertexEntities,
      dirty: false,
      backupPoints: undefined,
      editPositions: undefined,
      visible,
    })

    this.viewer.scene.requestRender()
    return airlineEntity
  }

  /**
   * 移除航线
   * @param line 航线对象或包含 unicode 的对象
   */
  public removeRoute(line: Airline | { unicode?: string | number }): void {
    if (!line || !line.unicode) return

    const routeId = String(line.unicode)
    if (this.selectedRouteId === routeId && this.mode === 'editing') {
      this.unregisterEditEvents()
    }

    this.removeRouteEntities(routeId)
    this.routesMap.delete(routeId)

    if (this.selectedRouteId === routeId) {
      this.selectedRouteId = undefined
      this.mode = 'idle'
      if (this.onEditStateChanged) {
        this.onEditStateChanged(false)
      }
    }

    this.viewer.scene.requestRender()
  }

  /**
   * 清除指定航线的地图实体（线、点、标注）
   * @param routeId 航线唯一 ID
   */
  public removeRouteEntities(routeId: string | number): void {
    if (!this.viewer?.entities) return

    const routeItem = this.routesMap.get(String(routeId))
    this.viewer.entities.removeById('航线' + String(routeId))
    this.removeRouteSegmentLabels(String(routeId))

    if (routeItem?.vertexEntities?.length) {
      routeItem.vertexEntities.forEach((entity) => {
        this.viewer.entities.remove(entity)
      })
      routeItem.vertexEntities = []
    }

    this.viewer.scene.requestRender()
  }

  /**
   * 更新地图上的航线实体
   * @param line 航线数据
   * @param options 配置项
   */
  public updateRouteEntity(
    line: Airline,
    options: { rebuildVertex?: boolean; silent?: boolean } = {},
  ): void {
    if (!line || !line.unicode) return

    const routeId = String(line.unicode)
    const rebuildVertex = options.rebuildVertex ?? true
    const silent = options.silent ?? false

    this.normalizeRoutePoints(line)

    let routeItem = this.routesMap.get(routeId)
    if (!routeItem) {
      this.addAirLine(line)
      routeItem = this.routesMap.get(routeId)
    }
    if (!routeItem) return

    routeItem.line = line
    const visible = line.isVisible !== false
    line.isVisible = visible
    routeItem.visible = visible

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.name = line.name
      routeItem.entity.show = visible
      const isEditingCurrentRoute =
        this.mode === 'editing' && this.selectedRouteId === routeId
      const renderPositions = this.getRouteRenderPositions(line)

      if (isEditingCurrentRoute) {
        routeItem.editPositions = renderPositions
        const hasDynamicPositions =
          routeItem.entity.polyline.positions instanceof Cesium.CallbackProperty
        if (!hasDynamicPositions) {
          routeItem.entity.polyline.positions = new Cesium.CallbackProperty(
            () => routeItem.editPositions,
            false,
          )
        }
      } else {
        routeItem.editPositions = undefined
        routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
          renderPositions,
        )
      }

      if (isEditingCurrentRoute) {
        routeItem.entity.polyline.material = this.editingLineMaterial as any
        routeItem.entity.polyline.width = new Cesium.ConstantProperty(4)
      } else if (this.selectedRouteId === routeId) {
        routeItem.entity.polyline.material = this.selectedLineMaterial as any
        routeItem.entity.polyline.width = new Cesium.ConstantProperty(4)
      } else {
        routeItem.entity.polyline.material = this.normalLineMaterial as any
        routeItem.entity.polyline.width = new Cesium.ConstantProperty(3)
      }
    }

    const shouldRebuild =
      rebuildVertex || routeItem.vertexEntities.length !== line.points.length
    if (shouldRebuild) {
      this.clearSelectedEditVertex()
      routeItem.vertexEntities.forEach((entity) => {
        this.viewer.entities.remove(entity)
      })

      const showVertex =
        visible && (this.selectedRouteId === routeId || this.mode === 'editing')
      routeItem.vertexEntities = line.points.map((_, index) => {
        return this.createRouteVertexEntity(line, index, showVertex)
      })

      if (this.mode === 'editing' && this.selectedRouteId === routeId) {
        routeItem.vertexEntities.forEach((entity) => {
          this.setEditVertexNormalStyle(entity)
        })
      }
    } else {
      routeItem.vertexEntities.forEach((entity, index) => {
        const pt = line.points[index]
        if (!pt) return
        entity.show = visible
        entity.position = new Cesium.ConstantPositionProperty(
          Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0),
        )
        ;(entity as any)._vertexIndex = index
        if (entity.label) {
          entity.label.text = new Cesium.ConstantProperty('航点 ' + (index + 1))
        }
      })
    }

    routeItem.dirty = true
    if (!silent && this.onRouteChanged) {
      this.onRouteChanged(line)
    }
    this.viewer.scene.requestRender()
  }

  /**
   * 规范化航线航点数据
   * @param line 航线数据
   */
  public normalizeRoutePoints(line: Airline): void {
    if (!line || !Array.isArray(line.points)) return
    this.removeDuplicatedClosingPoint(line)

    line.points.forEach((pt, index) => {
      pt.nPt = index + 1
      if (pt.lon == null || Number.isNaN(Number(pt.lon))) pt.lon = 0
      if (pt.lat == null || Number.isNaN(Number(pt.lat))) pt.lat = 0
      if (pt.alt == null || Number.isNaN(Number(pt.alt))) pt.alt = 0
      if (pt.speed == null || Number.isNaN(Number(pt.speed))) pt.speed = 0
      if (pt.ch1 == null || Number.isNaN(Number(pt.ch1))) pt.ch1 = 0
      pt.ch2 = 3
    })

    line.PtNum = line.points.length
    if (line.points.length > 0) {
      const lastPt = line.points[line.points.length - 1]
      lastPt.ch2 = 1
      lastPt.ch1 = line.isClose ? 0 : 2
    }
  }

  /**
   * 消除闭合航线末尾重复的首点
   * @param line 航线数据
   */
  public removeDuplicatedClosingPoint(line: Airline): void {
    if (!line?.isClose || !Array.isArray(line.points)) return
    if (line.points.length < 3) return

    const first = line.points[0]
    const last = line.points[line.points.length - 1]
    const alreadyClosed =
      Math.abs(Number(first.lon) - Number(last.lon)) < 1e-8 &&
      Math.abs(Number(first.lat) - Number(last.lat)) < 1e-8 &&
      Math.abs(Number(first.alt || 0) - Number(last.alt || 0)) < 1e-3

    if (alreadyClosed) {
      line.points.pop()
    }
  }

  /**
   * 获取航线渲染用的笛卡尔坐标数组
   * @param line 航线数据
   */
  public getRouteRenderPositions(line: Airline): Cesium.Cartesian3[] {
    const arr = line.points.map((pt) => {
      return Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0)
    })

    if (line.isClose && line.points.length > 1) {
      const first = line.points[0]
      arr.push(Cartesian3.fromDegrees(first.lon, first.lat, first.alt || 0))
    }

    return arr
  }

  /**
   * 平滑飞行定位至指定航线
   * @param line 航线数据
   * @param duration 飞行持续时间(秒)
   */
  public flyToRoute(line: Airline, duration = 1.5): boolean {
    if (!line || !Array.isArray(line.points) || line.points.length === 0) {
      console.warn('[RouteManageViewer.flyToRoute] 航线无有效航点', line)
      return false
    }
    if (line.isVisible === false) return false

    const validPoints = line.points.filter((pt) => {
      const lon = Number(pt.lon)
      const lat = Number(pt.lat)
      const alt = Number(pt.alt || 0)
      return (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        Number.isFinite(alt) &&
        lon >= -180 &&
        lon <= 180 &&
        lat >= -90 &&
        lat <= 90
      )
    })

    if (validPoints.length === 0) {
      console.warn('[RouteManageViewer.flyToRoute] 航点经纬度无效', line.points)
      return false
    }

    const positions = validPoints.map((pt) => {
      return Cesium.Cartesian3.fromDegrees(
        Number(pt.lon),
        Number(pt.lat),
        Number(pt.alt || 0),
      )
    })

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions)
    if (!boundingSphere || !boundingSphere.center || !Number.isFinite(boundingSphere.radius)) {
      console.warn('[RouteManageViewer.flyToRoute] 包围球计算失败', {
        positions,
        boundingSphere,
      })
      return false
    }

    const radius = Math.max(boundingSphere.radius, 300)
    const range = Math.max(radius * 4, 1200)

    this.viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(0),
        Cesium.Math.toRadians(-60),
        range,
      ),
    })

    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 创建航点实体
   * @param line 航线数据
   * @param index 航点序号 (0-based)
   * @param show 是否显示
   */
  public createRouteVertexEntity(line: Airline, index: number, show = true): Cesium.Entity {
    const routeId = String(line.unicode)
    const pt = line.points[index]

    const vertexEntity = new Cesium.Entity({
      id: `${routeId}-航点${index + 1}`,
      position: Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0),
      show,
      point: {
        color: Cesium.Color.WHITE,
        pixelSize: 7,
        outlineColor: Cesium.Color.RED,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '航点 ' + (index + 1),
        font: '2.5rem sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scale: 0.4,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.99),
        backgroundPadding: new Cesium.Cartesian2(15, 7),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    ;(vertexEntity as any)._routeId = routeId
    ;(vertexEntity as any)._entityType = 'routeVertex'
    ;(vertexEntity as any)._vertexIndex = index

    this.viewer.entities.add(vertexEntity)
    return vertexEntity
  }

  /**
   * 创建航段标签 DOM 容器图层
   */
  public createSegmentLabelLayer(): void {
    if (typeof document === 'undefined') return
    const container = (this.viewer.container || (this.viewer as any)._element) as HTMLElement
    if (!container) return

    const computedStyle = window.getComputedStyle(container)
    if (computedStyle.position === 'static') {
      container.style.position = 'relative'
    }

    const layer = document.createElement('div')
    layer.className = 'route-segment-label-layer'
    layer.style.position = 'absolute'
    layer.style.left = '0'
    layer.style.top = '0'
    layer.style.width = '100%'
    layer.style.height = '100%'
    layer.style.overflow = 'hidden'
    layer.style.pointerEvents = 'none'
    layer.style.zIndex = '4'

    container.appendChild(layer)
    this.segmentLabelLayer = layer
  }

  /**
   * 创建单个航段标签 DOM 元素
   */
  public createSegmentLabelElement(): HTMLDivElement | undefined {
    if (!this.segmentLabelLayer) return undefined

    const label = document.createElement('div')
    label.className = 'route-segment-label'
    label.style.position = 'absolute'
    label.style.left = '0'
    label.style.top = '0'
    label.style.display = 'none'
    label.style.whiteSpace = 'nowrap'
    label.style.pointerEvents = 'none'
    label.style.userSelect = 'none'
    label.style.transformOrigin = 'center center'
    label.style.padding = '2px 6px'
    label.style.borderRadius = '3px'
    label.style.background = 'rgba(18, 18, 18, 0.78)'
    label.style.border = '1px solid rgba(255, 255, 255, 0.24)'
    label.style.color = '#ffffff'
    label.style.font = '600 12px/1.2 sans-serif'
    label.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.9)'
    label.style.boxSizing = 'border-box'
    label.style.willChange = 'transform, left, top'

    this.segmentLabelLayer.appendChild(label)
    return label
  }

  public ensureLabelElements(labels: HTMLDivElement[], count: number): HTMLDivElement[] {
    while (labels.length < count) {
      const label = this.createSegmentLabelElement()
      if (!label) break
      labels.push(label)
    }

    while (labels.length > count) {
      const label = labels.pop()
      if (label && label.parentNode) {
        label.parentNode.removeChild(label)
      }
    }

    return labels
  }

  public ensureRouteSegmentLabels(routeId: string, count: number): HTMLDivElement[] {
    let labels = this.routeSegmentLabelEls.get(routeId)
    if (!labels) {
      labels = []
      this.routeSegmentLabelEls.set(routeId, labels)
    }
    return this.ensureLabelElements(labels, count)
  }

  public ensureDrawSegmentLabels(count: number): HTMLDivElement[] {
    this.drawSegmentLabelEls = this.ensureLabelElements(
      this.drawSegmentLabelEls,
      count,
    )
    return this.drawSegmentLabelEls
  }

  public removeRouteSegmentLabels(routeId: string): void {
    const labels = this.routeSegmentLabelEls.get(String(routeId))
    if (!labels) return

    labels.forEach((label) => {
      if (label && label.parentNode) {
        label.parentNode.removeChild(label)
      }
    })
    this.routeSegmentLabelEls.delete(String(routeId))
  }

  public clearSegmentLabels(): void {
    this.routeSegmentLabelEls.forEach((labels) => {
      labels.forEach((label) => {
        if (label && label.parentNode) {
          label.parentNode.removeChild(label)
        }
      })
    })
    this.routeSegmentLabelEls.clear()

    this.drawSegmentLabelEls.forEach((label) => {
      if (label && label.parentNode) {
        label.parentNode.removeChild(label)
      }
    })
    this.drawSegmentLabelEls = []

    if (this.segmentLabelLayer && this.segmentLabelLayer.parentNode) {
      this.segmentLabelLayer.parentNode.removeChild(this.segmentLabelLayer)
    }
    this.segmentLabelLayer = undefined
  }

  /**
   * 渲染帧更新各航段的距离与方位角标签位置
   */
  public updateSegmentLabels(): void {
    if (!this.segmentLabelLayer) return

    const activeRouteIds = new Set<string>()

    this.routesMap.forEach((routeItem, routeId) => {
      activeRouteIds.add(String(routeId))
      if (routeItem.visible === false || routeItem.line?.isVisible === false) {
        this.removeRouteSegmentLabels(routeId)
        return
      }

      const segments = this.getLineSegmentLabelData(routeItem.line)
      const labels = this.ensureRouteSegmentLabels(
        String(routeId),
        segments.length,
      )
      this.renderSegmentLabels(segments, labels)
    })

    Array.from(this.routeSegmentLabelEls.keys()).forEach((routeId) => {
      if (!activeRouteIds.has(String(routeId))) {
        this.removeRouteSegmentLabels(routeId)
      }
    })

    const drawSegments =
      this.mode === 'drawing'
        ? this.getPositionsSegmentLabelData(this.temPositions)
        : []
    const drawLabels = this.ensureDrawSegmentLabels(drawSegments.length)
    this.renderSegmentLabels(drawSegments, drawLabels)
  }

  public getLineSegmentLabelData(line: Airline): SegmentLabelData[] {
    if (!line?.points || line.points.length < 2) return []
    return this.getPositionsSegmentLabelData(this.getRouteRenderPositions(line))
  }

  public getPositionsSegmentLabelData(positions: Cesium.Cartesian3[]): SegmentLabelData[] {
    if (!Array.isArray(positions) || positions.length < 2) return []

    const segments: SegmentLabelData[] = []
    let totalKm = 0

    for (let i = 0; i < positions.length - 1; i++) {
      const start = positions[i]
      const end = positions[i + 1]
      if (!start || !end) continue

      const metrics = this.computeSegmentMetrics(start, end)
      if (!metrics || metrics.distanceKm <= 0) continue

      totalKm += metrics.distanceKm
      segments.push({
        start,
        end,
        distanceKm: metrics.distanceKm,
        bearingDeg: metrics.bearingDeg,
        totalKm: undefined,
      })
    }

    if (segments.length > 0) {
      segments[segments.length - 1].totalKm = totalKm
    }

    return segments
  }

  public computeSegmentMetrics(
    start: Cesium.Cartesian3,
    end: Cesium.Cartesian3,
  ): SegmentMetrics | undefined {
    try {
      const startCartographic = Cesium.Cartographic.fromCartesian(
        start,
        Cesium.Ellipsoid.WGS84,
      )
      const endCartographic = Cesium.Cartographic.fromCartesian(
        end,
        Cesium.Ellipsoid.WGS84,
      )
      const geodesic = new Cesium.EllipsoidGeodesic(
        startCartographic,
        endCartographic,
        Cesium.Ellipsoid.WGS84,
      )
      const distanceKm = geodesic.surfaceDistance / 1000
      const bearingDeg =
        (Cesium.Math.toDegrees(geodesic.startHeading) + 360) % 360

      return {
        distanceKm,
        bearingDeg,
      }
    } catch (_error) {
      return undefined
    }
  }

  public formatDistanceKm(value: number | string): string {
    return Number(value || 0).toFixed(2)
  }

  public formatBearingDeg(value: number | string): string {
    return String(Math.round(Number(value || 0)) % 360)
  }

  public formatSegmentLabel(segment: SegmentLabelData): string {
    const baseText =
      `${this.formatDistanceKm(segment.distanceKm)} km, ` +
      `${this.formatBearingDeg(segment.bearingDeg)}°`

    if (segment.totalKm == null) return baseText
    return `${baseText} （total：${this.formatDistanceKm(segment.totalKm)} km）`
  }

  public renderSegmentLabels(segments: SegmentLabelData[], labels: HTMLDivElement[]): void {
    labels.forEach((label, index) => {
      const segment = segments[index]
      if (!segment) {
        label.style.display = 'none'
        return
      }
      this.renderSegmentLabel(segment, label)
    })
  }

  public renderSegmentLabel(segment: SegmentLabelData, label: HTMLDivElement): void {
    const startWindow = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      this.viewer.scene,
      segment.start,
    )
    const endWindow = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      this.viewer.scene,
      segment.end,
    )

    if (!startWindow || !endWindow) {
      label.style.display = 'none'
      return
    }

    const dx = endWindow.x - startWindow.x
    const dy = endWindow.y - startWindow.y
    const pixelLength = Math.sqrt(dx * dx + dy * dy)

    if (!this.shouldShowSegmentLabel(segment, startWindow, endWindow, pixelLength)) {
      label.style.display = 'none'
      return
    }

    const midX = (startWindow.x + endWindow.x) / 2
    const midY = (startWindow.y + endWindow.y) / 2
    let angle = Cesium.Math.toDegrees(Math.atan2(dy, dx))

    if (angle > 90 || angle < -90) {
      angle += 180
    }

    const text = this.formatSegmentLabel(segment)
    if (label.textContent !== text) {
      label.textContent = text
    }

    label.style.display = 'block'
    label.style.left = `${midX}px`
    label.style.top = `${midY}px`
    label.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateY(-16px)`
  }

  public shouldShowSegmentLabel(
    _segment: SegmentLabelData,
    startWindow: Cesium.Cartesian2,
    endWindow: Cesium.Cartesian2,
    pixelLength: number,
  ): boolean {
    if (pixelLength < this.segmentLabelMinPixelLength) return false

    const canvas = this.viewer.scene.canvas
    const midX = (startWindow.x + endWindow.x) / 2
    const midY = (startWindow.y + endWindow.y) / 2
    const margin = 80

    if (
      midX < -margin ||
      midY < -margin ||
      midX > canvas.clientWidth + margin ||
      midY > canvas.clientHeight + margin
    ) {
      return false
    }

    const midpoint = Cesium.Cartesian3.midpoint(
      _segment.start,
      _segment.end,
      new Cesium.Cartesian3(),
    )
    const cameraDistance = Cesium.Cartesian3.distance(
      this.viewer.camera.positionWC,
      midpoint,
    )

    return cameraDistance <= this.segmentLabelMaxCameraDistance
  }

  /**
   * 注册地图点击单选航线
   */
  public enableRouteSelect(): void {
    if (this.selectHandler && !this.selectHandler.isDestroyed()) {
      this.selectHandler.destroy()
    }

    this.selectHandler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    )

    this.selectHandler.setInputAction((movement: any) => {
      if (this.mode === 'drawing' || this.mode === 'editing') return

      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id
      if (!entity || entity._entityType !== 'routeVertex') return

      if (String(entity._routeId) !== String(this.selectedRouteId)) {
        return
      }

      if (!this.selectRoute(entity._routeId)) return
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }

  /**
   * 选中指定 ID 的航线
   * @param routeId 航线 ID
   */
  public selectRoute(routeId: string | number): boolean {
    const normalizedRouteId = String(routeId)
    const routeItem = this.routesMap.get(normalizedRouteId)
    if (
      !routeItem ||
      routeItem.visible === false ||
      routeItem.line?.isVisible === false
    ) {
      return false
    }

    if (this.selectedRouteId && this.selectedRouteId !== normalizedRouteId) {
      this.unselectRoute()
    }

    this.selectedRouteId = normalizedRouteId
    this.mode = 'selected'

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.material = this.selectedLineMaterial as any
      routeItem.entity.polyline.width = new Cesium.ConstantProperty(4)
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = routeItem.visible !== false
      if (entity.point) {
        entity.point.color = new Cesium.ConstantProperty(Cesium.Color.WHITE)
        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.RED)
        entity.point.pixelSize = new Cesium.ConstantProperty(7)
      }
    })

    this.viewer.scene.requestRender()

    if (this.onRouteSelected) {
      this.onRouteSelected(normalizedRouteId, routeItem.line)
    }
    return true
  }

  public findNoFlyZoneConflict(points: AirlinePoint[] | { lon: number; lat: number }[], isClose = false): NFZConflict | null {
    return noFlyZoneService.findRouteConflict(points || [], isClose)
  }

  public getCartesianRoutePoints(positions: Cesium.Cartesian3[]): { lon: number; lat: number }[] {
    return positions.map((position) => {
      const cartographic = Cesium.Cartographic.fromCartesian(
        position,
        Cesium.Ellipsoid.WGS84,
      )
      return {
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
      }
    })
  }

  public notifyNoFlyZoneViolation(conflict: NFZConflict, action: string, throttle = false): void {
    if (!conflict) return
    const now = Date.now()
    if (throttle && now - this.lastNoFlyZoneWarningAt < 1200) return
    this.lastNoFlyZoneWarningAt = now

    if (this.onNoFlyZoneViolation) {
      this.onNoFlyZoneViolation({ conflict, action })
    } else {
      console.warn('[RouteManageViewer] 航线与禁飞区冲突', { conflict, action })
    }
  }

  public setDrawNoFlyZoneConflict(conflict: NFZConflict | null): void {
    this.drawNoFlyZoneConflict = conflict || undefined
    const container = this.viewer.container as HTMLElement
    if (container) {
      container.style.cursor = conflict ? 'not-allowed' : 'crosshair'
    }

    if (this.lineEntity?.polyline) {
      const color = conflict ? Cesium.Color.RED : Cesium.Color.YELLOW
      this.lineEntity.polyline.material = color as any
      ;(this.lineEntity.polyline as any).depthFailMaterial = color as any
    }
  }

  /**
   * 取消当前航线选中状态
   */
  public unselectRoute(): void {
    if (!this.selectedRouteId) return

    const routeItem = this.routesMap.get(this.selectedRouteId)
    if (!routeItem) {
      this.selectedRouteId = undefined
      this.mode = 'idle'
      return
    }

    const visible = routeItem.visible !== false
    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.show = visible
      routeItem.entity.polyline.material = this.normalLineMaterial as any
      routeItem.entity.polyline.width = new Cesium.ConstantProperty(3)
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = visible
      if (entity.point) {
        entity.point.color = new Cesium.ConstantProperty(Cesium.Color.WHITE)
        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.RED)
        entity.point.pixelSize = new Cesium.ConstantProperty(7)
      }
    })

    this.selectedRouteId = undefined
    this.mode = 'idle'
    this.viewer.scene.requestRender()
  }

  /**
   * 设置航线显示与隐藏
   * @param routeId 航线 ID
   * @param visible 是否可见
   */
  public setRouteVisibility(routeId: string | number, visible: boolean): boolean {
    const normalizedRouteId = String(routeId)
    if (this.mode === 'drawing' || this.mode === 'editing') return false

    const routeItem = this.routesMap.get(normalizedRouteId)
    if (!routeItem) return false

    const nextVisible = Boolean(visible)
    routeItem.visible = nextVisible
    routeItem.line.isVisible = nextVisible

    if (!nextVisible && this.selectedRouteId === normalizedRouteId) {
      this.unselectRoute()
    }

    if (routeItem.entity) {
      routeItem.entity.show = nextVisible
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = nextVisible
    })

    if (!nextVisible) {
      this.removeRouteSegmentLabels(normalizedRouteId)
    }

    this.viewer.scene.requestRender()
    return true
  }

  public isRouteVisible(routeId: string | number): boolean {
    const routeItem = this.routesMap.get(String(routeId))
    return Boolean(
      routeItem &&
      routeItem.visible !== false &&
      routeItem.line?.isVisible !== false,
    )
  }

  /**
   * 开始编辑航线
   * @param routeId 航线 ID
   */
  public startEditRoute(routeId: string | number): boolean {
    const normalizedRouteId = String(routeId)
    const routeItem = this.routesMap.get(normalizedRouteId)
    if (
      !routeItem ||
      routeItem.visible === false ||
      routeItem.line?.isVisible === false
    ) {
      return false
    }

    if (!this.selectRoute(normalizedRouteId)) return false
    routeItem.backupPoints = JSON.parse(JSON.stringify(routeItem.line.points))
    routeItem.dirty = false

    this.mode = 'editing'
    this.selectedRouteId = normalizedRouteId
    this.lockEditView(routeItem.line)

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.material = this.editingLineMaterial as any
      routeItem.entity.polyline.width = new Cesium.ConstantProperty(4)
      routeItem.editPositions = this.getRouteRenderPositions(routeItem.line)
      routeItem.entity.polyline.positions = new Cesium.CallbackProperty(() => {
        return routeItem.editPositions
      }, false)
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = true
      if (entity.point) {
        entity.point.color = new Cesium.ConstantProperty(Cesium.Color.FUCHSIA)
        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.WHITE)
        entity.point.pixelSize = new Cesium.ConstantProperty(9)
      }
    })

    this.registerEditEvents()

    if (this.onEditStateChanged) {
      this.onEditStateChanged(true)
    }

    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 注册编辑过程中的鼠标与键盘交互事件
   */
  public registerEditEvents(): void {
    this.unregisterEditEvents()

    this.editHandler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    )

    this.editPreventContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }
    this.viewer.scene.canvas.addEventListener(
      'contextmenu',
      this.editPreventContextMenu,
    )

    // 左键按下：选中航点准备拖拽
    this.editHandler.setInputAction((movement: any) => {
      if (this.mode !== 'editing') return
      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id

      if (!entity || entity._entityType !== 'routeVertex') return
      if (String(entity._routeId) !== String(this.selectedRouteId)) return

      this.selectEditVertex(entity)
      const startCartesian = this.getEntityCartesian(entity)
      if (!startCartesian) return

      const normal = Cesium.Cartesian3.clone(this.viewer.camera.directionWC)
      Cesium.Cartesian3.normalize(normal, normal)
      const dragPlane = Cesium.Plane.fromPointNormal(startCartesian, normal)

      this.dragInfo = {
        routeId: String(entity._routeId),
        vertexIndex: entity._vertexIndex,
        entity,
        dragPlane,
        fixedAlt: this.getPointAlt(
          String(entity._routeId),
          entity._vertexIndex,
        ),
      }

      this.activeVertexInfo = {
        routeId: String(entity._routeId),
        vertexIndex: entity._vertexIndex,
        entity,
      }

      this.hideEditVertexMenu()
      this.disableCameraControls()
      const container = this.viewer.container as HTMLElement
      if (container) container.style.cursor = 'move'
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    // 鼠标移动：拖拽航点位置
    this.editHandler.setInputAction((movement: any) => {
      if (this.mode !== 'editing' || !this.dragInfo) return

      const position = this.getDragCartesianFromScreen(
        movement.endPosition,
        this.dragInfo.dragPlane,
      )
      if (!position) return

      this.moveVertex(
        this.dragInfo.routeId,
        this.dragInfo.vertexIndex,
        position,
      )
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 左键抬起：结束拖拽
    this.editHandler.setInputAction(() => {
      this.endVertexDrag()
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    // 左键单击：点中航点高亮，点空白取消
    this.editHandler.setInputAction((movement: any) => {
      if (this.mode !== 'editing') return

      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id

      if (this.isCurrentEditingVertex(entity)) {
        this.selectEditVertex(entity)
        this.hideEditVertexMenu()
        return
      }

      this.clearSelectedEditVertex()
      this.hideEditVertexMenu()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 右键：弹出航点或线段菜单
    this.editHandler.setInputAction((movement: any) => {
      if (this.mode !== 'editing') return

      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id
      this.hideEditVertexMenu()

      if (!entity) return

      if (
        entity._entityType === 'routeVertex' &&
        String(entity._routeId) === String(this.selectedRouteId)
      ) {
        this.selectEditVertex(entity)
        this.activeVertexInfo = {
          routeId: String(entity._routeId),
          vertexIndex: entity._vertexIndex,
          entity,
        }
        this.showEditVertexMenu(
          movement.position,
          String(entity._routeId),
          entity._vertexIndex,
        )
        return
      }

      if (
        entity._entityType === 'routeLine' &&
        String(entity._routeId) === String(this.selectedRouteId)
      ) {
        const clickedCartesian = this.getCartesianFromScreen(movement.position)
        if (!clickedCartesian) return
        this.showLineInsertMenu(
          movement.position,
          String(entity._routeId),
          clickedCartesian,
        )
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    // Delete 快捷键删除当前激活航点
    this.editKeydownHandler = (event: KeyboardEvent) => {
      if (this.mode !== 'editing') return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!this.activeVertexInfo) return
        event.preventDefault()
        this.deleteVertex(
          this.activeVertexInfo.routeId,
          this.activeVertexInfo.vertexIndex,
        )
      }
    }

    window.addEventListener('keydown', this.editKeydownHandler)
  }

  public getPointAlt(routeId: string, vertexIndex: number): number {
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return 0
    const pt = routeItem.line.points[vertexIndex]
    return pt ? pt.alt || 0 : 0
  }

  /**
   * 移动航点到新的笛卡尔世界坐标
   */
  public moveVertex(
    routeId: string,
    vertexIndex: number,
    cartesian: Cesium.Cartesian3,
  ): boolean {
    if (this.mode !== 'editing') return false
    if (String(routeId) !== String(this.selectedRouteId)) return false

    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return false

    const line = routeItem.line
    const pt = line.points[vertexIndex]
    if (!pt) return false

    const cartographic = Cesium.Cartographic.fromCartesian(
      cartesian,
      Cesium.Ellipsoid.WGS84,
    )
    const nextLongitude = Cesium.Math.toDegrees(cartographic.longitude)
    const nextLatitude = Cesium.Math.toDegrees(cartographic.latitude)
    const candidatePoints = line.points.map((point, index) =>
      index === vertexIndex
        ? { ...point, lon: nextLongitude, lat: nextLatitude }
        : point,
    )
    const conflict = this.findNoFlyZoneConflict(candidatePoints, line.isClose)

    const container = this.viewer.container as HTMLElement
    if (conflict) {
      if (container) container.style.cursor = 'not-allowed'
      this.notifyNoFlyZoneViolation(conflict, '移动航点', true)
      return false
    }

    if (container) container.style.cursor = 'move'
    pt.lon = nextLongitude
    pt.lat = nextLatitude

    if (this.keepAltitudeOnDrag) {
      pt.alt = this.dragInfo?.fixedAlt ?? pt.alt ?? 0
    } else {
      pt.alt = cartographic.height
    }

    const newCartesian = Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0)
    const vertexEntity = routeItem.vertexEntities[vertexIndex]
    if (vertexEntity) {
      vertexEntity.position = new Cesium.ConstantPositionProperty(newCartesian)
    }

    if (routeItem.editPositions) {
      routeItem.editPositions[vertexIndex] = newCartesian
      if (
        line.isClose &&
        vertexIndex === 0 &&
        routeItem.editPositions.length === line.points.length + 1
      ) {
        routeItem.editPositions[routeItem.editPositions.length - 1] = newCartesian
      }
    } else if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
        this.getRouteRenderPositions(line),
      )
    }

    routeItem.dirty = true
    if (this.onRouteChanged) {
      this.onRouteChanged(line)
    }
    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 结束航点拖拽状态
   */
  public endVertexDrag(): void {
    if (!this.dragInfo) return
    const routeId = this.dragInfo.routeId
    this.dragInfo = undefined
    this.dragPlane = undefined
    this.restoreCameraControls()

    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'

    const routeItem = this.routesMap.get(String(routeId))
    if (routeItem && this.onRouteChanged) {
      this.onRouteChanged(routeItem.line)
    }
    this.viewer.scene.requestRender()
  }

  /**
   * 弹出航点右键菜单
   */
  public showEditVertexMenu(screenPosition: Cesium.Cartesian2, routeId: string, vertexIndex: number): void {
    this.hideEditVertexMenu()
    const routeItem = this.routesMap.get(String(routeId))
    const line = routeItem?.line
    if (!line) return

    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = '9999'
    menu.style.minWidth = '140px'
    menu.style.background = '#1f1f1f'
    menu.style.border = '1px solid #555'
    menu.style.borderRadius = '4px'
    menu.style.padding = '4px 0'
    menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
    menu.style.fontSize = '14px'
    menu.style.color = '#fff'

    const createItem = (text: string, callback: () => void, disabled = false) => {
      const item = document.createElement('div')
      item.innerText = text
      item.style.padding = '8px 12px'
      item.style.cursor = disabled ? 'not-allowed' : 'pointer'
      item.style.opacity = disabled ? '0.45' : '1'

      if (!disabled) {
        item.onmouseenter = () => {
          item.style.background = '#333'
        }
        item.onmouseleave = () => {
          item.style.background = 'transparent'
        }
        item.onclick = () => {
          this.hideEditVertexMenu()
          callback()
        }
      }
      return item
    }

    menu.appendChild(
      createItem('在点后添加航点', () => {
        this.insertVertexAfter(routeId, vertexIndex)
      }),
    )

    menu.appendChild(
      createItem(
        '删除航点',
        () => {
          this.deleteVertex(routeId, vertexIndex)
        },
        line.points.length <= this.getMinimumRoutePointCount(line),
      ),
    )

    document.body.appendChild(menu)
    this.editMenuEl = menu
  }

  /**
   * 弹出在线段上插入航点的右键菜单
   */
  public showLineInsertMenu(screenPosition: Cesium.Cartesian2, routeId: string, clickedCartesian: Cesium.Cartesian3): void {
    this.hideEditVertexMenu()
    const routeItem = this.routesMap.get(String(routeId))
    const line = routeItem?.line
    if (!line) return

    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = '9999'
    menu.style.minWidth = '140px'
    menu.style.background = '#1f1f1f'
    menu.style.border = '1px solid #555'
    menu.style.borderRadius = '4px'
    menu.style.padding = '4px 0'
    menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
    menu.style.fontSize = '14px'
    menu.style.color = '#fff'

    const item = document.createElement('div')
    item.innerText = '添加航点'
    item.style.padding = '8px 12px'
    item.style.cursor = 'pointer'

    item.onmouseenter = () => {
      item.style.background = '#333'
    }
    item.onmouseleave = () => {
      item.style.background = 'transparent'
    }
    item.onclick = () => {
      this.hideEditVertexMenu()
      this.insertVertexOnLine(routeId, clickedCartesian)
    }

    menu.appendChild(item)
    document.body.appendChild(menu)
    this.editMenuEl = menu
  }

  /**
   * 在指定航点后插入新航点
   */
  public insertVertexAfter(routeId: string | number, vertexIndex: number): boolean {
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return false
    const line = routeItem.line
    if (!line.points || line.points.length < 2) return false

    const newPt = this.createPointAfter(line, vertexIndex)
    if (!newPt) return false

    const candidatePoints = line.points.map((point) => ({ ...point }))
    candidatePoints.splice(vertexIndex + 1, 0, newPt)
    const conflict = this.findNoFlyZoneConflict(candidatePoints, line.isClose)
    if (conflict) {
      this.notifyNoFlyZoneViolation(conflict, '添加航点')
      return false
    }

    line.points.splice(vertexIndex + 1, 0, newPt)
    this.normalizeRoutePoints(line)
    this.activeVertexInfo = {
      routeId: String(routeId),
      vertexIndex: vertexIndex + 1,
      entity: undefined,
    }
    this.updateRouteEntity(line, { rebuildVertex: true })
    return true
  }

  /**
   * 在航线上点击位置插入新航点
   */
  public insertVertexOnLine(routeId: string | number, clickedCartesian: Cesium.Cartesian3): boolean {
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return false
    const line = routeItem.line
    if (!line?.points || line.points.length < 2) return false

    const projectionInfo = this.findNearestSegmentProjection(line, clickedCartesian)
    if (!projectionInfo) return false

    const { insertAfterIndex, projectionCartesian, t } = projectionInfo
    const ptA = line.points[insertAfterIndex]
    const ptB = line.points[(insertAfterIndex + 1) % line.points.length]

    const cartographic = Cesium.Cartographic.fromCartesian(
      projectionCartesian,
      Cesium.Ellipsoid.WGS84,
    )
    const altA = Number(ptA.alt || 0)
    const altB = Number(ptB.alt || 0)

    const newPt: AirlinePoint = {
      ...ptA,
      lon: Cesium.Math.toDegrees(cartographic.longitude),
      lat: Cesium.Math.toDegrees(cartographic.latitude),
      alt: altA + (altB - altA) * t,
      speed: ptA.speed ?? ptB.speed ?? 0,
      ch1: 0,
      ch2: 3,
    }

    const candidatePoints = line.points.map((point) => ({ ...point }))
    candidatePoints.splice(insertAfterIndex + 1, 0, newPt)
    const conflict = this.findNoFlyZoneConflict(candidatePoints, line.isClose)
    if (conflict) {
      this.notifyNoFlyZoneViolation(conflict, '添加航点')
      return false
    }

    line.points.splice(insertAfterIndex + 1, 0, newPt)
    this.normalizeRoutePoints(line)
    this.activeVertexInfo = {
      routeId: String(routeId),
      vertexIndex: insertAfterIndex + 1,
      entity: undefined,
    }
    this.updateRouteEntity(line, { rebuildVertex: true })
    return true
  }

  public findNearestSegmentProjection(
    line: Airline,
    clickedCartesian: Cesium.Cartesian3,
  ): ProjectionResult | undefined {
    if (!line?.points || line.points.length < 2) return undefined
    const points = line.points
    const segmentCount = line.isClose ? points.length : points.length - 1

    let minDistance = Number.POSITIVE_INFINITY
    let bestResult: ProjectionResult | undefined = undefined

    for (let i = 0; i < segmentCount; i++) {
      const ptA = points[i]
      const ptB = points[(i + 1) % points.length]

      const aCartesian = Cesium.Cartesian3.fromDegrees(
        Number(ptA.lon),
        Number(ptA.lat),
        Number(ptA.alt || 0),
      )
      const bCartesian = Cesium.Cartesian3.fromDegrees(
        Number(ptB.lon),
        Number(ptB.lat),
        Number(ptB.alt || 0),
      )

      const projectionResult = this.pointToSegmentProjection(
        clickedCartesian,
        aCartesian,
        bCartesian,
      )
      if (!projectionResult) continue

      if (projectionResult.distance < minDistance) {
        minDistance = projectionResult.distance
        bestResult = {
          insertAfterIndex: i,
          projectionCartesian: projectionResult.projection,
          t: projectionResult.t,
        }
      }
    }

    return bestResult
  }

  public pointToSegmentProjection(
    point: Cesium.Cartesian3,
    segStart: Cesium.Cartesian3,
    segEnd: Cesium.Cartesian3,
  ): { projection: Cesium.Cartesian3; t: number; distance: number } {
    const ab = new Cesium.Cartesian3()
    const ap = new Cesium.Cartesian3()
    Cesium.Cartesian3.subtract(segEnd, segStart, ab)
    Cesium.Cartesian3.subtract(point, segStart, ap)

    const abLenSq = Cesium.Cartesian3.magnitudeSquared(ab)
    if (abLenSq === 0) {
      return {
        projection: Cesium.Cartesian3.clone(segStart),
        t: 0,
        distance: Cesium.Cartesian3.distance(point, segStart),
      }
    }

    let t = Cesium.Cartesian3.dot(ap, ab) / abLenSq
    t = Math.max(0, Math.min(1, t))

    const projection = new Cesium.Cartesian3(
      segStart.x + ab.x * t,
      segStart.y + ab.y * t,
      segStart.z + ab.z * t,
    )

    return {
      projection,
      t,
      distance: Cesium.Cartesian3.distance(point, projection),
    }
  }

  public createPointAfter(line: Airline, vertexIndex: number): AirlinePoint | undefined {
    const points = line.points
    const current = points[vertexIndex]
    if (!current) return undefined

    const newPt: AirlinePoint = { ...current }
    if (line.isClose) {
      const nextIndex = vertexIndex === points.length - 1 ? 0 : vertexIndex + 1
      const next = points[nextIndex]
      newPt.lon = (current.lon + next.lon) / 2
      newPt.lat = (current.lat + next.lat) / 2
      newPt.alt = (current.alt + next.alt) / 2
      newPt.speed = current.speed ?? 0
      newPt.ch1 = 0
      newPt.ch2 = 3
      return newPt
    }

    if (vertexIndex < points.length - 1) {
      const next = points[vertexIndex + 1]
      newPt.lon = (current.lon + next.lon) / 2
      newPt.lat = (current.lat + next.lat) / 2
      newPt.alt = (current.alt + next.alt) / 2
      newPt.speed = current.speed ?? 0
      newPt.ch1 = 0
      newPt.ch2 = 3
      return newPt
    }

    if (points.length >= 2) {
      const prev = points[points.length - 2]
      const last = points[points.length - 1]
      const factor = 0.25
      newPt.lon = last.lon + (last.lon - prev.lon) * factor
      newPt.lat = last.lat + (last.lat - prev.lat) * factor
      newPt.alt = last.alt + (last.alt - prev.alt) * factor
      newPt.speed = last.speed ?? 0
      newPt.ch1 = 0
      newPt.ch2 = 3
      return newPt
    }

    return undefined
  }

  public hideEditVertexMenu(): void {
    if (this.editMenuEl && this.editMenuEl.parentNode) {
      this.editMenuEl.parentNode.removeChild(this.editMenuEl)
    }
    this.editMenuEl = undefined
  }

  /**
   * 删除航点
   */
  public deleteVertex(routeId: string | number, vertexIndex: number): boolean {
    this.clearSelectedEditVertex()
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return false
    const line = routeItem.line

    if (!line.points || line.points.length <= this.getMinimumRoutePointCount(line)) {
      console.warn(this.getRoutePointCountWarning(line))
      return false
    }

    const candidatePoints = line.points
      .filter((_, index) => index !== vertexIndex)
      .map((point) => ({ ...point }))
    const conflict = this.findNoFlyZoneConflict(candidatePoints, line.isClose)
    if (conflict) {
      this.notifyNoFlyZoneViolation(conflict, '删除航点')
      return false
    }

    line.points.splice(vertexIndex, 1)
    this.normalizeRoutePoints(line)
    this.activeVertexInfo = undefined
    this.dragInfo = undefined
    this.updateRouteEntity(line, { rebuildVertex: true })
    return true
  }

  /**
   * 保存编辑并退出编辑模式
   */
  public saveEditRoute(routeId: string | number): boolean {
    const normalizedRouteId = String(routeId)
    const routeItem = this.routesMap.get(normalizedRouteId)
    if (!routeItem) return false

    const conflict = this.findNoFlyZoneConflict(
      routeItem.line.points,
      routeItem.line.isClose,
    )
    if (conflict) {
      this.notifyNoFlyZoneViolation(conflict, '保存航线')
      return false
    }

    this.normalizeRoutePoints(routeItem.line)
    routeItem.backupPoints = undefined
    routeItem.dirty = false

    this.unregisterEditEvents()
    this.unlockEditView(true)
    this.mode = 'selected'
    this.selectedRouteId = normalizedRouteId

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.editPositions = undefined
      routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
        this.getRouteRenderPositions(routeItem.line),
      )
      routeItem.entity.polyline.material = this.selectedLineMaterial as any
      routeItem.entity.polyline.width = new Cesium.ConstantProperty(4)
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = true
      if (entity.point) {
        entity.point.color = new Cesium.ConstantProperty(Cesium.Color.WHITE)
        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.RED)
        entity.point.pixelSize = new Cesium.ConstantProperty(7)
      }
    })

    if (this.onEditStateChanged) {
      this.onEditStateChanged(false)
    }
    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 取消编辑并恢复修改前数据
   */
  public cancelEditRoute(routeId: string | number): boolean {
    const normalizedRouteId = String(routeId)
    const routeItem = this.routesMap.get(normalizedRouteId)
    if (!routeItem) return false

    if (routeItem.backupPoints) {
      routeItem.line.points = JSON.parse(JSON.stringify(routeItem.backupPoints))
      this.normalizeRoutePoints(routeItem.line)
    }

    routeItem.backupPoints = undefined
    routeItem.dirty = false

    this.unregisterEditEvents()
    this.unlockEditView(false)
    this.mode = 'selected'
    this.selectedRouteId = normalizedRouteId

    this.updateRouteEntity(routeItem.line, {
      rebuildVertex: true,
      silent: true,
    })

    const newRouteItem = this.routesMap.get(normalizedRouteId)
    if (newRouteItem) {
      newRouteItem.dirty = false
      if (newRouteItem.entity && newRouteItem.entity.polyline) {
        newRouteItem.entity.polyline.material = this.selectedLineMaterial as any
        newRouteItem.entity.polyline.width = new Cesium.ConstantProperty(4)
      }
      newRouteItem.vertexEntities.forEach((entity) => {
        entity.show = true
        if (entity.point) {
          entity.point.color = new Cesium.ConstantProperty(Cesium.Color.WHITE)
          entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.RED)
          entity.point.pixelSize = new Cesium.ConstantProperty(7)
        }
      })
    }

    if (this.onRouteChanged) {
      this.onRouteChanged(routeItem.line)
    }
    if (this.onEditStateChanged) {
      this.onEditStateChanged(false)
    }

    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 解绑编辑交互事件
   */
  public unregisterEditEvents(): void {
    this.clearSelectedEditVertex()
    this.hideEditVertexMenu()
    this.endVertexDrag()

    if (this.editHandler && !this.editHandler.isDestroyed()) {
      this.editHandler.destroy()
    }
    this.editHandler = undefined

    if (this.editKeydownHandler) {
      window.removeEventListener('keydown', this.editKeydownHandler)
      this.editKeydownHandler = undefined
    }

    if (this.editPreventContextMenu) {
      this.viewer.scene.canvas.removeEventListener(
        'contextmenu',
        this.editPreventContextMenu,
      )
      this.editPreventContextMenu = undefined
    }

    this.activeVertexInfo = undefined
    this.dragInfo = undefined
    this.restoreCameraControls()
  }

  public disableCameraControls(): void {
    const controller = this.viewer.scene.screenSpaceCameraController
    if (!this.cameraControllerBackup) {
      this.cameraControllerBackup = {
        enableInputs: controller.enableInputs,
        enableRotate: controller.enableRotate,
        enableTranslate: controller.enableTranslate,
        enableZoom: controller.enableZoom,
        enableTilt: controller.enableTilt,
        enableLook: controller.enableLook,
      }
    }
    controller.enableRotate = false
    controller.enableTranslate = false
    controller.enableZoom = false
    controller.enableTilt = false
    controller.enableLook = false
  }

  public restoreCameraControls(): void {
    if (!this.cameraControllerBackup) return
    const controller = this.viewer.scene.screenSpaceCameraController
    controller.enableInputs = this.cameraControllerBackup.enableInputs
    controller.enableRotate = this.cameraControllerBackup.enableRotate
    controller.enableTranslate = this.cameraControllerBackup.enableTranslate
    controller.enableZoom = this.cameraControllerBackup.enableZoom
    controller.enableTilt = this.cameraControllerBackup.enableTilt
    controller.enableLook = this.cameraControllerBackup.enableLook
    this.cameraControllerBackup = undefined
  }

  public getRouteBoundingSphere(line: Airline): Cesium.BoundingSphere | undefined {
    if (!line || !Array.isArray(line.points) || line.points.length === 0) {
      return undefined
    }

    const positions = line.points
      .filter((pt) => {
        const lon = Number(pt.lon)
        const lat = Number(pt.lat)
        const alt = Number(pt.alt || 0)
        return (
          Number.isFinite(lon) &&
          Number.isFinite(lat) &&
          Number.isFinite(alt) &&
          lon >= -180 &&
          lon <= 180 &&
          lat >= -90 &&
          lat <= 90
        )
      })
      .map((pt) => {
        return Cesium.Cartesian3.fromDegrees(
          Number(pt.lon),
          Number(pt.lat),
          Number(pt.alt || 0),
        )
      })

    if (positions.length === 0) return undefined
    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions)
    if (!boundingSphere || !boundingSphere.center || !Number.isFinite(boundingSphere.radius)) {
      return undefined
    }
    return boundingSphere
  }

  public focusRouteForEdit(
    line: Airline,
    { duration = 0.6, complete, cancel }: { duration?: number; complete?: () => void; cancel?: () => void } = {},
  ): boolean {
    const boundingSphere = this.getRouteBoundingSphere(line)
    if (!boundingSphere) {
      complete?.()
      return false
    }

    const radius = Math.max(boundingSphere.radius, 100)
    const range = Math.max(radius * 3, 800)

    this.viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration,
      offset: new Cesium.HeadingPitchRange(
        this.viewer.camera.heading,
        this.editViewPitch,
        range,
      ),
      complete,
      cancel,
    })

    return true
  }

  /**
   * 启动航线交互绘制流程
   */
  public start(): Promise<[any[], Cesium.Entity[]]> {
    this.mode = 'drawing'
    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []
    this.drawNoFlyZoneConflict = undefined

    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true

    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true

    this.preventContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }
    this.viewer.scene.canvas.addEventListener(
      'contextmenu',
      this.preventContextMenu,
    )

    this.keydownHandler = (event: KeyboardEvent) => {
      if (this.mode !== 'drawing') return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        this.undoLastPoint()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        this.finishDraw()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelDraw('绘制已取消')
        return
      }
      if (event.key === 'Delete') {
        event.preventDefault()
        this.clearCurrentDrawing()
        return
      }
    }
    window.addEventListener('keydown', this.keydownHandler)

    return new Promise((resolve, reject) => {
      this.drawResolve = resolve
      this.drawReject = reject

      // 左键添加航点
      this.handler?.setInputAction((e: any) => {
        this.hideDrawMenu()
        const position = this.getCartesianFromScreen(e.position)
        if (!position) return

        const candidatePositions = [...this.positions, position]
        const conflict = this.findNoFlyZoneConflict(
          this.getCartesianRoutePoints(candidatePositions),
          this.routeParams.isClose,
        )
        if (conflict) {
          this.setDrawNoFlyZoneConflict(conflict)
          this.notifyNoFlyZoneViolation(conflict, '绘制航点')
          return
        }

        this.setDrawNoFlyZoneConflict(null)
        this.positions.push(position)

        if (this.positions.length === 1) {
          this.createLineEntity()
        }

        this.temPositions = [...this.positions]
        this.createVertex(position)
        this.viewer.scene.requestRender()
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

      // 鼠标移动实时渲染临时折线
      this.handler?.setInputAction((e: any) => {
        if (this.positions.length < 1) return
        const position = this.getCartesianFromScreen(e.endPosition)
        if (!position) return

        const conflict = this.findNoFlyZoneConflict(
          this.getCartesianRoutePoints([...this.positions, position]),
          this.routeParams.isClose,
        )
        this.setDrawNoFlyZoneConflict(conflict)

        if (this.routeParams.isClose && this.positions.length >= 2) {
          this.temPositions = [...this.positions, position, this.positions[0]]
        } else {
          this.temPositions = [...this.positions, position]
        }
        this.viewer.scene.requestRender()
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

      // 右键弹出绘制菜单
      this.handler?.setInputAction((e: any) => {
        this.showDrawMenu(e.position)
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    })
  }

  public getCartesianFromScreen(screenPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
    const ray = this.viewer.camera.getPickRay(screenPosition)
    if (!ray) return undefined

    let position = this.viewer.scene.globe.pick(ray, this.viewer.scene)
    if (!position) {
      position = this.viewer.scene.camera.pickEllipsoid(
        screenPosition,
        this.viewer.scene.globe.ellipsoid,
      )
    }
    if (!position) {
      try {
        position = this.viewer.scene.pickPosition(screenPosition)
      } catch (_error) {
        position = undefined
      }
    }
    return position
  }

  public showDrawMenu(screenPosition: Cesium.Cartesian2): void {
    this.hideDrawMenu()
    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = '9999'
    menu.style.minWidth = '88px'
    menu.style.background = '#1f1f1f'
    menu.style.border = '1px solid #555'
    menu.style.borderRadius = '8px'
    menu.style.padding = '4px 0'
    menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
    menu.style.fontSize = '14px'
    menu.style.color = '#fff'

    const createItem = (text: string, callback: () => void, disabled = false) => {
      const item = document.createElement('div')
      item.innerText = text
      item.style.padding = '8px 12px'
      item.style.cursor = disabled ? 'not-allowed' : 'pointer'
      item.style.opacity = disabled ? '0.45' : '1'

      if (!disabled) {
        item.onmouseenter = () => {
          item.style.background = '#333'
        }
        item.onmouseleave = () => {
          item.style.background = 'transparent'
        }
        item.onclick = () => {
          this.hideDrawMenu()
          callback()
        }
      }
      return item
    }

    menu.appendChild(
      createItem(
        '回撤一步',
        () => this.undoLastPoint(),
        this.positions.length === 0,
      ),
    )

    menu.appendChild(
      createItem(
        '清空重画',
        () => this.clearCurrentDrawing(),
        this.positions.length === 0,
      ),
    )
    menu.appendChild(
      createItem('取消绘制', () => this.cancelDraw('绘制已取消'), false),
    )

    menu.appendChild(
      createItem(
        '结束绘制',
        () => this.finishDraw(),
        this.positions.length < this.getMinimumRoutePointCount(),
      ),
    )

    document.body.appendChild(menu)
    this.drawMenuEl = menu
  }

  public hideDrawMenu(): void {
    if (this.drawMenuEl && this.drawMenuEl.parentNode) {
      this.drawMenuEl.parentNode.removeChild(this.drawMenuEl)
    }
    this.drawMenuEl = undefined
  }

  public undoLastPoint(): void {
    if (this.mode !== 'drawing') return
    if (this.positions.length === 0) return

    this.setDrawNoFlyZoneConflict(null)
    this.positions.pop()

    const lastVertex = this.vertexEntities.pop()
    if (lastVertex) {
      this.viewer.entities.remove(lastVertex)
    }

    if (this.positions.length === 0) {
      if (this.lineEntity) {
        this.viewer.entities.remove(this.lineEntity)
        this.lineEntity = undefined
      }
      this.temPositions = []
    } else {
      this.temPositions = [...this.positions]
    }

    this.viewer.scene.requestRender()
  }

  public clearCurrentDrawing(): void {
    if (this.mode !== 'drawing') return
    this.setDrawNoFlyZoneConflict(null)

    if (this.lineEntity) {
      this.viewer.entities.remove(this.lineEntity)
    }
    this.vertexEntities.forEach((entity) => {
      this.viewer.entities.remove(entity)
    })

    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []

    this.viewer.scene.requestRender()
  }

  public finishDraw(): boolean {
    if (this.mode !== 'drawing') return false
    if (this.positions.length < this.getMinimumRoutePointCount()) {
      console.warn(this.getRoutePointCountWarning())
      return false
    }

    const conflict = this.findNoFlyZoneConflict(
      this.getCartesianRoutePoints(this.positions),
      this.routeParams.isClose,
    )
    if (conflict) {
      this.setDrawNoFlyZoneConflict(conflict)
      this.notifyNoFlyZoneViolation(conflict, '结束绘制')
      return false
    }

    const resultCoords = this._Cartesian_degrees(this.positions)
    const resultEntities = [...this.vertexEntities, this.lineEntity].filter(
      Boolean,
    ) as Cesium.Entity[]

    const resolve = this.drawResolve
    this.mode = 'idle'
    this.drawResolve = undefined
    this.drawReject = undefined

    resultEntities.forEach((entity) => {
      this.viewer.entities.remove(entity)
    })

    this.unRegisterEvents()

    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []

    this.viewer.scene.requestRender()
    if (resolve) {
      resolve([resultCoords, resultEntities])
    }
    return true
  }

  public getEntityCartesian(entity: any): Cesium.Cartesian3 | undefined {
    if (!entity || !entity.position) return undefined
    if (entity.position instanceof Cartesian3) {
      return entity.position
    }
    if (typeof entity.position.getValue === 'function') {
      return entity.position.getValue(Cesium.JulianDate.now())
    }
    return undefined
  }

  public getDragCartesianFromScreen(
    screenPosition: Cesium.Cartesian2,
    dragPlane?: Cesium.Plane,
  ): Cesium.Cartesian3 | undefined {
    const ray = this.viewer.camera.getPickRay(screenPosition)
    if (!ray) return undefined

    if (dragPlane) {
      const result = Cesium.IntersectionTests.rayPlane(ray, dragPlane)
      if (result) return result
    }
    return this.getCartesianFromScreen(screenPosition)
  }

  public cancelDraw(reason = '绘制已取消'): void {
    if (this.mode !== 'drawing') return
    this.clearCurrentDrawing()
    this.unRegisterEvents()

    const reject = this.drawReject
    this.mode = 'idle'
    this.drawResolve = undefined
    this.drawReject = undefined

    if (reject) {
      reject(reason)
    }
  }

  public createLineEntity(): void {
    this.lineEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          return this.temPositions
        }, false),
        width: 2,
        material: Cesium.Color.YELLOW,
        depthFailMaterial: Cesium.Color.YELLOW,
        clampToGround: true,
      },
    })
    this.viewer.scene.requestRender()
  }

  public createVertex(position: Cesium.Cartesian3): void {
    const index = this.vertexEntities.length + 1
    const vertexEntity = new Cesium.Entity({
      id: `RouteDrawVertex-${Date.now()}-${index}`,
      position,
      point: {
        color: Cesium.Color.FUCHSIA,
        pixelSize: 8,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: 99000000,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: '航点' + index.toString(),
        font: '18px sans-serif',
        disableDepthTestDistance: 99000000,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    })

    this.vertexEntities.push(vertexEntity)
    this.viewer.entities.add(vertexEntity)
  }

  public unRegisterEvents(): void {
    this.hideDrawMenu()
    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy()
    }
    this.handler = undefined

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = undefined
    }

    if (this.preventContextMenu) {
      this.viewer.scene.canvas.removeEventListener(
        'contextmenu',
        this.preventContextMenu,
      )
      this.preventContextMenu = undefined
    }

    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }

  public endDraw(): void {
    this.unRegisterEvents()
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
    if (this.lineEntity) {
      this.lineEntitys.push(this.lineEntity)
    }
  }

  public clearDisEntity(): void {
    this.lineEntitys.forEach((item) => {
      this.viewer.entities.remove(item)
    })
    this.vertexEntities.forEach((item) => {
      this.viewer.entities.remove(item)
    })
    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []
    this.viewer.scene.requestRender()
  }

  public _Cartesian_degrees(cartesian3Arr: Cesium.Cartesian3[]): any[] {
    const coords: any[] = []
    cartesian3Arr.forEach((item) => {
      const cartographic = Cesium.Cartographic.fromCartesian(
        item,
        Cesium.Ellipsoid.WGS84,
      )
      coords.push({
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        alt: this.routeParams.height,
      })
    })
    return coords
  }

  /**
   * 清空所有在地图上注册的航线与航点
   */
  public clearAllRoutes(): void {
    this.routesMap.forEach((_, routeId) => {
      this.removeRouteEntities(routeId)
    })
    this.routesMap.clear()
    this.selectedRouteId = undefined
    this.mode = 'idle'
    this.viewer.scene.requestRender()
  }

  /**
   * 彻底销毁 RouteManageViewer 实例，移除 postRender 监听、DOM 容器、实体和所有交互事件
   */
  public destroy(): void {
    if (this.mode === 'drawing') {
      this.cancelDraw('绘制已取消')
    }

    this.unregisterEditEvents()
    this.unlockEditView(false)
    this.hideDrawMenu()
    this.hideEditVertexMenu()

    // 移除 postRender 监听器
    if (this.viewer?.scene?.postRender) {
      this.viewer.scene.postRender.removeEventListener(this.updateSegmentLabels)
      this.viewer.scene.postRender.removeEventListener(this.enforceEditViewPitch)
    }

    // 清理航段标签 DOM 容器与元素
    this.clearSegmentLabels()

    if (this.selectHandler && !this.selectHandler.isDestroyed()) {
      this.selectHandler.destroy()
    }
    this.selectHandler = undefined

    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy()
    }
    this.handler = undefined

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = undefined
    }

    if (this.preventContextMenu) {
      this.viewer.scene.canvas.removeEventListener(
        'contextmenu',
        this.preventContextMenu,
      )
      this.preventContextMenu = undefined
    }

    this.restoreCameraControls()

    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.enableCursorStyle = true
    }
  }

  public isCurrentEditingVertex(entity: any): boolean {
    if (!entity) return false
    if (this.mode !== 'editing') return false
    if (!this.selectedRouteId) return false
    return (
      entity._entityType === 'routeVertex' &&
      String(entity._routeId) === String(this.selectedRouteId)
    )
  }

  public setEditVertexNormalStyle(entity: Cesium.Entity): void {
    if (!entity) return
    if (entity.point) {
      entity.point.color = new Cesium.ConstantProperty(Cesium.Color.FUCHSIA)
      entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.WHITE)
      entity.point.outlineWidth = new Cesium.ConstantProperty(2)
      entity.point.pixelSize = new Cesium.ConstantProperty(9)
    }
    if (entity.label) {
      entity.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.WHITE)
      entity.label.backgroundColor = new Cesium.ConstantProperty(
        new Cesium.Color(0.165, 0.165, 0.165, 0.99),
      )
    }
  }

  public setEditVertexSelectedStyle(entity: Cesium.Entity): void {
    if (!entity) return
    if (entity.point) {
      entity.point.color = new Cesium.ConstantProperty(Cesium.Color.YELLOW)
      entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.RED)
      entity.point.outlineWidth = new Cesium.ConstantProperty(2)
      entity.point.pixelSize = new Cesium.ConstantProperty(11)
    }
    if (entity.label) {
      entity.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.YELLOW)
      entity.label.backgroundColor = new Cesium.ConstantProperty(
        new Cesium.Color(0.45, 0.18, 0.05, 0.99),
      )
    }
  }

  public selectEditVertex(entity: any): boolean {
    if (!this.isCurrentEditingVertex(entity)) return false

    if (
      this.selectedEditVertexEntity &&
      this.selectedEditVertexEntity !== entity
    ) {
      this.setEditVertexNormalStyle(this.selectedEditVertexEntity)
    }

    this.selectedEditVertexEntity = entity
    this.selectedEditVertexInfo = {
      routeId: String(entity._routeId),
      vertexIndex: entity._vertexIndex,
      entity,
    }

    this.activeVertexInfo = {
      routeId: String(entity._routeId),
      vertexIndex: entity._vertexIndex,
      entity,
    }

    this.setEditVertexSelectedStyle(entity)
    if (this.onVertexSelected) {
      this.onVertexSelected({
        routeId: String(entity._routeId),
        vertexIndex: entity._vertexIndex,
        entity,
      })
    }

    this.viewer.scene.requestRender()
    return true
  }

  public clearSelectedEditVertex(): void {
    if (this.selectedEditVertexEntity) {
      this.setEditVertexNormalStyle(this.selectedEditVertexEntity)
    }

    this.selectedEditVertexEntity = undefined
    this.selectedEditVertexInfo = undefined
    this.activeVertexInfo = undefined

    if (this.onVertexSelected) {
      this.onVertexSelected(null)
    }
    this.viewer.scene.requestRender()
  }
}

export default RouteManageViewer
