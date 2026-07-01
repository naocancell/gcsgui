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
  }

  /**
   * 显示航线
   * @param line Airline  需要传入一个装好的航线
   */
  addAirLine(line) {
    let res = this.viewer.entities.getById('航线' + line.unicode)
    //是否已经绘制过
    if (res !== undefined) {
      return res
    }
    //绘制航线
    let cartesianArr = []
    for (let i = 0; i < line.points.length; i++) {
      let coord = Cartesian3.fromDegrees(
        line.points[i].lon,
        line.points[i].lat,
        line.points[i].alt,
      )
      cartesianArr.push(coord)
    }
    if (line.isClose)
      cartesianArr.push(
        Cartesian3.fromDegrees(
          line.points[0].lon,
          line.points[0].lat,
          line.points[0].alt,
        ),
      )

    let airlineEntity = new Cesium.Entity({
      name: line.name,
      id: '航线' + line.unicode,
      polyline: {
        positions: cartesianArr,
        width: 3,
        material: Cesium.Color.ORANGE,
        clampToGround: false,
      },
    })
    this.viewer.entities.add(airlineEntity)
    cartesianArr.forEach((pt, index) => {
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
          index === cartesianArr.length - 1 && line.isClose
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
  //开始绘制 这个绘制的线和点是临时的  仅仅是负责把点数据收集出来  只绘制了一个临时的航线位置（存在Bug  这个临时航线未清除） 
  start() {
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true//开启深度检测

    //设置鼠标样式
    this.viewer._element.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true
    this.temPositions = []//临时的点
    this.positions = []//保存点的数组
    return new Promise((resolve, reject) => {
      //注册鼠标事件
      //单击鼠标左键画点点击事件
      this.handler.setInputAction((e) => {
        let position = this.viewer.scene.pickPosition(e.position)
        if (!position) {
          const ellipsoid = this.viewer.scene.globe.ellipsoid
          position = this.viewer.scene.camera.pickEllipsoid(
            e.position,
            ellipsoid,
          )
        }
        if (position) {
          this.positions.push(position)
        }
        if (this.positions.length === 1) {
          //首次点击
          this.createLineEntity()
        }
        this.createVertex()
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

      this.handler.setInputAction((e) => {
        if (this.positions.length < 3) {
          this.endDraw()
          this.clearDisEntity()//这是一个类 每次绘制新建了一个类 清空的是本身
          reject('航线不得少于3个航点！')
        } else {
          this.lineEntity.polyline = {
            positions: this.routeParams.isClose
              ? this.positions.concat(this.positions[0])
              : this.positions,
            width: 2,
            material: Cesium.Color.YELLOW,
            depthFailMaterial: Cesium.Color.YELLOW,
          }
          this.endDraw()
          
          resolve([
            this._Cartesian_degrees(this.positions),//返回经纬度坐标数组
            [...this.vertexEntities, this.lineEntity],//点线实体
          ])
          this.clearDisEntity()//清空缓存的航线（地面残留）
        }
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
      //鼠标移动事件
      this.handler.setInputAction((e) => {
        let position = this.viewer.scene.pickPosition(e.endPosition)
        if (!position) {
          position = this.viewer.scene.camera.pickEllipsoid(
            e.startPosition,
            this.viewer.scene.globe.ellipsoid,
          )
        }
        if (this.positions.length >= 1) {
          this.temPositions = this.positions.concat(position)
        }
        this.viewer.scene.requestRender()
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    })
  }

  //结束绘制
  endDraw() {
    this.unRegisterEvents()//注销鼠标事件
    this.viewer._element.style.cursor = 'default'//鼠标样式还原
    this.viewer.enableCursorStyle = true//允许自定义鼠标样式
    this.lineEntitys.push(this.lineEntity)//将折线实体加入线实体数组
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
        positions: new Cesium.CallbackProperty((e) => {
          return this.temPositions
        }, false),
        width: 2,
        material: Cesium.Color.YELLOW,
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    })
    this.viewer.scene.requestRender()
  }
  //小标记点(航点)
  createVertex() { 
    let vertexEntity = new Cesium.Entity({
      id: 'Route' + this.positions[this.positions.length - 1],
      position: this.positions[this.positions.length - 1],
      point: {
        color: Cesium.Color.FUCHSIA,
        pixelSize: 8,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: 99000000,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    })
    this.vertexEntities.push(vertexEntity)
    this.viewer.entities.add(vertexEntity)
  }

  //解除鼠标事件（测距）
  unRegisterEvents() {
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
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
