/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-04-11 09:26:56
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-13 10:45:27
 * @Description: 封装的Polygon对象
 */
import {
  Entity,
  Cartesian3,
  Color,
  CallbackProperty,
  PolygonHierarchy,
} from 'cesium'
import { BaseGeometry } from './baseGeometry'
import { EntityOptions } from '@/types/entityoptions'
export class PolygonEntity extends BaseGeometry {
  static ID: number = 0
  //   positions: Cartesian3[] = []
  controlPointsID: string[] = []
  options: EntityOptions = {
    id: 'Polygon' + String(PolygonEntity.ID),
    name: 'Polygon' + String(PolygonEntity.ID + 1),
    show: true,
    width: 2,
    color: Color.RED,
    fillColor: Color.RED.withAlpha(0.5),
    fill: true,
  }
  constructor(ptArr: Cartesian3[], options?: EntityOptions) {
    super()
    this.positions = ptArr
    this.options = { ...this.options, ...options }
    this.geometry = new Entity({
      show: this.options.show,
      name: this.options.name,
      polygon: {
        hierarchy: new CallbackProperty(() => {
          return new PolygonHierarchy(this.positions)
        }, false),
        material: this.options.fillColor, //填充颜色
        fill: this.options.fill, //是否填充
        outline: true,
        // outlineWidth: this.options.width, //线宽
        outlineColor: this.options.color, //线颜色
      },
    })
    this.entities.add(this.geometry)
    // 添加控制点
    ptArr.forEach((pt, index) => {
      this.createControlPoint(pt, index)
    })

    PolygonEntity.ID++
  }
}
