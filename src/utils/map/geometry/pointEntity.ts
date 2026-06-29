/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-28 16:35:33
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-16 13:57:15
 * @Description: 封装的点几何类
 */
import { Entity, Cartesian3, Color, PointGraphics, LabelGraphics } from 'cesium'
import { EntityOptions } from '@/types/entityoptions'
// 点
class PointEntity extends Entity {
  static ID: number = 0
  public subId: number = 0 //用于作为其他几何体的控制点时标记节点号
  public type: number = 0 //用于判断是线上节点(0)还是地表控制点(1)
  options: EntityOptions = {
    id: 'Point' + String(PointEntity.ID),
    name: 'Point' + String(PointEntity.ID + 1),
    show: true,
    pixelSize: 8,
    color: Color.WHITE,
    outlineColor: Color.GREEN,
    outlineWidth: 0,
    // heightReference: HeightReference.NONE,
  }
  constructor(position: Cartesian3, options?: EntityOptions) {
    super({
      position: position,
    })
    this.options = { ...this.options, ...options }
    //点对象
    this.point = new PointGraphics({
      pixelSize: this.options.pixelSize,
      color: this.options.color,
      outlineColor: this.options.outlineColor,
      outlineWidth: this.options.outlineWidth,
      disableDepthTestDistance: 50000,
      // heightReference: this.options.heightReference,
    })
    // 标注对象
    this.label = new LabelGraphics({
      text: this.options.text,
      font: this.options.font,
      pixelOffset: this.options.pixelOffset,
    })

    PointEntity.ID++
  }
}

export { PointEntity }
