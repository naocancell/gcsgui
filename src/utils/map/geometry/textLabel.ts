/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-04-16 18:59:56
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-22 09:11:33
 * @Description:
 */
import {
  Cartesian3,
  Entity,
  Color,
  Viewer,
  Cartesian2,
  HorizontalOrigin,
  VerticalOrigin,
  HeightReference,
} from 'cesium'

/**
 文件描述：文本标注
 创建时间：2024/4/16 11:44
 创建人：Zhaipeixiu
 */
export type textLabelOptions = {
  showBackground?: boolean //显示背景
  backgroundColor?: Color //背景色
  backgroundPadding?: any //padding值
  fillColor: Color
  horizontalOrigin?: any //水平对齐方式
  verticalOrigin?: any //竖直对齐方式
  outlineColor?: any
  outlineWidth?: any
}

export class TextLabel {
  _viewer: Viewer | undefined = undefined
  _defaultStyle: textLabelOptions = {
    showBackground: true, //显示背景
    backgroundColor: Color.BLACK, //背景色
    backgroundPadding: new Cartesian2(10, 10), //padding值
    fillColor: Color.WHITE,
    outlineColor: Color.WHITESMOKE,
    outlineWidth: 1.0,
    horizontalOrigin: HorizontalOrigin.CENTER, //对齐方式
    verticalOrigin: VerticalOrigin.CENTER,
  }
  _cesiumLabel: Entity | undefined = undefined

  // 构造函数，新建label并显示
  constructor(
    viewer: Viewer,
    position: Cartesian3,
    text: string,
    options?: textLabelOptions,
  ) {
    this._viewer = viewer
    this._defaultStyle = { ...this._defaultStyle, ...options }

    this._cesiumLabel = new Entity({
      position: position,
      name: 'default',
      label: {
        text: text,
        scale: 0.6,
        pixelOffset: new Cartesian2(20, -20),
        showBackground: this._defaultStyle.showBackground, //显示背景
        backgroundColor: this._defaultStyle.backgroundColor, //背景色
        backgroundPadding: this._defaultStyle.backgroundPadding, //padding值
        fillColor: this._defaultStyle.fillColor,
        outlineColor: this._defaultStyle.outlineColor,
        outlineWidth: this._defaultStyle.outlineWidth,
        horizontalOrigin: this._defaultStyle.horizontalOrigin, //对齐方式
        verticalOrigin: this._defaultStyle.verticalOrigin,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    })
    this._viewer.entities.add(this._cesiumLabel)
  }

  //移除label
  public remove() {
    if (this._cesiumLabel !== undefined && this._viewer !== null)
      this?._viewer?.entities.remove(this._cesiumLabel)
  }
}
