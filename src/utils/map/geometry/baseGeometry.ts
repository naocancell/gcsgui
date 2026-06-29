/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-28 16:22:58
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-22 11:32:00
 * @Description: 几何类抽象基类
 */
import {
  // EntityCollection,
  Entity,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  CustomDataSource,
} from 'cesium'
import { PointEntity } from './pointEntity'
import { EntityOptions } from '@/types/entityoptions'
export abstract class BaseGeometry extends CustomDataSource {
  static ID: number
  //   abstract subId: number
  geometry: Entity | null = null
  positions: Cartesian3[] = []
  controlPointsID: string[] = [] //存储
  options: EntityOptions = {
    // id: 'Point' + String(PointEntity.ID),
    // name: 'Point' + String(PointEntity.ID + 1),
    show: true,
    // pixelSize: 10,
    width: 2,
    color: Color.GREEN,
    outlineWidth: 0,
  }

  constructor() {
    super()
  }
  /**
   * 新增一个节点,默认插入在尾部，
   * @param pos 点坐标
   * @param index 插入的位置，0起步
   * @param bAddControlPoint
   * @bAddControlPoint 是否添加控制点
   */
  public addPoint(
    pos: Cartesian3,
    index: number = -1,
    bAddControlPoint: boolean = true,
  ) {
    if (index === -1) {
      //插入尾部
      this.positions.push(pos)
      if (bAddControlPoint)
        this.createControlPoint(pos, this.positions.length - 1)
    } else if (index >= 0 && index < this.positions.length) {
      this.positions.splice(index, 0, pos)
      if (bAddControlPoint) this.createControlPoint(pos, index)
    } else {
      return
    }
  }
  /**
   * 移除点
   * @param index 移除点的位置
   * @returns
   */
  public removePoint(index: number = -1) {
    if (index === -1 || index === this.positions.length - 1) {
      //移除尾部元素
      this.positions.pop()
    } else if (index >= 0 && index < this.positions.length) {
      this.positions.splice(index, 1)
    } else {
      return
    }
    //移除控制点
    this.removeControlPoint(index)
  }
  /**
   * 修改某点的坐标
   * @param pos 修改点的坐标
   * @param index 修改点的位置
   */
  public modifyPoint(pos: Cartesian3, index: number) {
    if (index === -1) {
      index = this.positions.length - 1
    }
    if (index >= 0 && index < this.positions.length) {
      this.positions.splice(index, 1, pos)
      if (this.controlPointsID[index]) {
        //修改控制点坐标
        const point = this.entities.getById(this.controlPointsID[index])
        if (point) {
          point.position = new ConstantPositionProperty(pos)
        }
      }
    }
  }
  /**
   * 新加一个点
   * @param pos 点的坐标
   * @param index 插入的位置,0起步
   */
  public createControlPoint(pos: Cartesian3, index: number) {
    // if (this.geometry) {
    const point = new PointEntity(pos)
    point.parent = this.geometry!
    point.subId = index
    this.entities.add(point)
    this.controlPointsID.splice(index, 0, point.id)
    // }
  }
  /**
   * 移除控制点
   * @param index 控制点下标号
   */
  public removeControlPoint(index: number) {
    if (index === -1) index = this.controlPointsID.length - 1
    if (this.controlPointsID[index]) {
      this.entities.removeById(this.controlPointsID[index])
      this.controlPointsID.splice(index, 1)
    }
  }
  /**
   * 清空所有控制点
   */
  removeControlPoints() {
    this.controlPointsID.forEach((value) => {
      this.entities.removeById(value)
    })
    this.controlPointsID = []
  }
  /**
   * 设置控制点是否显示
   * @param index 控制点下标号
   * @param bShow 是否显示
   */
  showControlPoint(index: number, bShow: boolean) {
    if (index === -1) index = this.controlPointsID.length - 1
    if (this.controlPointsID[index]) {
      const point = this.entities.getById(this.controlPointsID[index])
      if (point) point.show = bShow
    }
  }
}
