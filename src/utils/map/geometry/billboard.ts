/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-04-10 08:53:12
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-13 10:45:00
 * @Description: 广告牌对象
 */
import { Entity, Cartesian3, Cartesian2, HeightReference } from 'cesium'
import { getMapAssetsFile } from '@/utils/getAssets'
export class BillBoard extends Entity {
  static ID: number = 0
  public subId: number = 0 //用于作为其他几何体的控制点时标记节点号
  constructor(position: Cartesian3) {
    super({
      position: position,
      billboard: {
        show: true,
        image: getMapAssetsFile('marker.svg'),
        width: 32,
        height: 32,
        scale: 1,
        // 设置实体贴地
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // 可能会提高在不同角度下的清晰度
      },
      label: {
        text: 'Maker1',
        font: '32px sans-serif',
        scale: 0.5,
        pixelOffset: new Cartesian2(45, -5),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // 可能会提高在不同角度下的清晰度
      },
    })
  }
}
