import { Cartesian3 } from 'cesium'
import * as Cesium from 'cesium'
import { noFlyZoneService } from '@/utils/map/noFlyZoneService'

export default class RouteManageViewer {
  constructor(viewer) {
    this.viewer = viewer
    this.scene = viewer.scene
    //绘制航线传过来的参数
    this.routeParams = {
      isClose: false,
      height: 0,
    }

    this.dragPlane = undefined

    // false 表示拖拽时允许高度跟随鼠标变化，点会更跟手。
    // true 表示拖拽只改经纬度，高度不变，但在倾斜视角下会有点不完全跟手。
    this.keepAltitudeOnDrag = true
    // ---------------- 绘制状态 ----------------
    //绘制过程中的临时变量(显示地面线)
    this.positions = [] // 绘制过程中的左键点击的点
    this.temPositions = [] // [点1, 点2, 鼠标当前位置]
    this.vertexEntities = [] //临时点的实体
    this.lineEntity = undefined //临时线的实体
    this.lineEntitys = [] //临时线的实体数组

    this.handler = undefined
    this.drawResolve = undefined
    this.drawReject = undefined
    this.keydownHandler = undefined
    this.preventContextMenu = undefined
    this.drawMenuEl = undefined
    this.drawNoFlyZoneConflict = undefined

    // ---------------- 航线编辑状态 ----------------
    this.mode = 'idle'
    // idle | drawing | selected | editing

    //正式航线管理变量 存储
    /**
     * routeId -> {
     *   line, 原始业务数据 line
     *   entity, 地图上的线 entity
     *   vertexEntities,地图上的航点 vertexEntities
     *   backupPoints,编辑前备份 backupPoints
     *   dirty 是否改过 dirty
     * }
     */
    this.routesMap = new Map()

    //选中和编辑相关变量
    this.selectedRouteId = undefined //选中的航线 id
    this.dragInfo = undefined //拖拽的航点信息
    this.activeVertexInfo = undefined //激活的航点

    this.selectHandler = undefined
    this.editHandler = undefined
    this.editKeydownHandler = undefined
    this.editPreventContextMenu = undefined
    this.editMenuEl = undefined

    this.cameraControllerBackup = undefined

    // Vue 页面使用的回调
    this.onRouteSelected = undefined
    this.onRouteChanged = undefined
    this.onEditStateChanged = undefined
    // 当前编辑航点选中回调，可给 Vue 页面用
    this.onVertexSelected = undefined
    this.onNoFlyZoneViolation = undefined
    this.lastNoFlyZoneWarningAt = 0

    // 航线样式
    this.normalLineMaterial = Cesium.Color.ORANGE
    this.selectedLineMaterial = Cesium.Color.DEEPSKYBLUE
    this.editingLineMaterial = Cesium.Color.YELLOW

    this.enableRouteSelect()

    //编辑状态下当前选中的航点
    this.selectedEditVertexEntity = undefined
    this.selectedEditVertexInfo = undefined

    this.segmentLabelMaxCameraDistance = 300000
    this.segmentLabelMinPixelLength = 64
    this.segmentLabelLayer = undefined
    this.routeSegmentLabelEls = new Map()
    this.drawSegmentLabelEls = []
    this.updateSegmentLabels = this.updateSegmentLabels.bind(this)
    this.createSegmentLabelLayer()
    this.viewer.scene.postRender.addEventListener(this.updateSegmentLabels)

    // 编辑视角锁定
    // Cesium 正俯视是 -90°
    this.editViewPitch = Cesium.Math.toRadians(-89.9)

    // 当前是否锁定编辑视角
    this.editViewLocked = false

    // 进入编辑前的相机控制状态
    this.editViewControllerBackup = undefined

    // 进入编辑前的视角，可选择是否恢复
    this.editViewCameraBackup = undefined

    // 绑定后保存固定引用，便于移除事件
    this.enforceEditViewPitch = this.enforceEditViewPitch.bind(this)
  }

  getMinimumRoutePointCount(route = this.routeParams) {
    return route?.isClose ? 3 : 2
  }

  getRoutePointCountWarning(route = this.routeParams) {
    const minimum = this.getMinimumRoutePointCount(route)
    return `${route?.isClose ? '闭合' : '非闭合'}航线至少需要 ${minimum} 个航点`
  }

  /**
   * 进入编辑模式：
   *
   * 1. 保存原来的相机控制状态；
   * 2. 把当前航线移动到屏幕中央；
   * 3. 调整为正俯视；
   * 4. 到达后只锁定俯仰角，不锁定中心位置。
   */
  lockEditView(line) {
    if (this.editViewLocked) return

    const camera = this.viewer.camera
    const scene = this.viewer.scene
    const controller = scene.screenSpaceCameraController

    // 保存进入编辑前的相机控制状态
    this.editViewControllerBackup = {
      enableInputs: controller.enableInputs,

      enableRotate: controller.enableRotate,

      enableTranslate: controller.enableTranslate,

      enableZoom: controller.enableZoom,

      enableTilt: controller.enableTilt,

      enableLook: controller.enableLook,
    }

    // 保存进入编辑前的相机位置和姿态
    this.editViewCameraBackup = {
      destination: Cesium.Cartesian3.clone(camera.positionWC),

      heading: camera.heading,

      pitch: camera.pitch,

      roll: camera.roll,
    }

    this.editViewLocked = true

    // 编辑状态允许旋转、缩放和平移
    controller.enableInputs = true
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableZoom = true

    // 不允许改变俯仰角和自由观察
    controller.enableTilt = false
    controller.enableLook = false

    // 聚焦过程中先不要注册每帧校正，
    // 否则可能与 flyToBoundingSphere 动画互相冲突。
    scene.postRender.removeEventListener(this.enforceEditViewPitch)

    const finishFocus = () => {
      // 如果飞行过程中已经退出了编辑，不能重新注册锁定
      if (!this.editViewLocked) return
      if (this.mode !== 'editing') return

      // 到达后校正一次
      this.enforceEditViewPitch()

      scene.requestRender()
    }

    const focused = this.focusRouteForEdit(line, {
      duration: 0.6,
      complete: finishFocus,

      // 用户在飞行动画过程中操作相机可能取消飞行，
      // 取消后仍然进入角度锁定状态。
      cancel: finishFocus,
    })

    // 航线数据无效时，退化为在当前位置切换正俯视
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
   * 编辑期间只锁定俯仰角。
   *
   * 不修改地图中心，所以用户平移之后，
   * 航线可以离开屏幕中央。
   */
  enforceEditViewPitch() {
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
      // 保留用户平移、缩放后的相机位置
      destination: Cesium.Cartesian3.clone(camera.positionWC),

      orientation: {
        // heading 不锁，用户可以旋转
        heading: camera.heading,

        // 始终保持正俯视
        pitch: this.editViewPitch,

        roll: 0,
      },
    })
  }

  /**
   * 解除航线编辑视角锁定。
   *
   * @param restoreView 是否恢复进入编辑前的视角
   */
  unlockEditView(restoreView = false) {
    if (!this.editViewLocked) return

    // 必须先改状态，防止 cancel 回调重新注册角度锁定
    this.editViewLocked = false

    // 如果聚焦动画还未结束，取消动画
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
   * 显示并注册航线。
   * 导入航线、绘制航线、已有航线统一采用该方法加载到地图上。
   * @param line Airline
   * @param options
   */
  addAirLine(line, options = {}) {
    //如果航线不存在、航线唯一编码不存在、航点不是数组，结束并返回
    if (!line || !line.unicode || !Array.isArray(line.points)) {
      return undefined
    }

    const routeId = String(line.unicode)
    const showVertex = options.showVertex ?? true //航点默认是显示
    const visible = line.isVisible !== false //默认显示航线

    line.isVisible = visible

    //移除与航线有关的所有实体entities
    // 避免旧实体和新数据不同步，先移除旧实体
    this.removeRouteEntities(routeId)
    //航线规范化（如航点序号从1开始、是否闭合字段、特征字段）
    this.normalizeRoutePoints(line)
    //获取所需要的航点用于绘制航线（会考虑航线是否闭合）
    const renderPositions = this.getRouteRenderPositions(line)
    //绘制航线实体
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
    //加上type属性（可用于编辑时候判断右键选中的是否是航线）
    airlineEntity._routeId = routeId
    airlineEntity._entityType = 'routeLine'

    this.viewer.entities.add(airlineEntity)

    // 航点实体只按照真实 line.points 创建，不能多创建重复闭合点。
    const vertexEntities = line.points.map((_, index) => {
      return this.createRouteVertexEntity(line, index, showVertex && visible)
    })
    //所有航线都会保存一份再map中
    this.routesMap.set(routeId, {
      line, //航线本身原始数据（AirLine）
      entity: airlineEntity, //航线实体
      vertexEntities, //航点实体
      dirty: false, //是否修改过
      backupPoints: undefined, //存储编辑前的航点用于取消编辑恢复

      // 编辑拖拽时给 CallbackProperty 用
      editPositions: undefined,
      visible, //是否可见
    })

    this.viewer.scene.requestRender()

    return airlineEntity
  }

  /**
   * 删除航线。
   * @param line Airline
   */
  removeRoute(line) {
    if (!line || !line.unicode) return

    const routeId = String(line.unicode)

    if (this.selectedRouteId === routeId && this.mode === 'editing') {
      this.unregisterEditEvents()
    }
    //移除与航线有关的所有实体entities
    this.removeRouteEntities(routeId)
    this.routesMap.delete(routeId)
    //如果删除的是正在选中的航线 清除选中，地图交互模式改成空闲状态
    if (this.selectedRouteId === routeId) {
      this.selectedRouteId = undefined
      this.mode = 'idle'
      /*onEditStateChanged是航线管理页面传进来的回调函数 通知编辑状态发生了改变
        航线管理页面是给对象属性赋值传递进来这个回调
        routeManage.onEditStateChanged = (editing: boolean) => {
        isRouteEditing.value = editing
      */
      if (this.onEditStateChanged) {
        this.onEditStateChanged(false) //编辑状态改为false 非编辑状态
      }
    }

    this.viewer.scene.requestRender()
  }

  /**
   * 根据航线唯一编码routesMap从中获取记录这条航线所有信息
   * 从中移除该航线的航线、航点、以及标注entities实体，不删除业务数据。
   */
  removeRouteEntities(routeId) {
    if (!this.viewer?.entities) return

    const routeItem = this.routesMap.get(String(routeId))

    this.viewer.entities.removeById('航线' + routeId)
    this.removeRouteSegmentLabels(routeId)

    if (routeItem?.vertexEntities?.length) {
      routeItem.vertexEntities.forEach((entity) => {
        this.viewer.entities.remove(entity)
      })

      routeItem.vertexEntities = []
    }

    this.viewer.scene.requestRender()
  }

  /**
   * 更新地图上的航线实体。
   * 航线管理面板编辑经纬度、高度、插入点、删除点、拖拽航点后都可以调用。
   * @param line Airline
   * @param options
   */
  updateRouteEntity(line, options = {}) {
    if (!line || !line.unicode) return

    const routeId = String(line.unicode)
    const rebuildVertex = options.rebuildVertex ?? true
    const silent = options.silent ?? false
    //再次规范航线数据
    this.normalizeRoutePoints(line)

    let routeItem = this.routesMap.get(routeId)
    //不存在的时候添加这条航线
    if (!routeItem) {
      this.addAirLine(line)
      routeItem = this.routesMap.get(routeId)
    }

    if (!routeItem) return
    //更新航线的一些属性
    routeItem.line = line
    const visible = line.isVisible !== false

    line.isVisible = visible
    routeItem.visible = visible
    //如果这条航线的 Cesium Entity 存在，
    //并且它里面确实有 polyline 线对象，
    //更新这条航线的信息（名字、是否可见）
    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.name = line.name
      routeItem.entity.show = visible
      const isEditingCurrentRoute =
        this.mode === 'editing' && this.selectedRouteId === routeId
      const renderPositions = this.getRouteRenderPositions(line)
      //根据现在是否正在编辑、调整航点是静态的还是动态根据editPositon实时渲染的
      //如果正在编辑
      if (isEditingCurrentRoute) {
        routeItem.editPositions = renderPositions
        //判断现在这个条航线的航点是否已经是动态的

        const hasDynamicPositions =
          routeItem.entity.polyline.positions instanceof Cesium.CallbackProperty
        // 如果航线实体的点不是动态的话，将其换成CallbackProperty的editPositions
        if (!hasDynamicPositions) {
          routeItem.entity.polyline.positions = new Cesium.CallbackProperty(
            () => routeItem.editPositions,
            false,
          )
        }
      } else {
        //如果不是正在编辑编辑，将绘制航点的数据换成静态的
        routeItem.editPositions = undefined
        routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
          renderPositions,
        )
      }
      //根据编辑、选中、空闲状态设置材质
      if (isEditingCurrentRoute) {
        routeItem.entity.polyline.material = this.editingLineMaterial
        routeItem.entity.polyline.width = 4
      } else if (this.selectedRouteId === routeId) {
        routeItem.entity.polyline.material = this.selectedLineMaterial
        routeItem.entity.polyline.width = 4
      } else {
        routeItem.entity.polyline.material = this.normalLineMaterial
        routeItem.entity.polyline.width = 3
      }
    }
    //是否要进行航点重建（如插入、删除会改变航线中点的数量就会和原来的航点数不一致）
    const shouldRebuild =
      rebuildVertex || routeItem.vertexEntities.length !== line.points.length
    //如果需要进行重建
    if (shouldRebuild) {
      //重建航点前，清理旧的选中实体引用
      this.clearSelectedEditVertex()
      routeItem.vertexEntities.forEach((entity) => {
        this.viewer.entities.remove(entity)
      })

      const showVertex =
        visible && (this.selectedRouteId === routeId || this.mode === 'editing')
      //从航线数据中进行重建航点
      routeItem.vertexEntities = line.points.map((_, index) => {
        return this.createRouteVertexEntity(line, index, showVertex)
      })
      //开始编辑的时候设置航点编辑样式
      if (this.mode === 'editing' && this.selectedRouteId === routeId) {
        routeItem.vertexEntities.forEach((entity) => {
          this.setEditVertexNormalStyle(entity)
        })
      }
    } else {
      //如果不需要重建航点 直接更新航点的经纬度高度
      routeItem.vertexEntities.forEach((entity, index) => {
        const pt = line.points[index]
        if (!pt) return

        entity.show = visible

        entity.position = new Cesium.ConstantPositionProperty(
          Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0),
        )

        entity._vertexIndex = index

        if (entity.label) {
          entity.label.text = new Cesium.ConstantProperty('航点 ' + (index + 1))
        }
      })
    }
    //数据被修改过 还未保存标记
    routeItem.dirty = true

    if (!silent && this.onRouteChanged) {
      this.onRouteChanged(line)
    }

    this.viewer.scene.requestRender()
  }

  /**
   * 规范化航线点数据。
   * 闭合航线不要把首点重复保存到 points 里。
   */
  normalizeRoutePoints(line) {
    if (!line || !Array.isArray(line.points)) return
    //如果闭合航线数据里末点重复保存了首点，删除重复末点。
    this.removeDuplicatedClosingPoint(line)

    line.points.forEach((pt, index) => {
      pt.nPt = index + 1 //让航线的序号从1开始编号

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
   * 如果闭合航线数据里末点重复保存了首点，删除重复末点。
   */
  removeDuplicatedClosingPoint(line) {
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
   * 获取 polyline 渲染用的位置。
   * 闭合航线临时追加首点，但不修改 line.points。
   */
  getRouteRenderPositions(line) {
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
   * 缩放至指定航线。
   * 比 viewer.flyTo(entity) 更稳定，直接根据航线坐标计算包围球。
   */
  flyToRoute(line, duration = 1.5) {
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

    if (
      !boundingSphere ||
      !boundingSphere.center ||
      !Number.isFinite(boundingSphere.radius)
    ) {
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
   * 创建正式航线航点实体
   */
  createRouteVertexEntity(line, index, show = true) {
    const routeId = String(line.unicode)
    const pt = line.points[index]

    const vertexEntity = new Cesium.Entity({
      id: `${routeId}-航点${index + 1}`, //航点序号是从1开始
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
    //用于判断选中类型、选中的是第几个用于删除
    vertexEntity._routeId = routeId
    vertexEntity._entityType = 'routeVertex'
    vertexEntity._vertexIndex = index

    this.viewer.entities.add(vertexEntity)

    return vertexEntity
  }
  //以下函数用于创建、更新、 显示距离和方位角的标签
  createSegmentLabelLayer() {
    if (typeof document === 'undefined') return

    const container = this.viewer.container || this.viewer._element
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

  createSegmentLabelElement() {
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

  ensureLabelElements(labels, count) {
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

  ensureRouteSegmentLabels(routeId, count) {
    let labels = this.routeSegmentLabelEls.get(routeId)

    if (!labels) {
      labels = []
      this.routeSegmentLabelEls.set(routeId, labels)
    }

    return this.ensureLabelElements(labels, count)
  }

  ensureDrawSegmentLabels(count) {
    this.drawSegmentLabelEls = this.ensureLabelElements(
      this.drawSegmentLabelEls,
      count,
    )

    return this.drawSegmentLabelEls
  }

  removeRouteSegmentLabels(routeId) {
    const labels = this.routeSegmentLabelEls.get(String(routeId))
    if (!labels) return

    labels.forEach((label) => {
      if (label && label.parentNode) {
        label.parentNode.removeChild(label)
      }
    })

    this.routeSegmentLabelEls.delete(String(routeId))
  }

  clearSegmentLabels() {
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

  updateSegmentLabels() {
    if (!this.segmentLabelLayer) return

    const activeRouteIds = new Set()

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

  getLineSegmentLabelData(line) {
    if (!line?.points || line.points.length < 2) return []

    return this.getPositionsSegmentLabelData(this.getRouteRenderPositions(line))
  }

  getPositionsSegmentLabelData(positions) {
    if (!Array.isArray(positions) || positions.length < 2) return []

    const segments = []
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

  computeSegmentMetrics(start, end) {
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
    } catch (error) {
      return undefined
    }
  }

  formatDistanceKm(value) {
    return Number(value || 0).toFixed(2)
  }

  formatBearingDeg(value) {
    return String(Math.round(Number(value || 0)) % 360)
  }

  formatSegmentLabel(segment) {
    const baseText =
      `${this.formatDistanceKm(segment.distanceKm)} km, ` +
      `${this.formatBearingDeg(segment.bearingDeg)}°`

    if (segment.totalKm == null) return baseText

    return `${baseText} （total：${this.formatDistanceKm(segment.totalKm)} km）`
  }

  renderSegmentLabels(segments, labels) {
    labels.forEach((label, index) => {
      const segment = segments[index]

      if (!segment) {
        label.style.display = 'none'
        return
      }

      this.renderSegmentLabel(segment, label)
    })
  }

  renderSegmentLabel(segment, label) {
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

    if (
      !this.shouldShowSegmentLabel(segment, startWindow, endWindow, pixelLength)
    ) {
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

  shouldShowSegmentLabel(segment, startWindow, endWindow, pixelLength) {
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
      segment.start,
      segment.end,
      new Cesium.Cartesian3(),
    )
    const cameraDistance = Cesium.Cartesian3.distance(
      this.viewer.camera.positionWC,
      midpoint,
    )

    return cameraDistance <= this.segmentLabelMaxCameraDistance
  }

  // ============================================================
  // 二、航线选中
  // ============================================================

  /**
   * 注册地图点击选中航线。
   */
  enableRouteSelect() {
    if (this.selectHandler && !this.selectHandler.isDestroyed()) {
      this.selectHandler.destroy()
    }

    this.selectHandler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    )

    this.selectHandler.setInputAction((movement) => {
      if (this.mode === 'drawing') return
      if (this.mode === 'editing') return

      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id

      if (!entity || entity._entityType !== 'routeVertex') return

      // 只允许拖拽当前正在编辑的航线航点
      if (String(entity._routeId) !== String(this.selectedRouteId)) {
        return
      }

      if (!this.selectRoute(entity._routeId)) return
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }

  /**
   * 选中航线。
   */
  selectRoute(routeId) {
    routeId = String(routeId)

    const routeItem = this.routesMap.get(routeId)
    if (
      !routeItem ||
      routeItem.visible === false ||
      routeItem.line?.isVisible === false
    ) {
      return false
    }

    if (this.selectedRouteId && this.selectedRouteId !== routeId) {
      this.unselectRoute()
    }

    this.selectedRouteId = routeId
    this.mode = 'selected'

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.material = this.selectedLineMaterial
      routeItem.entity.polyline.width = 4
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = routeItem.visible !== false

      if (entity.point) {
        entity.point.color = Cesium.Color.WHITE
        entity.point.outlineColor = Cesium.Color.RED
        entity.point.pixelSize = 7
      }
    })

    this.viewer.scene.requestRender()

    // 地图点击和代码调用统一从这里通知 Vue 面板同步单选状态。
    if (this.onRouteSelected) {
      this.onRouteSelected(routeId, routeItem.line)
    }

    return true
  }

  findNoFlyZoneConflict(points, isClose = false) {
    return noFlyZoneService.findRouteConflict(points || [], isClose)
  }

  getCartesianRoutePoints(positions) {
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

  notifyNoFlyZoneViolation(conflict, action, throttle = false) {
    if (!conflict) return

    const now = Date.now()
    if (throttle && now - this.lastNoFlyZoneWarningAt < 1200) return
    this.lastNoFlyZoneWarningAt = now

    if (this.onNoFlyZoneViolation) {
      this.onNoFlyZoneViolation({ conflict, action })
    } else {
      console.warn('[RouteManageViewer] 航线与禁飞区冲突', {
        conflict,
        action,
      })
    }
  }

  setDrawNoFlyZoneConflict(conflict) {
    this.drawNoFlyZoneConflict = conflict || undefined
    this.viewer._element.style.cursor = conflict ? 'not-allowed' : 'crosshair'

    if (this.lineEntity?.polyline) {
      const color = conflict ? Cesium.Color.RED : Cesium.Color.YELLOW
      this.lineEntity.polyline.material = color
      this.lineEntity.polyline.depthFailMaterial = color
    }
  }

  /**
   * 取消选中航线。
   */
  unselectRoute() {
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
      routeItem.entity.polyline.material = this.normalLineMaterial
      routeItem.entity.polyline.width = 3
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = visible

      if (entity.point) {
        entity.point.color = Cesium.Color.WHITE
        entity.point.outlineColor = Cesium.Color.RED
        entity.point.pixelSize = 7
      }
    })

    this.selectedRouteId = undefined
    this.mode = 'idle'

    this.viewer.scene.requestRender()
  }

  setRouteVisibility(routeId, visible) {
    routeId = String(routeId)

    if (this.mode === 'drawing' || this.mode === 'editing') return false

    const routeItem = this.routesMap.get(routeId)
    if (!routeItem) return false

    const nextVisible = Boolean(visible)

    routeItem.visible = nextVisible
    routeItem.line.isVisible = nextVisible

    if (!nextVisible && this.selectedRouteId === routeId) {
      this.unselectRoute()
    }

    if (routeItem.entity) {
      routeItem.entity.show = nextVisible
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = nextVisible
    })

    if (!nextVisible) {
      this.removeRouteSegmentLabels(routeId)
    }

    this.viewer.scene.requestRender()
    return true
  }

  isRouteVisible(routeId) {
    const routeItem = this.routesMap.get(String(routeId))

    return Boolean(
      routeItem &&
      routeItem.visible !== false &&
      routeItem.line?.isVisible !== false,
    )
  }

  // 三、航线编辑
  /**
   * 进入航线编辑模式。
   */
  startEditRoute(routeId) {
    routeId = String(routeId)

    const routeItem = this.routesMap.get(routeId)
    if (
      !routeItem ||
      routeItem.visible === false ||
      routeItem.line?.isVisible === false
    ) {
      return false
    }

    if (!this.selectRoute(routeId)) return false
    //做一个深拷贝（用于取消编辑航点时候恢复）
    routeItem.backupPoints = JSON.parse(JSON.stringify(routeItem.line.points))
    routeItem.dirty = false

    this.mode = 'editing'
    this.selectedRouteId = routeId
    // 进入编辑时，当前航线居中并正俯视
    this.lockEditView(routeItem.line)

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.material = this.editingLineMaterial
      routeItem.entity.polyline.width = 4

      // 编辑时使用动态 positions，让线实时跟随航点
      routeItem.editPositions = this.getRouteRenderPositions(routeItem.line)

      routeItem.entity.polyline.positions = new Cesium.CallbackProperty(() => {
        return routeItem.editPositions
      }, false)
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = true

      if (entity.point) {
        entity.point.color = Cesium.Color.FUCHSIA
        entity.point.outlineColor = Cesium.Color.WHITE
        entity.point.pixelSize = 9
      }
    })
    //注册编辑时候的鼠标事件（左键、右键、移动）
    this.registerEditEvents()

    if (this.onEditStateChanged) {
      this.onEditStateChanged(true)
    }

    this.viewer.scene.requestRender()

    return true
  }

  /**
   * 注册航点拖拽、右键删除等编辑事件。
   */
  registerEditEvents() {
    this.unregisterEditEvents()

    this.editHandler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    )

    this.editPreventContextMenu = (event) => {
      event.preventDefault()
    }
    //禁止默认的右键菜单事件
    this.viewer.scene.canvas.addEventListener(
      'contextmenu',
      this.editPreventContextMenu,
    )

    // 左键按下：选中航点准备拖拽
    this.editHandler.setInputAction((movement) => {
      if (this.mode !== 'editing') return
      //直接左键点中航点
      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id

      if (!entity || entity._entityType !== 'routeVertex') return

      // 只允许拖拽当前编辑航线的航点
      if (String(entity._routeId) !== String(this.selectedRouteId)) return

      //左键按下航点时，立即高亮当前航点
      this.selectEditVertex(entity)
      const startCartesian = this.getEntityCartesian(entity)
      if (!startCartesian) return

      const normal = Cesium.Cartesian3.clone(this.viewer.camera.directionWC)
      Cesium.Cartesian3.normalize(normal, normal)
      //根据相机的视角向量创建一个拖拽平面
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
      this.viewer._element.style.cursor = 'move'
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    // 鼠标移动：拖拽航点
    this.editHandler.setInputAction((movement) => {
      if (this.mode !== 'editing') return
      if (!this.dragInfo) return

      const position = this.getDragCartesianFromScreen(
        movement.endPosition,
        this.dragInfo.dragPlane,
      )

      if (!position) return

      this.moveVertex(
        this.dragInfo.routeId,
        this.dragInfo.vertexIndex,
        position,
        {
          silent: true,
        },
      )
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 左键抬起：结束拖拽
    this.editHandler.setInputAction(() => {
      this.endVertexDrag()
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    // 左键单击空白处/非航点：隐藏右键菜单
    // 左键单击：点中航点则高亮，点中其他地方则取消高亮
    this.editHandler.setInputAction((movement) => {
      if (this.mode !== 'editing') return

      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id

      // 点中当前编辑航线的航点：选中并高亮
      if (this.isCurrentEditingVertex(entity)) {
        this.selectEditVertex(entity)
        this.hideEditVertexMenu()
        return
      }

      // 点中空白、航线、其他实体：取消航点高亮
      this.clearSelectedEditVertex()
      this.hideEditVertexMenu()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 右键航点：弹出编辑菜单；右键空白处：隐藏菜单
    // 右键：
    // 1）点中航点 -> 弹航点菜单
    // 2）点中当前编辑航线 -> 弹“添加航点”菜单
    // 3）点中空白 -> 隐藏菜单
    this.editHandler.setInputAction((movement) => {
      if (this.mode !== 'editing') return

      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked && picked.id

      this.hideEditVertexMenu()

      if (!entity) return

      // 右键航点：弹原来的航点菜单
      if (
        entity._entityType === 'routeVertex' &&
        String(entity._routeId) === String(this.selectedRouteId)
      ) {
        //右键航点时也高亮
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

      // 右键当前编辑航线：弹“添加航点”菜单
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

    // Delete 删除当前航点
    this.editKeydownHandler = (event) => {
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

  //获取航点高度
  getPointAlt(routeId, vertexIndex) {
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return 0

    const pt = routeItem.line.points[vertexIndex]
    if (!pt) return 0

    return pt.alt || 0
  }

  /**
   * 拖拽航点。
   */
  moveVertex(routeId, vertexIndex, cartesian) {
    if (this.mode !== 'editing') return

    // 不是当前编辑航线，不允许移动
    if (String(routeId) !== String(this.selectedRouteId)) return

    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return

    const line = routeItem.line
    const pt = line.points[vertexIndex]

    if (!pt) return

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

    if (conflict) {
      this.viewer._element.style.cursor = 'not-allowed'
      this.notifyNoFlyZoneViolation(conflict, '移动航点', true)
      return false
    }

    this.viewer._element.style.cursor = 'move'
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

    // 实时更新动态线数组里的对应点
    if (routeItem.editPositions) {
      routeItem.editPositions[vertexIndex] = newCartesian

      // 如果是闭合航线，并且拖动的是第一个点，
      // 最后一个闭合点也要同步更新
      if (
        line.isClose &&
        vertexIndex === 0 &&
        routeItem.editPositions.length === line.points.length + 1
      ) {
        routeItem.editPositions[routeItem.editPositions.length - 1] =
          newCartesian
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
   * 结束航点拖拽。
   */
  endVertexDrag() {
    if (!this.dragInfo) return

    const routeId = this.dragInfo.routeId

    this.dragInfo = undefined
    this.dragPlane = undefined

    this.restoreCameraControls()

    this.viewer._element.style.cursor = 'default'

    const routeItem = this.routesMap.get(String(routeId))

    if (routeItem && this.onRouteChanged) {
      this.onRouteChanged(routeItem.line)
    }

    this.viewer.scene.requestRender()
  }

  /**
   * 右键航点菜单。
   */
  showEditVertexMenu(screenPosition, routeId, vertexIndex) {
    this.hideEditVertexMenu()

    const routeItem = this.routesMap.get(String(routeId))
    const line = routeItem?.line

    if (!line) return

    const rect = this.viewer.scene.canvas.getBoundingClientRect()

    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = 9999
    menu.style.minWidth = '140px'
    menu.style.background = '#1f1f1f'
    menu.style.border = '1px solid #555'
    menu.style.borderRadius = '4px'
    menu.style.padding = '4px 0'
    menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
    menu.style.fontSize = '14px'
    menu.style.color = '#fff'

    const createItem = (text, callback, disabled = false) => {
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
  showLineInsertMenu(screenPosition, routeId, clickedCartesian) {
    this.hideEditVertexMenu()

    const routeItem = this.routesMap.get(String(routeId))
    const line = routeItem?.line
    if (!line) return

    const rect = this.viewer.scene.canvas.getBoundingClientRect()

    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = 9999
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

  insertVertexAfter(routeId, vertexIndex) {
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

    this.updateRouteEntity(line, {
      rebuildVertex: true,
    })

    return true
  }

  insertVertexOnLine(routeId, clickedCartesian) {
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return false

    const line = routeItem.line
    if (!line?.points || line.points.length < 2) return false

    const projectionInfo = this.findNearestSegmentProjection(
      line,
      clickedCartesian,
    )
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

    const newPt = {
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

    this.updateRouteEntity(line, {
      rebuildVertex: true,
    })

    return true
  }

  findNearestSegmentProjection(line, clickedCartesian) {
    if (!line?.points || line.points.length < 2) return undefined

    const points = line.points
    const segmentCount = line.isClose ? points.length : points.length - 1

    let minDistance = Number.POSITIVE_INFINITY
    let bestResult = undefined

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

  pointToSegmentProjection(point, segStart, segEnd) {
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
  createPointAfter(line, vertexIndex) {
    const points = line.points
    const current = points[vertexIndex]

    if (!current) return undefined

    const newPt = {
      ...current,
    }

    // 闭合航线：点后面是下一个点，最后一个点后面是第一个点
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

    // 非闭合航线：如果后面还有点，插中点
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

    // 非闭合航线：如果是最后一个点，沿最后两个点方向延长一小段
    if (points.length >= 2) {
      const prev = points[points.length - 2]
      const last = points[points.length - 1]

      // 0.25 表示延长最后一段长度的 25%
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

  hideEditVertexMenu() {
    if (this.editMenuEl && this.editMenuEl.parentNode) {
      this.editMenuEl.parentNode.removeChild(this.editMenuEl)
    }

    this.editMenuEl = undefined
  }

  /**
   * 删除航点。
   */
  deleteVertex(routeId, vertexIndex) {
    this.clearSelectedEditVertex()
    const routeItem = this.routesMap.get(String(routeId))
    if (!routeItem) return false

    const line = routeItem.line

    if (
      !line.points ||
      line.points.length <= this.getMinimumRoutePointCount(line)
    ) {
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

    this.updateRouteEntity(line, {
      rebuildVertex: true,
    })

    return true
  }

  /**
   * 保存编辑。
   */
  saveEditRoute(routeId) {
    routeId = String(routeId)

    const routeItem = this.routesMap.get(routeId)
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

    // 先结束拖拽和编辑事件
    this.unregisterEditEvents()

    // 再解除俯视锁定
    this.unlockEditView(true)
    this.mode = 'selected'
    this.selectedRouteId = routeId

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.editPositions = undefined

      routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
        this.getRouteRenderPositions(routeItem.line),
      )

      routeItem.entity.polyline.material = this.selectedLineMaterial
      routeItem.entity.polyline.width = 4
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = true

      if (entity.point) {
        entity.point.color = Cesium.Color.WHITE
        entity.point.outlineColor = Cesium.Color.RED
        entity.point.pixelSize = 7
      }
    })

    if (this.onEditStateChanged) {
      this.onEditStateChanged(false)
    }

    this.viewer.scene.requestRender()

    return true
  }

  /**
   * 取消编辑，恢复进入编辑前的航点。
   */
  cancelEditRoute(routeId) {
    routeId = String(routeId)

    const routeItem = this.routesMap.get(routeId)
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
    this.selectedRouteId = routeId

    this.updateRouteEntity(routeItem.line, {
      rebuildVertex: true,
      silent: true,
    })

    const newRouteItem = this.routesMap.get(routeId)

    if (newRouteItem) {
      newRouteItem.dirty = false

      if (newRouteItem.entity && newRouteItem.entity.polyline) {
        newRouteItem.entity.polyline.material = this.selectedLineMaterial
        newRouteItem.entity.polyline.width = 4
      }

      newRouteItem.vertexEntities.forEach((entity) => {
        entity.show = true

        if (entity.point) {
          entity.point.color = Cesium.Color.WHITE
          entity.point.outlineColor = Cesium.Color.RED
          entity.point.pixelSize = 7
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
   * 解除编辑时候解除鼠标事件
   */
  unregisterEditEvents() {
    // 退出编辑时清除航点选中高亮
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

  /**
   * 拖拽航点时禁用地图相机操作。
   */
  /**
   * 拖拽航点时临时禁止相机操作。
   */
  disableCameraControls() {
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

    // 拖拽航点时不允许相机跟着运动
    controller.enableRotate = false
    controller.enableTranslate = false
    controller.enableZoom = false
    controller.enableTilt = false
    controller.enableLook = false
  }

  /**
   * 恢复拖拽前的相机控制状态。
   */
  restoreCameraControls() {
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

  /**
   * 根据航线计算包围球。
   */
  getRouteBoundingSphere(line) {
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

    if (positions.length === 0) {
      return undefined
    }

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions)

    if (
      !boundingSphere ||
      !boundingSphere.center ||
      !Number.isFinite(boundingSphere.radius)
    ) {
      return undefined
    }

    return boundingSphere
  }

  /**
   * 开始编辑时，把航线移动到屏幕中心并切换为正俯视。
   * 这个方法只负责第一次定位，不会持续锁定航线中心。
   */
  focusRouteForEdit(line, { duration = 0.6, complete, cancel } = {}) {
    const boundingSphere = this.getRouteBoundingSphere(line)

    if (!boundingSphere) {
      complete?.()
      return false
    }

    // 航线很短时设置一个最小观察距离；
    // 航线较长时根据包围球半径自动扩大。
    const radius = Math.max(boundingSphere.radius, 100)

    const range = Math.max(radius * 3, 800)

    this.viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration,

      offset: new Cesium.HeadingPitchRange(
        // 保留当前地图朝向
        this.viewer.camera.heading,

        // Cesium 中正俯视是 -90°
        this.editViewPitch,

        range,
      ),

      complete,
      cancel,
    })

    return true
  }
  /**
   * 绘制航线流程。
   */
  start() {
    // if (this.mode === 'editing') {
    //   return Promise.reject('请先保存或取消当前编辑')
    // }
    // if (this.isDrawing) {
    //   this.cancelDraw('上一段未完成绘制已取消')
    // }
    //将模式改为正在绘制模式
    this.mode = 'drawing'

    //清空初始化临时数据
    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []
    this.drawNoFlyZoneConflict = undefined

    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true //开启深度检测

    this.viewer._element.style.cursor = 'crosshair' //设置鼠标样式
    this.viewer.enableCursorStyle = true
    //阻止浏览器默认右键菜单的回调函数
    this.preventContextMenu = (event) => {
      event.preventDefault()
    }
    this.viewer.scene.canvas.addEventListener(
      'contextmenu',
      this.preventContextMenu,
    )

    //键盘事件回调函数，监听撤销、完成、取消的
    this.keydownHandler = (event) => {
      // 不是绘制模式下就不用注册键盘事件
      if (this.mode !== 'drawing') return

      const key = event.key.toLowerCase()
      //“撤销”快捷键（Ctrl+Z 或 Mac 上的 Cmd+Z）
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        this.undoLastPoint() //撤销上一个点
        return
      }
      //“完成”快捷键（Enter）
      if (event.key === 'Enter') {
        event.preventDefault()
        this.finishDraw()
        return
      }
      //取消绘制快捷键（Esc）
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelDraw('绘制已取消')
        return
      }
      //清空重绘
      if (event.key === 'Delete') {
        event.preventDefault()
        this.clearCurrentDrawing()
        return
      }
    }
    window.addEventListener('keydown', this.keydownHandler)
    //不立即返回结果等点击结束再调用 resolve返回结果
    return new Promise((resolve, reject) => {
      this.drawResolve = resolve
      this.drawReject = reject

      // 左键添加航点事件
      this.handler.setInputAction((e) => {
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
        } //创建线实体后就回调绘制

        this.temPositions = [...this.positions]
        this.createVertex(position) //创建点实体后回调绘制

        this.viewer.scene.requestRender()
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

      // 鼠标移动更新临时点的数组
      this.handler.setInputAction((e) => {
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
      this.handler.setInputAction((e) => {
        this.showDrawMenu(e.position) //创建原生dom菜单
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    })
  }

  /**
   * 屏幕坐标转世界坐标。
   */
  getCartesianFromScreen(screenPosition) {
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
      } catch (error) {
        position = undefined
      }
    }

    return position
  }

  /**
   * 绘制状态右键菜单。
   */
  showDrawMenu(screenPosition) {
    this.hideDrawMenu() //先清除菜单

    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    //创建菜单以及菜单风格
    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = 9999
    menu.style.minWidth = '88px'
    menu.style.background = '#1f1f1f'
    menu.style.border = '1px solid #555'
    menu.style.borderRadius = '8px'
    menu.style.padding = '4px 0'
    menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
    menu.style.fontSize = '14px'
    menu.style.color = '#fff'
    //创建菜单内容的函数(第三个参数是什么时候禁用)
    const createItem = (text, callback, disabled = false) => {
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
          this.hideDrawMenu() //点击后隐藏菜单
          callback() //调用回调函数
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
  //移除右键菜单 点击空白区域时候调用
  hideDrawMenu() {
    if (this.drawMenuEl && this.drawMenuEl.parentNode) {
      this.drawMenuEl.parentNode.removeChild(this.drawMenuEl)
    }
    this.drawMenuEl = undefined
  }

  /**
   * 撤销上一个绘制航点。
   */
  undoLastPoint() {
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

  /**
   * 清空当前绘制，但不退出绘制状态。
   */
  clearCurrentDrawing() {
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

  /**
   * 菜单中点击结束绘制才结束绘制。
   */
  finishDraw() {
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
    )

    // 先保存 resolve
    const resolve = this.drawResolve

    // 先切状态
    this.mode = 'idle'
    this.drawResolve = undefined
    this.drawReject = undefined

    // 再移除临时实体防止地面残留
    resultEntities.forEach((entity) => {
      this.viewer.entities.remove(entity)
    })

    // 再解绑事件
    this.unRegisterEvents()

    // 最后清空临时数据
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
  //拖拽
  getEntityCartesian(entity) {
    if (!entity || !entity.position) return undefined

    if (entity.position instanceof Cartesian3) {
      return entity.position
    }

    if (typeof entity.position.getValue === 'function') {
      return entity.position.getValue(Cesium.JulianDate.now())
    }

    return undefined
  }
  getDragCartesianFromScreen(screenPosition, dragPlane) {
    const ray = this.viewer.camera.getPickRay(screenPosition)

    if (!ray) return undefined

    if (dragPlane) {
      const result = Cesium.IntersectionTests.rayPlane(ray, dragPlane)

      if (result) {
        return result
      }
    }

    return this.getCartesianFromScreen(screenPosition)
  }

  /**
   * 取消绘制。
   */
  cancelDraw(reason = '绘制已取消') {
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

  /**
   * 创建绘制过程中的动态线。
   */
  createLineEntity() {
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

  /**
   * 创建绘制过程中的临时航点。
   */
  createVertex(position) {
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

  /**
   * 结束绘制的时候解除鼠标和键盘绘制事件。
   */
  unRegisterEvents() {
    this.hideDrawMenu()
    //Cesium屏幕事件处理器
    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy()
    }

    this.handler = undefined
    //移除绘制时候的键盘事件监听 清空键盘按下回调函数
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = undefined
    }
    //移除阻止右键菜单监听
    if (this.preventContextMenu) {
      this.viewer.scene.canvas.removeEventListener(
        'contextmenu',
        this.preventContextMenu,
      )
      this.preventContextMenu = undefined
    }

    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }

  /**
   * 旧接口兼容。
   */
  endDraw() {
    this.unRegisterEvents()
    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true

    if (this.lineEntity) {
      this.lineEntitys.push(this.lineEntity)
    }
  }

  /**
   * 旧接口兼容：清空临时绘制实体。
   */
  clearDisEntity() {
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

  /**
   * 笛卡尔坐标数组转经纬度数组。
   */
  _Cartesian_degrees(cartesian3Arr) {
    const coords = []

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

  // 五、销毁
  destroy() {
    if (this.mode === 'drawing') {
      this.cancelDraw('绘制已取消')
    }

    this.unregisterEditEvents()
    // 移除编辑视角锁定
    this.unlockEditView(false)

    this.hideDrawMenu()
    this.hideEditVertexMenu()

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

    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }

  /**
   * 判断实体是否是当前编辑航线的航点,
   * 防止编辑非选中航线的航点
   */
  isCurrentEditingVertex(entity) {
    if (!entity) return false
    if (this.mode !== 'editing') return false
    if (!this.selectedRouteId) return false

    return (
      entity._entityType === 'routeVertex' &&
      String(entity._routeId) === String(this.selectedRouteId)
    )
  }

  /**
   * 编辑状态下普通航点样式。
   */
  setEditVertexNormalStyle(entity) {
    if (!entity) return

    if (entity.point) {
      entity.point.color = Cesium.Color.FUCHSIA
      entity.point.outlineColor = Cesium.Color.WHITE
      entity.point.outlineWidth = 2
      entity.point.pixelSize = 9
    }

    if (entity.label) {
      entity.label.fillColor = Cesium.Color.WHITE
      entity.label.backgroundColor = new Cesium.Color(0.165, 0.165, 0.165, 0.99)
    }
  }

  /**
   * 编辑状态下选中航点样式。
   */
  setEditVertexSelectedStyle(entity) {
    if (!entity) return

    if (entity.point) {
      entity.point.color = Cesium.Color.YELLOW
      entity.point.outlineColor = Cesium.Color.RED
      entity.point.outlineWidth = 2
      entity.point.pixelSize = 11
    }

    if (entity.label) {
      entity.label.fillColor = Cesium.Color.YELLOW
      entity.label.backgroundColor = new Cesium.Color(0.45, 0.18, 0.05, 0.99)
    }
  }

  /**
   * 选中编辑状态下的航点，并高亮。
   */
  selectEditVertex(entity) {
    if (!this.isCurrentEditingVertex(entity)) return false

    // 如果之前选中了其他航点，先恢复旧航点样式
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

    // 同步给 Delete 删除逻辑用
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

  /**
   * 取消当前选中的航点高亮。
   */
  clearSelectedEditVertex() {
    if (this.selectedEditVertexEntity) {
      this.setEditVertexNormalStyle(this.selectedEditVertexEntity)
    }

    this.selectedEditVertexEntity = undefined
    this.selectedEditVertexInfo = undefined

    // 点击空白处时，也取消 Delete 当前航点
    this.activeVertexInfo = undefined

    if (this.onVertexSelected) {
      this.onVertexSelected(null)
    }

    this.viewer.scene.requestRender()
  }
}
