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

    // true 表示拖拽只改经纬度，高度不变，但在倾斜视角下会有点不完全跟手。
    this.keepAltitudeOnDrag = true
    // -------- 绘制状态 ---------
    //绘制过程中的临时变量(显示地面线)
    this.positions = [] // 绘制过程中的左键点击的点
    this.temPositions = [] // [点1, 点2, 鼠标当前位置]
    this.vertexEntities = [] //临时点的实体
    this.lineEntity = undefined //临时线的实体
    this.lineEntitys = [] //临时线的实体数组

    this.handler = undefined //绘制过程中的鼠标事件处理器
    this.isDrawing = false //是否正在绘制
    this.drawResolve = undefined //promise resolve
    this.drawReject = undefined  //promise reject
    this.keydownHandler = undefined //键盘事件处理器
    this.preventContextMenu = undefined //阻止浏览器右键
    this.drawMenuEl = undefined //右键绘制菜单

    // ------ 航线编辑状态 ---------
    this.mode = 'idle'
    // idle | drawing | selected | editing

    //正式航线管理map  key: routeId（唯一值）变量存储
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

    // 给 Vue 页面使用的回调
    this.onRouteSelected = undefined
    this.onRouteChanged = undefined
    this.onEditStateChanged = undefined

    // 航线样式
    this.normalLineMaterial = Cesium.Color.ORANGE
    this.selectedLineMaterial = Cesium.Color.DEEPSKYBLUE
    this.editingLineMaterial = Cesium.Color.YELLOW

    this.enableRouteSelect()
  }

 /**
 * 绘制航线  航点、并存储记录到routeMap中
 * 导入航线、绘制航线、已有航线统一采用该方法加载到地图上。
 * @param {Airline} line - 航线数据对象
 * @param {Object} [options] - 可选配置项
 * @returns {Cesium.Entity} airlineEntity - 航线实体
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
    //绘制航线实体（id是 '航线' + routeId,）
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

    airlineEntity._routeId = routeId //航线唯一id
    airlineEntity._entityType = 'routeLine' //用于区分不同实体是航线还是航点

    this.viewer.entities.add(airlineEntity)

    // 闭合航线只在 polyline 上临时追加首点；
    // 航点实体只按照真实 line.points 创建，不能多创建重复闭合点。
    const vertexEntities = line.points.map((_, index) => {
      return this.createRouteVertexEntity(line, index, showVertex)
    })
    //
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
   * 删除航线 删除实体航线 航点 以及对应得记录得数据。
   * @param line 
   */
  removeRoute(line) {
    if (!line || !line.unicode) return

    const routeId = String(line.unicode)
    //如果删除得是正在编辑得航线, 解除编辑
    if (this.selectedRouteId === routeId && this.mode === 'editing') {
      this.unregisterEditEvents()
    }

    //移除航线和航点
    this.removeRouteEntities(routeId)
    //删除map中航线记录
    this.routesMap.delete(routeId)

    //改变编辑状态
    if (this.selectedRouteId === routeId) {
      //删除得是正在编辑的航线  设置为空闲模式
      this.selectedRouteId = undefined
      this.mode = 'idle'
      // 删除被选中的航线后，通知页面现在不是编辑状态,
      if (this.onEditStateChanged) {
        this.onEditStateChanged(false)
      }
    }
    this.viewer.scene.requestRender()
  }

  /**
   * 根据Id移除地图实体entities.removeById，数据由routeMap管理移除。
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
    //不存在就添加到管理页面和地图中
    if (!routeItem) {
      this.addAirLine(line)
      routeItem = this.routesMap.get(routeId)
    }

    if (!routeItem) return
    // 存在就更新线的数据
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
      //移除原来绘制的航点
      routeItem.vertexEntities.forEach((entity) => {
        this.viewer.entities.remove(entity)
      })

      const showVertex =
        this.selectedRouteId === routeId || this.mode === 'editing'
      //重新绘制航点
      routeItem.vertexEntities = line.points.map((_, index) => {
        return this.createRouteVertexEntity(line, index, showVertex)
      })

      if (this.mode === 'editing' && this.selectedRouteId === routeId) {
        routeItem.vertexEntities.forEach((entity) => {
          if (entity.point) {
            entity.point.color = Cesium.Color.FUCHSIA
            entity.point.outlineColor = Cesium.Color.WHITE
            entity.point.pixelSize = 9
          }
        })
      }
    } else {
      //不重建热更新航点 只修改位置
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
   * @param line Airline
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
    const pt = line.points[index]//经度纬度高度

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
    vertexEntity._vertexIndex = index //航点索引 0开始

    this.viewer.entities.add(vertexEntity)

    return vertexEntity
  }

  // 航线选中

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

      if (!entity || !entity._routeId) return

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

  //
  // 航线编辑
  //

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

    const startCartesian = this.getEntityCartesian(entity)

    if (!startCartesian) return

    // 用一个垂直于相机视线、穿过当前航点的平面做拖拽平面
    // 这样鼠标移动到哪里，点就能跟到哪里
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

  // 右键航点：弹出编辑菜单
  this.editHandler.setInputAction((movement) => {
    if (this.mode !== 'editing') return

    const picked = this.viewer.scene.pick(movement.position)
    const entity = picked && picked.id

    if (!entity || entity._entityType !== 'routeVertex') return

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
    controller.enableTilt = false
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
  if (!this.isDrawing) return

  if (this.positions.length < 3) {
    console.warn('航线不得少于3个航点！')
    return
  }
  // 结束绘制，将临时点线转为正式点线resultCoords这是外面真正有用的
  const resultCoords = this._Cartesian_degrees(this.positions)

  const resultEntities = [...this.vertexEntities, this.lineEntity].filter(Boolean)

  // 清除绘制阶段的临时点线，避免地面残留
  resultEntities.forEach((entity) => {
    this.viewer.entities.remove(entity)
  })
  //将
  this.unRegisterEvents()

  const resolve = this.drawResolve

  this.isDrawing = false
  this.mode = 'idle'
  this.drawResolve = undefined
  this.drawReject = undefined

  this.positions = []
  this.temPositions = []
  this.vertexEntities = []
  this.lineEntity = undefined
  this.lineEntitys = []

  this.viewer.scene.requestRender()
  //结束的时候返回结果
  if (resolve) {
    resolve([resultCoords, resultEntities])
  }
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

  // ============================================================
  // 五、销毁
  // ============================================================

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
}