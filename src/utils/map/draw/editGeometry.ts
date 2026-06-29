/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-27 11:06:45
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-22 16:49:15
 * @Description: 编辑几何体类。操作逻辑
 */
import {
  Viewer,
  ScreenSpaceEventHandler,
  PointGraphics,
  PolylineGraphics,
  Cartesian3,
  ConstantProperty,
  ScreenSpaceEventType,
  Entity,
  ConstantPositionProperty,
  defined,
  CallbackProperty,
  PolylineDashMaterialProperty,
  Color,
  Cartographic,
} from 'cesium'
import { cartesian2ToCartesian3 } from '@/utils/map/coordinate'
import { getClosestPoint, isOnLineSegment } from '@/utils/map/geocomputation'
import { PointEntity } from '@/utils/map/geometry/pointEntity'
export default class EditGeometry {
  viewer: Viewer
  editHandler: ScreenSpaceEventHandler
  geometry: Entity //要编辑的几何对象
  oldPositions: Cartesian3[] = [] //存储未修改前的坐标
  positions: Cartesian3[] = [] //要编辑的几个对象坐标
  controlPointsID: string[] = [] //节点控制点ID数组
  groundPointsID: string[] = [] //地表控制点ID数组
  groundDashLineID: string[] = [] //垂直辅助线ID数组
  groundDashLinesPosition: Cartesian3[][] = [] //垂直辅助线坐标数组
  heightPoint: PointEntity | null = null //高度控制点
  groundPoint: PointEntity | null = null //地表控制点
  clickedGeometry: Entity | null = null
  clickDownPosition: Cartesian3 | null = null
  moveSelectedPoint: PointEntity | null = null
  bDrag: boolean = false //拖动标识
  bLongClick: boolean = false //长按标识
  clickTimeout: any

  constructor(viewer: Viewer, editGeometry: Entity) {
    this.viewer = viewer
    this.editHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.geometry = editGeometry
    this.positions = editGeometry.polyline?.positions?.getValue(
      this.viewer.clock.currentTime,
    )
    this.oldPositions = this.positions
    // 创建控制点
    this.positions.forEach((value, index) => {
      this.createPoint(value, index)
      //地表点
      const groundPosition = this.calculateGroundPosition(value)
      this.createGroundPoint(value, index)
      //垂直辅助线
      const ptArr = [value, groundPosition]
      this.groundDashLinesPosition[index] = ptArr
      this.createGroundDashLine(this.groundDashLinesPosition[index], index)
    })
  }
  public start() {
    this.editHandler.setInputAction(
      this.leftDownClickCallBack,
      ScreenSpaceEventType.LEFT_DOWN,
    )
    this.editHandler.setInputAction(
      this.moveCallBack,
      ScreenSpaceEventType.MOUSE_MOVE,
    )
    this.editHandler.setInputAction(
      this.leftUpClickCallBack,
      ScreenSpaceEventType.LEFT_UP,
    )
  }
  //左键点击回调
  // private leftClickCallBack = (
  //   event: ScreenSpaceEventHandler.PositionedEvent,
  // ) => {
  //   const pickedObject = this.viewer.scene.pick(event.position)
  //   // 点中控制点
  //   if (
  //     defined(pickedObject) &&
  //     defined(pickedObject.id) &&
  //     pickedObject.id.point instanceof PointGraphics
  //   ) {
  //     console.log('You clicked a point entity.')
  //     this.controlPoint = pickedObject.id
  //     console.log(this.controlPoint?.subId)
  //     this.bDrag = true
  //     this.forbidDrawWorld(true)
  //   }
  // }
  //左键按下回调
  private leftDownClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    // 清除可能已经设置的单击定时器
    clearTimeout(this.clickTimeout)
    // 判断是不是长按(100ms)
    this.clickTimeout = setTimeout(() => {
      this.bLongClick = true
    }, 100)
    const pickedObject = this.viewer.scene.pick(event.position)
    //点中实体对象
    if (defined(pickedObject) && defined(pickedObject.id)) {
      // 记录点击的几何对象及位置
      this.clickedGeometry = pickedObject.id
      this.clickDownPosition = this.viewer.scene.pickPosition(event.position)
      // // 判断是否同一实体
      // if (this.geometry != pickedObject.id) {
      //   this.geometry = pickedObject.id
      //   if (
      //     pickedObject instanceof PolylineGraphics &&
      //     pickedObject.positions
      //   ) {
      //     this.oldPositions = this.geometry!.polyline!.positions?.getValue(
      //       this.viewer.clock.currentTime,
      //     )
      //   }
      // }
      // 点中控制点
      if (pickedObject.id.point instanceof PointGraphics) {
        console.log('You clicked a point entity.')
        if (pickedObject.id.point.type === 0) {
          console.log('You clicked a HeightPoint entity.')
          this.heightPoint = pickedObject.id
        } else if (pickedObject.id.point.type === 1) {
          console.log('You clicked a GroundPoint entity.')
          this.groundPoint = pickedObject.id
        }
        // console.log(this.heightPoint?.subId)
        this.bDrag = true
        this.forbidDrawWorld(true)
      }
    }
  }
  //移动回调
  private moveCallBack = (event: ScreenSpaceEventHandler.MotionEvent) => {
    const pickedObject = this.viewer.scene.pick(event.endPosition)
    // 悬停控制点放大
    if (
      pickedObject &&
      pickedObject.id &&
      pickedObject.id.point instanceof PointGraphics
    ) {
      if (pickedObject.id.point instanceof PointGraphics) {
        if (
          this.moveSelectedPoint == null ||
          this.moveSelectedPoint.id !== pickedObject.id.id
        ) {
          this.moveSelectedPoint = pickedObject.id
          this.moveSelectedPoint!.point!.pixelSize = new ConstantProperty(
            this.moveSelectedPoint!.options.pixelSize! + 1,
          )
          // console.log(this.moveSelectedPoint)
        }
        this.viewer.scene.requestRender() //刷新
      }
    } else {
      // 离开控制点恢复原始大小
      if (this.moveSelectedPoint) {
        this.moveSelectedPoint!.point!.pixelSize = new ConstantProperty(
          this.moveSelectedPoint!.options.pixelSize! - 1,
        )
        this.moveSelectedPoint = null
        this.viewer.scene.requestRender() //刷新
      }
    }

    if (!this.heightPoint || !this.bDrag) return
    console.log('************************left down')
    const cartesian3 = cartesian2ToCartesian3(this.viewer, event.endPosition)
    if (cartesian3) {
      // 修改节点坐标
      this.modifyPoint(cartesian3, this.heightPoint.subId)
      // this.geometry?.modifyPoint(cartesian3, this.controlPoint.subId)
      this.viewer.scene.requestRender() //刷新
    }
  }
  //左键松开回调
  private leftUpClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    clearTimeout(this.clickTimeout)
    // 单击添加点
    if (
      !this.bLongClick &&
      this.clickedGeometry?.polyline instanceof PolylineGraphics
    ) {
      console.log('点中线，加点')
      this.addPoint()
    }
    this.bLongClick = false
    this.bDrag = false
    this.forbidDrawWorld(false)
  }
  // 左键双击回调
  private leftDoubleClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    // this.geometry.
  }
  // Viewer操作控制
  forbidDrawWorld(isForbid: boolean) {
    this.viewer.scene.screenSpaceCameraController.enableRotate = !isForbid
    this.viewer.scene.screenSpaceCameraController.enableTilt = !isForbid
    this.viewer.scene.screenSpaceCameraController.enableTranslate = !isForbid
    this.viewer.scene.screenSpaceCameraController.enableInputs = !isForbid
  }
  // 添加点
  addPoint() {
    for (let i = 0; i < this.positions.length - 1; ++i) {
      if (
        isOnLineSegment(
          this.positions[i],
          this.positions[i + 1],
          this.clickDownPosition!,
        )
      ) {
        // 修改线坐标
        const pt = getClosestPoint(
          this.positions[i],
          this.positions[i + 1],
          this.clickDownPosition!,
        )
        this.positions.splice(i + 1, 0, pt)
        // 新建控制点
        this.createPoint(pt, i + 1)
        // 修改控制点的subid
        for (let index = i + 2; index < this.controlPointsID.length; ++index) {
          const point = this.geometry.entityCollection.getById(
            this.controlPointsID[index],
          ) as PointEntity
          point!.subId = point!.subId + 1
        }
        return
      }
    }
  }
  /**
   * 修改某点的坐标
   * @param pos 修改点的坐标
   * @param index 修改点的位置
   */
  modifyPoint(pos: Cartesian3, index: number) {
    // 修改线坐标
    this.positions.splice(index, 1, pos)
    // 修改控制点坐标
    this.heightPoint!.position = new ConstantPositionProperty(pos)
  }
  /**
   * 新加一个节点
   * @param pos 点的坐标
   * @param index 插入的位置,0起步
   */
  createPoint(pos: Cartesian3, index: number) {
    // if (this.geometry) {
    const point = new PointEntity(pos)
    point.parent = this.geometry
    point.subId = index
    this.geometry.entityCollection.add(point)
    this.controlPointsID.splice(index, 0, point.id)
    // }
  }
  /**
   * 新加一个地表控制点
   * @param pos 点的坐标
   * @param index 插入的位置,0起步
   */
  createGroundPoint(pos: Cartesian3, index: number) {
    const point = new PointEntity(pos)
    point.parent = this.geometry
    point.subId = index
    point.type = 1
    this.geometry.entityCollection.add(point)
    this.groundPointsID.splice(index, 0, point.id)
  }
  /**
   * 新加一个垂直地表的辅助线
   * @param pos 直线的坐标
   * @param index 插入的位置,0起步
   */
  createGroundDashLine(positions: Cartesian3[], index: number) {
    const vDashLine = new Entity({
      polyline: {
        positions: new CallbackProperty(() => {
          return positions
        }, false),
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: Color.WHITE,
          dashLength: 12, //短划线长度
        }),
      },
    })
    this.groundDashLineID.splice(index, 0, vDashLine.id)
    this.geometry.entityCollection.add(vDashLine)
  }
  //获取地表坐标
  calculateGroundPosition(pos: Cartesian3) {
    // 输入的当前点的笛卡尔坐标
    const cartographic = Cartographic.fromCartesian(pos)
    // 经度、纬度不变，将地面高度加上需要上升的距离, 假设垂直升高1000米
    cartographic.height -= cartographic.height

    // 最后使用Cesium.Cartographic.toCartesian将刚才得到的Cartographic对象转换为笛卡尔坐标
    return Cartographic.toCartesian(cartographic)
  }
}
