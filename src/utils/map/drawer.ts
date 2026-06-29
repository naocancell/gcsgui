/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-15 08:43:26
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-13 10:49:27
 * @FilePath: \GCSMap\src\utils\drawer.ts
 * @Description: 矢量要素绘制工具类
 */
import {
  Viewer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  CustomDataSource,
  Cartesian3,
  Color,
} from 'cesium'
import { cartesian2ToCartesian3 } from '@/utils/map/coordinate'
import { PointEntity } from '@/utils/map/geometry/pointEntity'
import { PolylineEntity } from '@/utils/map/geometry/polylineEntity'
import { PolygonEntity } from '@/utils/map/geometry/polygonEntity'
class Drawer {
  viewer: Viewer
  type: string
  handler: ScreenSpaceEventHandler
  layer: CustomDataSource
  polyline: PolylineEntity | null
  polygon: PolygonEntity | null
  positions: Cartesian3[] = []
  n_Points: number
  bMove: boolean
  clickTimeout: any
  constructor(viewer: Viewer, type: string) {
    this.viewer = viewer
    this.type = type
    this.handler = new ScreenSpaceEventHandler(this.viewer.canvas)
    this.polyline = null
    this.polygon = null
    this.n_Points = 0
    this.bMove = false
    this.positions = []
    this.clickTimeout = null
    if (viewer.dataSources.getByName(type).length === 0) {
      this.layer = new CustomDataSource(type)
      viewer.dataSources.add(this.layer)
    } else {
      this.layer = viewer.dataSources.getByName(type)[0]
    }
  }
  // 开始绘制
  public start() {
    // 左单击加点
    this.handler.setInputAction(
      this.leftClickCallBack,
      ScreenSpaceEventType.LEFT_CLICK,
    )
    // 移动动态绘制
    this.handler.setInputAction(
      this.moveCallBack,
      ScreenSpaceEventType.MOUSE_MOVE,
    )
    // 左双击结束
    this.handler.setInputAction(
      this.leftDoubleClickCallBack,
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    )
  }
  public end() {
    this.handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
  }
  //左单击回调事件
  private leftClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    // 清除可能已经设置的单击定时器
    clearTimeout(this.clickTimeout)
    console.log('**************************** click')
    // 设置一个新的定时器，用于判断是单击还是双击
    this.clickTimeout = setTimeout(() => {
      console.log('**************************** run')
      const cartesian3 = cartesian2ToCartesian3(this.viewer, event.position)
      if (cartesian3 != undefined) {
        if (this.bMove) {
          this.positions.pop()
          this.bMove = false
        }
        this.positions.push(cartesian3)
        this.createGeometry(this.type)
        // 创建控制点
        const point = new PointEntity(
          this.positions[this.positions.length - 1],
          {
            color: Color.WHITE,
            pixelSize: 6,
          },
        )
        // point.parent = this.polygon!
        this.layer.entities.add(point)

        this.viewer.scene.requestRender() //刷新
      }
    }, 100)
  }
  // 移动回调事件
  private moveCallBack = (event: ScreenSpaceEventHandler.MotionEvent) => {
    const cartesian3 = cartesian2ToCartesian3(this.viewer, event.endPosition)
    if (cartesian3 != undefined) {
      if (this.positions.length >= 1) {
        if (!this.bMove) {
          this.positions.push(cartesian3)
          this.bMove = true
        } else {
          this.positions[this.positions.length - 1] = cartesian3
        }
        if (this.type === 'Polygon') {
          // 多边形创建临时线
          if (this.positions.length === 2) {
            this.createGeometry('Polyline')
          }
          if (this.positions.length > 2) {
            this.polyline!.show = false
          }
        }
      }
      this.viewer.scene.requestRender() //刷新
    }
  }
  // 左双击回调事件
  private leftDoubleClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    // 清除可能已经设置的单击定时器
    clearTimeout(this.clickTimeout)
    console.log('**************************** double click')
    const cartesian3 = cartesian2ToCartesian3(this.viewer, event.position)
    if (cartesian3 != undefined) {
      this.positions.pop()
      this.positions.push(cartesian3)
    }

    this.clearEvent()
    console.log('end:' + this.positions.length.toString())
    console.log(this.positions)
  }
  clearEvent() {
    this.handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    this.handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  }
  // 创建几何体
  createGeometry(type: string) {
    switch (type) {
      case 'Polyline':
        if (this.polyline == null) {
          this.polyline = new PolylineEntity(this.positions)
          this.layer.entities.add(this.polyline)
          // this.viewer.entities.add(this.polyline)
        }
        break
      case 'Polygon':
        if (this.polygon == null) {
          this.polygon = new PolygonEntity(this.positions)
          this.layer.entities.add(this.polygon)
          // this.viewer.entities.add(this.polygon)
          console.log('Polygon created!')
        }
        break
      default:
        break
    }
  }
}

export { Drawer }
