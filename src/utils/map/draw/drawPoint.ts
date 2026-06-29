/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-27 09:51:04
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-13 10:46:43
 * @Description: 绘制点类
 */
import {
  Viewer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  DataSource,
} from 'cesium'
import { BillBoard } from '../geometry/billboard'
import { cartesian2ToCartesian3 } from '../coordinate'
export default class DrawPoint {
  viewer: Viewer
  handler: ScreenSpaceEventHandler
  markerLayer: DataSource
  constructor(viewer: Viewer) {
    this.viewer = viewer
    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.markerLayer = viewer.dataSources.getByName('Marker')[0]
  }
  //开始绘制
  public start() {
    this.handler.setInputAction(
      this.leftClickCallBack,
      ScreenSpaceEventType.LEFT_CLICK,
    )
  }
  //结束绘制
  public end() {
    this.handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    this.handler.destroy()
  }
  //左键Click事件
  private leftClickCallBack = (
    event: ScreenSpaceEventHandler.PositionedEvent,
  ) => {
    const cartesian3 = cartesian2ToCartesian3(this.viewer, event.position)
    if (cartesian3) {
      this.markerLayer.entities.add(new BillBoard(cartesian3))
      this.viewer.scene.requestRender()
    }
  }
}
