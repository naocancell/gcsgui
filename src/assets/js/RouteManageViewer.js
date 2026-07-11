import { Cartesian3 } from 'cesium'
import * as Cesium from 'cesium'

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
    this.isDrawing = false
    this.drawResolve = undefined
    this.drawReject = undefined
    this.keydownHandler = undefined
    this.preventContextMenu = undefined
    this.drawMenuEl = undefined

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

    // 航线样式
    this.normalLineMaterial = Cesium.Color.ORANGE
    this.selectedLineMaterial = Cesium.Color.DEEPSKYBLUE
    this.editingLineMaterial = Cesium.Color.YELLOW

    this.enableRouteSelect()

    //编辑状态下当前选中的航点
    this.selectedEditVertexEntity = undefined
    this.selectedEditVertexInfo = undefined
  }

  /**
   * 显示并注册航线。
   * 导入航线、绘制航线、已有航线统一采用该方法加载到地图上。
   * @param line Airline
   * @param options
   */
  addAirLine(line, options = {}) {
    if (!line || !line.unicode || !Array.isArray(line.points)) {
      return undefined
    }

    const routeId = String(line.unicode)
    const showVertex = options.showVertex ?? true

    // 避免旧实体和新数据不同步，先移除旧实体
    this.removeRouteEntities(routeId)

    this.normalizeRoutePoints(line)
    //获取所需要的航点用于绘制航线
    const renderPositions = this.getRouteRenderPositions(line)
    //绘制航线实体
    const airlineEntity = new Cesium.Entity({
      name: line.name,
      id: '航线' + routeId,
      polyline: {
        positions: renderPositions,
        width: this.selectedRouteId === routeId ? 4 : 3,
        material:
          this.selectedRouteId === routeId
            ? this.selectedLineMaterial
            : this.normalLineMaterial,
        clampToGround: false,
      },
    })

    airlineEntity._routeId = routeId
    airlineEntity._entityType = 'routeLine'

    this.viewer.entities.add(airlineEntity)

    // 闭合航线只在 polyline 上临时追加首点；
    // 航点实体只按照真实 line.points 创建，不能多创建重复闭合点。
    const vertexEntities = line.points.map((_, index) => {
      return this.createRouteVertexEntity(line, index, showVertex)
    })

    this.routesMap.set(routeId, {
      line,
      entity: airlineEntity,
      vertexEntities,
      backupPoints: undefined,
      dirty: false,
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
   * 只移除地图实体，不删除业务数据。
   */
  removeRouteEntities(routeId) {
    this.viewer.entities.removeById('航线' + routeId)

    const entities = this.viewer.entities.values
    const prefix = routeId + '-航点'

    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i]

      if (entity.id && String(entity.id).startsWith(prefix)) {
        this.viewer.entities.remove(entity)
      }
    }
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

    this.normalizeRoutePoints(line)

    let routeItem = this.routesMap.get(routeId)

    if (!routeItem) {
      this.addAirLine(line)
      routeItem = this.routesMap.get(routeId)
    }

    if (!routeItem) return

    routeItem.line = line

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.name = line.name

      routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
        this.getRouteRenderPositions(line),
      )

      if (this.mode === 'editing' && this.selectedRouteId === routeId) {
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

    const shouldRebuild =
      rebuildVertex || routeItem.vertexEntities.length !== line.points.length

    if (shouldRebuild) {

      //重建航点前，清理旧的选中实体引用
      this.clearSelectedEditVertex()
      routeItem.vertexEntities.forEach((entity) => {
        this.viewer.entities.remove(entity)
      })

      const showVertex =
        this.selectedRouteId === routeId || this.mode === 'editing'

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

        entity.position = new Cesium.ConstantPositionProperty(
          Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0),
        )

        entity._vertexIndex = index

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
   * 规范化航线点数据。
   * 闭合航线不要把首点重复保存到 points 里。
   */
  normalizeRoutePoints(line) {
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
   * 创建正式航线航点实体。
   */
  createRouteVertexEntity(line, index, show = true) {
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
        disableDepthTestDistance: 99000000,
      },
      label: {
        text: '航点 ' + (index + 1),
        font: '2.5rem sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        eyeOffset: new Cartesian3(0, 0, 50),
        horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        scale: 0.4,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.99),
        backgroundPadding: new Cesium.Cartesian2(15, 7),
      },
    })

    vertexEntity._routeId = routeId
    vertexEntity._entityType = 'routeVertex'
    vertexEntity._vertexIndex = index

    this.viewer.entities.add(vertexEntity)

    return vertexEntity
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

      this.selectRoute(entity._routeId)

      const routeItem = this.routesMap.get(String(entity._routeId))

      if (routeItem && this.onRouteSelected) {
        this.onRouteSelected(String(entity._routeId), routeItem.line)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }

  /**
   * 选中航线。
   */
  selectRoute(routeId) {
    routeId = String(routeId)

    if (this.selectedRouteId && this.selectedRouteId !== routeId) {
      this.unselectRoute()
    }

    const routeItem = this.routesMap.get(routeId)
    if (!routeItem) return false

    this.selectedRouteId = routeId
    this.mode = 'selected'

    if (routeItem.entity && routeItem.entity.polyline) {
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

    this.viewer.scene.requestRender()

    return true
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

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.material = this.normalLineMaterial
      routeItem.entity.polyline.width = 3
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = true

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

  // ============================================================
  // 三、航线编辑
  // ============================================================

  /**
   * 进入航线编辑模式。
   */
  startEditRoute(routeId) {
    
    routeId = String(routeId)

    const routeItem = this.routesMap.get(routeId)
    if (!routeItem) return false

    this.selectRoute(routeId)

    routeItem.backupPoints = JSON.parse(JSON.stringify(routeItem.line.points))
    routeItem.dirty = false

    this.mode = 'editing'
    this.selectedRouteId = routeId

    if (routeItem.entity && routeItem.entity.polyline) {
      routeItem.entity.polyline.material = this.editingLineMaterial
      routeItem.entity.polyline.width = 4
    }

    routeItem.vertexEntities.forEach((entity) => {
      entity.show = true

      if (entity.point) {
        entity.point.color = Cesium.Color.FUCHSIA
        entity.point.outlineColor = Cesium.Color.WHITE
        entity.point.pixelSize = 9
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

  this.viewer.scene.canvas.addEventListener(
    'contextmenu',
    this.editPreventContextMenu,
  )

  // 左键按下：选中航点准备拖拽
  this.editHandler.setInputAction((movement) => {
    if (this.mode !== 'editing') return

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

    const dragPlane = Cesium.Plane.fromPointNormal(startCartesian, normal)

    this.dragInfo = {
      routeId: String(entity._routeId),
      vertexIndex: entity._vertexIndex,
      entity,
      dragPlane,
      fixedAlt: this.getPointAlt(String(entity._routeId), entity._vertexIndex),
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

  // 保险：不是当前编辑航线，不允许移动
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

  pt.lon = Cesium.Math.toDegrees(cartographic.longitude)
  pt.lat = Cesium.Math.toDegrees(cartographic.latitude)

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

  if (routeItem.entity && routeItem.entity.polyline) {
    routeItem.entity.polyline.positions = new Cesium.ConstantProperty(
      this.getRouteRenderPositions(line),
    )
  }

  routeItem.dirty = true

  if (this.onRouteChanged) {
    this.onRouteChanged(line)
  }

  this.viewer.scene.requestRender()
}

  /**
   * 结束航点拖拽。
   */
endVertexDrag() {
  if (!this.dragInfo) return

  this.dragInfo = undefined
  this.dragPlane = undefined

  this.restoreCameraControls()

  this.viewer._element.style.cursor = 'default'
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
      line.points.length <= 3,
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

  const projectionInfo = this.findNearestSegmentProjection(line, clickedCartesian)
  if (!projectionInfo) return false

  const {
    insertAfterIndex,
    projectionCartesian,
    t,
  } = projectionInfo

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

    if (!line.points || line.points.length <= 3) {
      console.warn('航线至少需要保留 3 个航点')
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

    this.normalizeRoutePoints(routeItem.line)

    routeItem.backupPoints = undefined
    routeItem.dirty = false

    this.unregisterEditEvents()

    this.mode = 'selected'
    this.selectedRouteId = routeId

    if (routeItem.entity && routeItem.entity.polyline) {
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
   * 解除编辑事件。
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
  disableCameraControls() {
    const controller = this.viewer.scene.screenSpaceCameraController

    if (!this.cameraControllerBackup) {
      this.cameraControllerBackup = {
        enableRotate: controller.enableRotate,
        enableTranslate: controller.enableTranslate,
        enableZoom: controller.enableZoom,
        enableTilt: controller.enableTilt,
        enableLook: controller.enableLook,
      }
    }

    controller.enableRotate = false
    controller.enableTranslate = false
    controller.enableTilt = true
    controller.enableLook = false
  }

  /**
   * 恢复地图相机操作。
   */
  restoreCameraControls() {
    if (!this.cameraControllerBackup) return

    const controller = this.viewer.scene.screenSpaceCameraController

    controller.enableRotate = this.cameraControllerBackup.enableRotate
    controller.enableTranslate = this.cameraControllerBackup.enableTranslate
    controller.enableZoom = this.cameraControllerBackup.enableZoom
    controller.enableTilt = this.cameraControllerBackup.enableTilt
    controller.enableLook = this.cameraControllerBackup.enableLook

    this.cameraControllerBackup = undefined
  }

  /**
   * 绘制航线流程。
   */
  start() {
    if (this.mode === 'editing') {
      return Promise.reject('请先保存或取消当前编辑')
    }
    if (this.isDrawing) {
      this.cancelDraw('上一段未完成绘制已取消')
    }
    //将模式改为正在绘制模式
    this.mode = 'drawing'
    this.isDrawing = true

    //清空初始化临时数据
    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []

    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true//开启深度检测

    this.viewer._element.style.cursor = 'crosshair' //设置鼠标样式
    this.viewer.enableCursorStyle = true
    //组织浏览器默认的右键菜单
    this.preventContextMenu = (event) => {
      event.preventDefault()
    }
    this.viewer.scene.canvas.addEventListener(
      'contextmenu',
      this.preventContextMenu,
    )

    //键盘事件，监听撤销、完成、取消
    this.keydownHandler = (event) => {
      if (!this.isDrawing) return

      const key = event.key.toLowerCase()
      //“撤销”快捷键（Ctrl+Z 或 Mac 上的 Cmd+Z）
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        this.undoLastPoint()//撤销上一个点
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

        this.positions.push(position)

        if (this.positions.length === 1) {
          this.createLineEntity()
        }//创建线实体后就回调绘制

        this.temPositions = [...this.positions]
        this.createVertex(position)//创建点实体后回调绘制

        this.viewer.scene.requestRender()
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

      // 鼠标移动更新临时点的数组
      this.handler.setInputAction((e) => {
        if (this.positions.length < 1) return

        const position = this.getCartesianFromScreen(e.endPosition)
        if (!position) return

        if (this.routeParams.isClose && this.positions.length >= 2) {
          this.temPositions = [...this.positions, position, this.positions[0]]
        } else {
          this.temPositions = [...this.positions, position]
        }

        this.viewer.scene.requestRender()
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

      // 右键弹出绘制菜单
      this.handler.setInputAction((e) => {
        this.showDrawMenu(e.position)//创建原生dom
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    })
  }

  /**
   * 屏幕坐标转世界坐标。
   */
  getCartesianFromScreen(screenPosition) {
    let position

    try {
      position = this.viewer.scene.pickPosition(screenPosition)
    } catch (error) {
      position = undefined
    }

    if (!position) {
      position = this.viewer.scene.camera.pickEllipsoid(
        screenPosition,
        this.viewer.scene.globe.ellipsoid,
      )
    }

    return position
  }

  /**
   * 绘制状态右键菜单。
   */
  showDrawMenu(screenPosition) {
    this.hideDrawMenu()

    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    //创建菜单以及菜单风格
    const menu = document.createElement('div')
    menu.style.position = 'fixed'
    menu.style.left = `${rect.left + screenPosition.x}px`
    menu.style.top = `${rect.top + screenPosition.y}px`
    menu.style.zIndex = 9999
    menu.style.minWidth = '120px'
    menu.style.background = '#1f1f1f'
    menu.style.border = '1px solid #555'
    menu.style.borderRadius = '4px'
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
      createItem(
        '取消绘制',
        () => this.cancelDraw('绘制已取消'),
        false,
      ),
    )

    menu.appendChild(
      createItem(
        '结束绘制',
        () => this.finishDraw(),
        this.positions.length < 3,
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
    if (!this.isDrawing) return
    if (this.positions.length === 0) return

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
    if (!this.isDrawing) return

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
   * 结束绘制。
   */
finishDraw() {
  if (!this.isDrawing) return false

  if (this.positions.length < 3) {
    console.warn('航线不得少于3个航点！')
    return false
  }

  const resultCoords = this._Cartesian_degrees(this.positions)
  const resultEntities = [...this.vertexEntities, this.lineEntity].filter(Boolean)

  // 先保存 resolve
  const resolve = this.drawResolve

  // 先切状态
  this.isDrawing = false
  this.mode = 'idle'
  this.drawResolve = undefined
  this.drawReject = undefined

  // 再移除临时实体
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
    if (!this.isDrawing) return

    this.clearCurrentDrawing()
    this.unRegisterEvents()

    const reject = this.drawReject

    this.isDrawing = false
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
        text: "航点"+index.toString(),
        font: '18px sans-serif',
        disableDepthTestDistance: 99000000,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      }
    })

    this.vertexEntities.push(vertexEntity)
    this.viewer.entities.add(vertexEntity)
  }

  /**
   * 结束绘制的时候解除鼠标和键盘绘制事件。
   */
  unRegisterEvents() {
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
    if (this.isDrawing) {
      this.cancelDraw('绘制已取消')
    }

    this.unregisterEditEvents()
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
 * 判断实体是否是当前编辑航线的航点。
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
    entity.point.outlineWidth = 3
    entity.point.pixelSize = 15
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