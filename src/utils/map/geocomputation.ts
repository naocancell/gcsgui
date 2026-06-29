/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-22 15:42:49
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-01 14:05:43
 * @Description: 地理计算
 */
import {
  Cartesian3,
  Cartographic,
  EllipsoidGeodesic,
  Math as Cesium_Math,
  Matrix3,
  Matrix4,
  Transforms,
  Viewer,
} from 'cesium'
import { Angle } from '@/utils/map/angle.ts'
import { AirlinePoint } from '@/types/entityoptions.ts'

/**
 * 计算空间中一点到一条直线的最短距离的交点（在不考虑地球曲率的情况下）
 * @param lineStart 直线的起点：[longitude1, latitude1, height1]
 * @param lineEnd 直线的终点:[longitude2, latitude2, height2]
 * @param point 空间中的点:[[longitude3, latitude3, height3]]
 * @returns 最近的交点
 */
function getClosestPoint(
  lineStart: Cartesian3,
  lineEnd: Cartesian3,
  point: Cartesian3,
): Cartesian3 {
  // 计算直线方向向量
  const lineDirection = new Cartesian3()
  Cartesian3.subtract(lineEnd, lineStart, lineDirection)
  Cartesian3.normalize(lineDirection, lineDirection)

  // 计算点到直线起点的向量
  const pointToStart = new Cartesian3()
  Cartesian3.subtract(point, lineStart, pointToStart)

  // 计算投影长度，即点到直线的向量在直线方向向量上的分量长度
  const projectionLength = Cartesian3.dot(pointToStart, lineDirection)

  // 使用标量乘法和向量加法确定交点
  const closestPoint = new Cartesian3()
  Cartesian3.multiplyByScalar(lineDirection, projectionLength, closestPoint)
  Cartesian3.add(lineStart, closestPoint, closestPoint)
  return closestPoint
}

/**
 * 判断一个点是否在直线上（在不考虑地球曲率的情况下）
 * @param lineStart 直线的起点：[longitude1, latitude1, height1]
 * @param lineEnd 直线的起点：[longitude2, latitude2, height2]
 * @param pointToCheck 直线的起点：[longitude3, latitude3, height3]
 * @param tolerance 容差
 * @returns 是否在线段上
 */
function isOnLineSegment(
  lineStart: Cartesian3,
  lineEnd: Cartesian3,
  pointToCheck: Cartesian3,
  tolerance: number = Cesium_Math.EPSILON1,
): boolean {
  const dist_AP = Cartesian3.distance(lineStart, pointToCheck)
  const dist_BP = Cartesian3.distance(lineEnd, pointToCheck)
  const dist_AB = Cartesian3.distance(lineStart, lineEnd)

  const isCollinear = Math.abs(dist_AP + dist_BP - dist_AB) < tolerance
  return isCollinear
  /*
  const startToEnd = new Cartesian3()
  const startToPoint = new Cartesian3()
  const endToPoint = new Cartesian3()

  // 计算向量
  Cartesian3.subtract(lineEnd, lineStart, startToEnd)
  Cartesian3.subtract(pointToCheck, lineStart, startToPoint)
  Cartesian3.subtract(pointToCheck, lineEnd, endToPoint)

  // 判断共线
  const cross = Cartesian3.cross(startToEnd, startToPoint, new Cartesian3())
  console.log('cross:' + Cartesian3.magnitude(cross).toString())
  // Math.EPSILON6 是一个非常小的值，用来防止浮点数计算的误差
  const isCollinear = Cartesian3.magnitude(cross) < tolerance

  // 判断点是否在线段之间
  let isBetween = false
  if (isCollinear) {
    const dotProduct1 = Cartesian3.dot(startToEnd, startToPoint)
    const dotProduct2 = Cartesian3.dot(startToEnd, endToPoint)
    isBetween = dotProduct1 >= 0 && dotProduct2 <= 0
  }
  return isBetween
  */
}

/**
 * 计算距离，单位千米
 * @param p1 起点
 * @param p2 终点
 */
function getDistance(p1: Cartesian3, p2: Cartesian3): number {
  let point1cartographic = Cartographic.fromCartesian(p1)
  let point2cartographic = Cartographic.fromCartesian(p2)
  /**根据经纬度计算出距离**/
  let geodesic = new EllipsoidGeodesic()
  geodesic.setEndPoints(point1cartographic, point2cartographic)
  return geodesic.surfaceDistance / 1000
}

/**
 * 计算方位角，单位度
 * @param p1 起点
 * @param p2 终点
 * @param digits 保留小数位数，默认保留1位小数
 */
function getAzimuth(p1: Cartesian3, p2: Cartesian3, digits = 1): string {
  // 建立局部坐标系：北为y，东为x，p1为原点
  const localMatrix = Transforms.eastNorthUpToFixedFrame(p1)
  //求世界坐标到局部坐标的变换矩阵
  const worldToLocalMatrix = Matrix4.inverse(localMatrix, new Matrix4())
  //p1在局部坐标系的位置，即局部坐标原点
  const localPosition1 = Matrix4.multiplyByPoint(
    worldToLocalMatrix,
    p1,
    new Cartesian3(),
  )
  //p2在局部坐标系的位置
  const localPosition2 = Matrix4.multiplyByPoint(
    worldToLocalMatrix,
    p2,
    new Cartesian3(),
  )
  //弧度
  const angle = Math.atan2(
    localPosition2.x - localPosition1.x,
    localPosition2.y - localPosition1.y,
  )
  //转为角度
  let theta = angle * (180 / Math.PI)
  theta = theta < 0 ? theta + 360 : theta
  return theta.toFixed(digits)
}

/**
 * 计算多边形面积，单位平方米
 * @param vertexs 多边形顶点数组
 */
function getPolygonArea(vertexs: Cartesian3[]) {
  let area = 0
  for (let i = 0; i < vertexs.length; i++) {
    let j = (i + 1) % vertexs.length
    area += vertexs[i].x * vertexs[j].y
    area -= vertexs[i].y * vertexs[j].x
  }
  area /= 2
  return Math.abs(area)
}

/**
 * 获取坐标点的海拔高度 m为单位。 -9999.2024为错误值。
 * @param viewer 地图Viewer
 * @param pos 坐标点 Cartographic|Cartesian3|[lon,lat]
 */
export function getElevation(
  viewer: Viewer,
  pos: Cartographic | Cartesian3 | number[],
) {
  let cartographic = undefined
  if (pos instanceof Array) {
    cartographic = Cartographic.fromDegrees(pos[0], pos[1])
    return viewer.scene.globe.getHeight(cartographic) ?? -9999.2024
  } else if (pos instanceof Cartesian3) {
    cartographic = Cartographic.fromCartesian(pos)
    return viewer.scene.globe.getHeight(cartographic) ?? -9999.2024
  } else {
    return viewer.scene.globe.getHeight(pos) ?? -9999.2024
  }
}

/**
 *  根据起始点、方位角、距离，计算下一点
 * @param position  起始点
 * @param angle 方位角 度（顺时针，正北为0，正东为90）
 * @param distance 距离 米
 * @constructor
 */
export function ByDirectionAndLen(
  position: Cartesian3,
  angle: number,
  distance: number,
) {
  let matrix = Transforms.eastNorthUpToFixedFrame(position)
  let mz = Matrix3.fromRotationZ(
    2 * Cesium_Math.PI - Cesium_Math.toRadians(angle || 0),
  )
  let rotationZ = Matrix4.fromRotationTranslation(mz)
  Matrix4.multiply(matrix, rotationZ, matrix)
  return Matrix4.multiplyByPoint(
    matrix,
    new Cartesian3(0, distance, 0),
    new Cartesian3(),
  )
}

/**
 * 把航点数组转为笛卡尔3坐标数组
 * @param coords
 */
export function transLonlat2Car3(coords: AirlinePoint[]): Cartesian3[] {
  let coordCar3: Cartesian3[] = []
  coords.forEach((coord) => {
    let car3 = Cartesian3.fromDegrees(coord.lon, coord.lat, coord.alt)
    coordCar3.push(car3)
  })
  return coordCar3
}
export {
  getClosestPoint,
  isOnLineSegment,
  getDistance,
  getAzimuth,
  getPolygonArea,
}
