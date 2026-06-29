/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-28 16:49:02
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-16 11:12:08
 * @Description: 封装的Polyline类
 */
import { Entity, Cartesian3, Color, CallbackProperty } from 'cesium'
import { BaseGeometry } from './baseGeometry'
import { EntityOptions } from '@/types/entityoptions'
export class PolylineEntity extends BaseGeometry {
  static ID: number = 0
  //   positions: Cartesian3[] = []
  controlPointsID: string[] = []
  options: EntityOptions = {
    // id: 'Polyline' + String(PolylineEntity.ID),
    name: 'Polyline' + String(PolylineEntity.ID + 1),
    show: true,
    width: 3,
    color: Color.GREEN,
  }
  constructor(ptArr: Cartesian3[], options?: EntityOptions) {
    super()
    this.options = { ...this.options, ...options }
    // console.log(this.options)
    this.positions = ptArr
    // console.log(this.positions)
    // 创建线实体对象
    this.geometry = new Entity({
      name: this.options.name,
      polyline: {
        positions: new CallbackProperty(() => {
          return this.positions
        }, false),
        show: this.options.show,
        width: this.options.width,
        material: this.options.color,
        // depthFailMaterial: new PolylineDashMaterialProperty({
        //   color: Color.GREEN,
        //   dashLength: 15, //短划线长度
        // }),
      },
    })
    this.entities.add(this.geometry)
    // 添加控制点
    ptArr.forEach((pt, index) => {
      this.createControlPoint(pt, index)
    })

    PolylineEntity.ID++
  }
}
