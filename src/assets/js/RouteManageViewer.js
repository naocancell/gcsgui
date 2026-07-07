import { Cartesian3, DataSource } from 'cesium'
import * as Cesium from 'cesium'

export default class RouteManageViewer {
  constructor(viewer) {
    this.viewer = viewer
    this.scene = viewer.scene
    this.routeParams = {
      isClose: false,
      height: 0,
    }
    this.positions = []
    this.temPositions = [] // 鼠标移动时产生的临时点
    this.vertexEntities = [] // 节点元素
    this.lineEntity = undefined // 折线元素
    this.lineEntitys = [] // 折线元素数组，每完成一次航线绘制，将折线元素加入此数组
    // 重新设计绘制编辑功能
    this.handler = undefined
    this.isDrawing = false
    this.drawResolve = undefined
    this.drawReject = undefined
    this.keydownHandler = undefined
    this.preventContextMenu = undefined
    this.drawMenuEl = undefined

  }

  /**
   * 显示航线
   * @param line Airline
   */
  addAirLine(line) {
    let res = this.viewer.entities.getById('航线' + line.unicode)
    if (res !== undefined) {
      return res
    }

    let degreesArr = []
    for (let i = 0; i < line.points.length; i++) {
      let coord = new Cartesian3.fromDegrees(
        line.points[i].lon,
        line.points[i].lat,
        line.points[i].alt,
      )
      degreesArr.push(coord)
    }
    if (line.isClose)
      degreesArr.push(
        new Cartesian3.fromDegrees(
          line.points[0].lon,
          line.points[0].lat,
          line.points[0].alt,
        ),
      )

    let airlineEntity = new Cesium.Entity({
      name: line.name,
      id: '航线' + line.unicode,
      polyline: {
        positions: degreesArr,
        width: 3,
        material: Cesium.Color.ORANGE,
        clampToGround: false,
      },
    })
    this.viewer.entities.add(airlineEntity)
    degreesArr.forEach((pt, index) => {
      let vertexEntity = new Cesium.Entity({
        id: line.unicode + '-航点' + (index + 1),
        position: pt,
        point: {
          color: Cesium.Color.WHITE,
          pixelSize: 6,
          outlineColor: Cesium.Color.RED,
          outlineWidth: 2,
          disableDepthTestDistance: 99000000,
        },
        label:
          index === degreesArr.length - 1 && line.isClose
            ? undefined
            : {
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
      this.viewer.entities.add(vertexEntity)
    })

    this.viewer.scene.requestRender()
    return airlineEntity
  }

  /**
   * 删除航线
   * @param line Airline
   */
  removeRoute(line) {
    this.viewer.entities.removeById('航线' + line.unicode)
    const entities = this.viewer.entities.values
    const prefix = line.unicode + '-航点'
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i]
      if (entity.id && String(entity.id).startsWith(prefix)) {
        this.viewer.entities.remove(entity)
      }
    }
    this.viewer.scene.requestRender()
  }

  // -----------------绘制航线相关功能--------------------------//
  //开始绘制
 start() {
  // 如果正在绘制，先取消上一段
  if (this.isDrawing) {
    this.cancelDraw('上一段未完成绘制已取消')
  }

  this.isDrawing = true
  this.positions = []
  this.temPositions = []
  this.vertexEntities = []
  this.lineEntity = undefined
  this.lineEntitys = []

  this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
  this.viewer.scene.globe.depthTestAgainstTerrain = true

  this.viewer._element.style.cursor = 'crosshair'
  this.viewer.enableCursorStyle = true

  // 禁止浏览器默认右键菜单
  this.preventContextMenu = (event) => {
    event.preventDefault()
  }
  this.viewer.scene.canvas.addEventListener('contextmenu', this.preventContextMenu)

  // 键盘快捷键
  this.keydownHandler = (event) => {
    if (!this.isDrawing) return

    const key = event.key.toLowerCase()

    // Ctrl + Z / Command + Z 撤销
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault()
      this.undoLastPoint()
      return
    }

    // Enter 结束绘制
    if (event.key === 'Enter') {
      event.preventDefault()
      this.finishDraw()
      return
    }

    // Esc 取消绘制
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancelDraw('绘制已取消')
      return
    }
  }

  window.addEventListener('keydown', this.keydownHandler)

  return new Promise((resolve, reject) => {
    this.drawResolve = resolve
    this.drawReject = reject

    // 左键添加航点
    this.handler.setInputAction((e) => {
      this.hideDrawMenu()

      const position = this.getCartesianFromScreen(e.position)
      if (!position) return

      this.positions.push(position)

      if (this.positions.length === 1) {
        this.createLineEntity()
      }

      this.temPositions = [...this.positions]
      this.createVertex(position)

      this.viewer.scene.requestRender()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 鼠标移动，更新临时线
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
      this.showDrawMenu(e.position)
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  })
}
//屏幕转世界坐标
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
//右键菜单
showDrawMenu(screenPosition) {
  this.hideDrawMenu()

  const rect = this.viewer.scene.canvas.getBoundingClientRect()

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
      '撤销上一个航点',
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
      '结束绘制',
      () => this.finishDraw(),
      this.positions.length < 3,
    ),
  )

  document.body.appendChild(menu)
  this.drawMenuEl = menu
}
//撤销上一个航点：
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

//清空重画
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
//结束绘制
finishDraw() {
  if (!this.isDrawing) return

  if (this.positions.length < 3) {
    console.warn('航线不得少于3个航点！')
    return
  }

  const resultCoords = this._Cartesian_degrees(this.positions)
  const resultEntities = [...this.vertexEntities, this.lineEntity]
  this.clearDisEntity()//清空缓存的航线（地面残留）
  this.unRegisterEvents()

  const resolve = this.drawResolve

  this.isDrawing = false
  this.drawResolve = undefined
  this.drawReject = undefined


  this.positions = []
  this.temPositions = []
  this.vertexEntities = []
  this.lineEntity = undefined
  this.lineEntitys = []
  this.viewer.scene.requestRender()

  if (resolve) {
    resolve([resultCoords, resultEntities])
  }
  
}
//取消绘制
cancelDraw(reason = '绘制已取消') {
  if (!this.isDrawing) return

  this.clearCurrentDrawing()
  this.unRegisterEvents()

  const reject = this.drawReject

  this.isDrawing = false
  this.drawResolve = undefined
  this.drawReject = undefined

  if (reject) {
    reject(reason)
  }
}

hideDrawMenu() {
  if (this.drawMenuEl) {
    document.body.removeChild(this.drawMenuEl)
    this.drawMenuEl = undefined
  }
}
  //结束绘制
  endDraw() {
    this.unRegisterEvents()
    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
    this.lineEntitys.push(this.lineEntity)
  }

  //清空绘制
  clearDisEntity() {
    //清除折线
    this.lineEntitys.forEach((item) => {
      this.viewer.entities.remove(item)
    })
    //清除节点
    this.vertexEntities.forEach((item) => {
      this.viewer.entities.remove(item)
    })

    this.positions = []
    this.temPositions = [] // 鼠标移动时产生的临时点
    this.vertexEntities = [] // 节点元素
    this.lineEntity = undefined // 折线元素
    this.lineEntitys = [] // 折线元素数组，每完成一次航线绘制，将折线元素加入此数组
  }

  //创建线对象
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
  //创建线节点
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
      label:{
        text: '航点'+index.toString(),
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
        disableDepthTestDistance: 99000000
      }
  })

  this.vertexEntities.push(vertexEntity)
  this.viewer.entities.add(vertexEntity)
}

  //解除鼠标事件（测距）
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
   * 笛卡尔坐标数组转为经纬度坐标数组
   * @param cartesian3Arr 笛卡尔坐标数组
   * @returns {*[]} 经纬度坐标数组
   * @private
   */
  _Cartesian_degrees(cartesian3Arr) {
    let coords = []
    cartesian3Arr.forEach((item) => {
      // 将 Cartesian3 转换为 Cartographic
      let cartographic = Cesium.Cartographic.fromCartesian(
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
}
