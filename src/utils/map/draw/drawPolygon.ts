/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-04-11 13:53:40
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-12 15:18:40
 * @Description: 绘制多边形
 */
import {
  CallbackProperty,
  Cartesian3,
  Color,
  Entity,
  PolylineDashMaterialProperty,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium'
import { cartesian2ToCartesian3 } from '@/utils/map/coordinate'
import { PolygonEntity } from '../geometry/polygonEntity'
import { getPolygonArea } from '@/utils/map/geocomputation.ts'
import { TextLabel } from '@/utils/map/geometry/textLabel.ts'

export class DrawPolygon {
  viewer: Viewer
  handler: ScreenSpaceEventHandler
  polygon: PolygonEntity | null
  positions: Cartesian3[] = []
  trackingLine: Entity | null
  trackingLinePositions: Cartesian3[] = []
  bMove: boolean = false
  bMeasure = false
  bLongClick: boolean = false
  constructor(viewer: Viewer, isMeasure: boolean = false) {
    this.viewer = viewer
    this.bMeasure = isMeasure
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    this.polygon = null
    this.trackingLine = null
  }
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
  //左单击回调事件
  private leftClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    const pickedObject = this.viewer.scene.pick(event.position)
    // console.log(pickedObject)
    if (pickedObject) {
      //点击同一位置，返回
      if (
        pickedObject.id.id ===
        this.polygon?.controlPointsID[this.positions.length - 1]
      ) {
        console.log('********click the same point')
        return
      }
    }
    console.log('****************leftClick!')
    const cartesian3 = cartesian2ToCartesian3(this.viewer, event.position)
    if (cartesian3 != undefined) {
      if (this.positions.length <= 2) {
        this.positions.push(cartesian3)
        this.trackingLinePositions.push(cartesian3)
      } else {
        this.polygon!.modifyPoint(cartesian3, -1)
        this.polygon!.showControlPoint(-1, true)
        //多创建一个点，用于鼠标移动实时变化
        this.polygon!.addPoint(cartesian3, -1)
        this.polygon!.showControlPoint(-1, false)

        this.trackingLinePositions[2] = cartesian3
      }
      this.bMove = true
      this.viewer.scene.requestRender() //刷新
    }
  }
  //移动回调事件
  private moveCallBack = (event: ScreenSpaceEventHandler.MotionEvent) => {
    if (this.bMove) {
      const cartesian3 = cartesian2ToCartesian3(this.viewer, event.endPosition)
      if (cartesian3 != undefined) {
        if (this.positions.length === 1) {
          //更新追踪线坐标
          this.trackingLinePositions[1] = cartesian3
          // this.positions[1] = cartesian3
          if (!this.trackingLine) {
            //创建追踪线对象
            this.trackingLine = this.createTrackingLine(
              this.trackingLinePositions,
            )
            this.viewer.entities.add(this.trackingLine)
          }
        }
        if (this.positions.length === 2) {
          //移除追踪直线
          if (this.trackingLine) {
            this.viewer.entities.remove(this.trackingLine)
          }
          this.positions.push(cartesian3)
          console.log(
            '*********PositionsLength:' + this.positions.length.toString(),
          )
          //创建多边形
          if (!this.polygon) {
            this.polygon = new PolygonEntity(this.positions)
            this.viewer.dataSources.add(this.polygon)
            // 实时移动不显示控制点
            this.polygon.showControlPoint(-1, false)
          }
        }
        //实时改变多边形
        if (this.positions.length >= 3) {
          this.polygon!.modifyPoint(cartesian3, -1)
        }

        this.viewer.scene.requestRender() //刷新
      }
    }
  }

  //左双击回调事件
  private leftDoubleClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    if (!this.polygon) return
    this.bMove = false
    //移除多余的点
    this.polygon.removePoint(-1)
    this.polygon.removePoint(-1)
    if (this.bMeasure) {
      //计算面积
      let area = getPolygonArea(this.positions)
      //添加label
      new TextLabel(
        this.viewer,
        this.getCenter(),
        `面积: ${(area / 1000000).toFixed(2)}k㎡`,
      )
    }
  }

  //创建追踪线
  createTrackingLine(positions: Cartesian3[]) {
    return new Entity({
      polyline: {
        positions: new CallbackProperty(() => {
          return positions
        }, false),
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: Color.GREEN,
          dashLength: 15, //短划线长度
        }),
        clampToGround: true,
      },
    })
  }

  // 获取多边形的外接矩形
  public getRectangle(): Rectangle {
    return Rectangle.fromCartesianArray(this.positions)
  }

  // 获取几何中心
  public getCenter(): Cartesian3 {
    let rec = this.getRectangle()
    return Cartesian3.fromRadians(
      (rec.east + rec.west) / 2,
      (rec.south + rec.north) / 2,
    )
  }
}
