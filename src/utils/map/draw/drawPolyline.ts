/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-27 08:43:44
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-22 16:19:27
 * @Description: 绘制Polyline类
 */
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  Entity,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium'
import {
  cartesian2ToCartesian3,
  cartesian3ToWGS84,
} from '@/utils/map/coordinate'
import { PolylineEntity } from '../geometry/polylineEntity'
import { PointEntity } from '@/utils/map/geometry/pointEntity'
import EditGeometry from '@/utils/map/draw/editGeometry'
import { getDistance } from '@/utils/map/geocomputation.ts'
import { Angle } from '@/utils/map/angle.ts'
import { TextLabel } from '@/utils/map/geometry/textLabel.ts'
import { EntityOptions } from '@/types/entityoptions.ts'

export default class CreatePolyline {
  viewer: Viewer
  handler: ScreenSpaceEventHandler
  polyline: PolylineEntity | null
  dashLine: Entity | null
  trackingLine: Entity | null
  trackingLinePositions: Cartesian3[] = []
  controlPoints: Entity[] | null
  modifyPoint: any = null
  clickedGeometry: Entity | null = null
  moveSelectedPoint: PointEntity | null = null
  positions: Cartesian3[] = []
  pointNum: number = 0
  bMove: boolean = false
  bMeasure: boolean | undefined = false //是否处于测距模式
  totalDistance: number = 0
  bLongClick: boolean = false
  clickTimeout: any
  altitudeOffset: number = 20 //相对高度
  vDashLinePosition: Cartesian3[][] = [] //垂直辅助线坐标数组
  // 存储第一次点击的信息
  firstClickPosition: Cartesian2 | null = null
  firstClickTime: number | null = null
  defaultStyle: EntityOptions = {
    // id: 'Polyline' + String(PolylineEntity.id),
    // name: 'Polyline' + String(PolylineEntity.id + 1),
    show: true,
    width: 2,
    color: Color.GREEN,
  }

  constructor(
    viewer: Viewer,
    bMeasure: boolean = false,
    options?: EntityOptions,
  ) {
    this.viewer = viewer
    this.bMeasure = bMeasure
    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.polyline = null
    this.trackingLine = null
    this.dashLine = null
    this.totalDistance = 0
    this.controlPoints = []
    this.defaultStyle = { ...this.defaultStyle, ...options }
  }
  // 开始绘制
  public start() {
    console.log('Starting polyline')
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
    // 右击回退上一步
    this.handler.setInputAction(
      this.rightClickCallBack,
      ScreenSpaceEventType.RIGHT_CLICK,
    )
  }

  //左单击回调事件
  private leftClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    //根据屏幕坐标判断是否为同一点
    if (this.isSamplePosition(event.position.clone())) return

    let cartesian3 = cartesian2ToCartesian3(this.viewer, event.position)
    if (cartesian3 != undefined) {
      if (!this.polyline) {
        this.polyline = new PolylineEntity(this.positions)
        this.dashLine = this.createTrackingLine(this.positions)
        this.viewer.entities.add(this.dashLine)
        this.viewer.dataSources.add(this.polyline)
      }
      const oldPosition = cartesian3
      //计算高度偏移后的新坐标
      cartesian3 = this.calculateAltitudeOffsetPosition(
        cartesian3,
        this.altitudeOffset,
      )
      this.polyline.addPoint(cartesian3)
      this.pointNum += 1
      this.trackingLinePositions[0] = cartesian3
      //垂直辅助线
      const n = this.positions.length - 1
      this.vDashLinePosition[n] = [oldPosition, cartesian3]
      this.viewer.entities.add(
        this.createTrackingLine(this.vDashLinePosition[n], Color.WHITE),
      )
      //添加地表控制点
      const groundControlPoint = new PointEntity(this.vDashLinePosition[n][0])
      this.viewer.entities.add(groundControlPoint)
      this.bMove = true
      this.viewer.scene.requestRender() //刷新
      // 计算2点距离
      if (this.positions.length >= 2 && this.bMeasure) {
        let distance = getDistance(
          this.positions[this.positions.length - 1],
          this.positions[this.positions.length - 2],
        )
        this.totalDistance += distance
        // 计算2点方位角
        let azimuth = Angle.getAzimuth(
          this.positions[this.positions.length - 2],
          this.positions[this.positions.length - 1],
        )
        // 计算2点的中间点
        let midPoint = Cartesian3.midpoint(
          this.positions[this.positions.length - 1],
          this.positions[this.positions.length - 2],
          new Cartesian3(),
        )
        // 添加label
        let labelText = `距离: ${distance.toFixed(2)}km, 方位角: ${azimuth}°`
        new TextLabel(this.viewer, midPoint, labelText)
      }
    }
  }
  // 移动回调事件
  private moveCallBack = (event: ScreenSpaceEventHandler.MotionEvent) => {
    if (this.bMove) {
      let cartesian3 = cartesian2ToCartesian3(this.viewer, event.endPosition)
      if (cartesian3 != undefined) {
        //计算高度偏移后的新坐标
        cartesian3 = this.calculateAltitudeOffsetPosition(
          cartesian3,
          this.altitudeOffset,
        )
        //更新追踪线坐标
        this.trackingLinePositions[1] = cartesian3
        if (!this.trackingLine) {
          //创建追踪线对象
          this.trackingLine = this.createTrackingLine(
            this.trackingLinePositions,
          )
          this.viewer.entities.add(this.trackingLine)
        }
      }
      this.viewer.scene.requestRender() //刷新
    }
  }
  // 左双击回调事件
  private leftDoubleClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    if (!this.polyline) return
    this.bMove = false
    const cartesian3 = cartesian2ToCartesian3(this.viewer, event.position)
    if (cartesian3 != undefined) {
      // 移除追踪线
      if (!this.trackingLine) {
        this.viewer.entities.remove(this.trackingLine!)
      }
    }

    if (this.bMeasure) {
      // 添加总距离label
      new TextLabel(
        this.viewer,
        this.positions[this.positions.length - 1],
        `总距离: ${this.totalDistance.toFixed(2)}km`,
      )
    }
    this.clearEvent()
    //结束绘制进入编辑模式
    this.polyline.removeControlPoints()
    const editTool = new EditGeometry(this.viewer, this.polyline.geometry!)
    editTool.start()
  }
  //   右击回调事件
  private rightClickCallBack = () => {
    if (!this.controlPoints) return
    if (this.controlPoints.length > 1) {
      const lastPoint = this.positions.pop()
      this.positions[this.positions.length - 1] = lastPoint!
      this.viewer.entities.remove(this.controlPoints.pop() as Entity)
    }
  }

  private clearEvent() {
    this.handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    this.handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  }
  //计算高度偏移后的坐标
  calculateAltitudeOffsetPosition(
    oldPosition: Cartesian3,
    altitudeOffset: number,
  ): Cartesian3 {
    const newGeoPosition = cartesian3ToWGS84(oldPosition)
    newGeoPosition[2] = newGeoPosition[2] + altitudeOffset
    return Cartesian3.fromDegrees(
      newGeoPosition[0],
      newGeoPosition[1],
      newGeoPosition[2],
    )
  }
  //创建追踪线
  createTrackingLine(positions: Cartesian3[], color: Color = Color.GREEN) {
    return new Entity({
      polyline: {
        positions: new CallbackProperty(() => {
          return positions
        }, false),
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: color,
          dashLength: 12, //短划线长度
        }),
        // clampToGround: true,
      },
    })
  }
  //判断点击是否同一位置
  isSamplePosition(clickPosition: Cartesian2) {
    if (this.firstClickPosition) {
      const dist = Cartesian2.distance(this.firstClickPosition, clickPosition)
      if (dist <= 3) {
        console.log('********click the same point0')
        return true
      }
    }
    this.firstClickPosition = clickPosition

    // const pickedObject = this.viewer.scene.pick(clickPosition)
    // if (pickedObject) {
    //   //点击同一位置，返回
    //   if (
    //     pickedObject.id.id ===
    //     this.polyline?.controlPointsID[this.positions.length - 1]
    //   ) {
    //     console.log('********click the same point')
    //     return
    //   }
    // }
    return false
  }
}
