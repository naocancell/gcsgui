/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-22 09:11:54
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-13 10:49:36
 * @Description: 坐标系转化
 */
import { Cartesian2, Viewer, Math, Cartographic, Cartesian3 } from 'cesium'

/**
 * 屏幕坐标转笛卡尔坐标
 * @param viewer
 * @param windowPosition :屏幕二维坐标
 * @returns :笛卡尔坐标
 */
function cartesian2ToCartesian3(viewer: Viewer, windowPosition: Cartesian2) {
  const ray = viewer.camera.getPickRay(windowPosition)
  if (ray != undefined) {
    return viewer.scene.globe.pick(ray, viewer.scene)
  } else return undefined
}
/**
 * 屏幕坐标转地理坐标
 * @param viewer
 * @param windowPosition :屏幕坐标
 * @returns :WGS84坐标
 */
function cartesian2ToWGS84(viewer: Viewer, windowPosition: Cartesian2) {
  const cartesian3 = cartesian2ToCartesian3(viewer, windowPosition)
  if (cartesian3 != undefined) {
    return cartesian3ToWGS84(cartesian3)
  } else return []
}
/**
 * 笛卡尔坐标转WGS84坐标
 * @param pos 笛卡尔坐标
 * @returns 经纬度坐标
 */
function cartesian3ToWGS84(pos: Cartesian3) {
  if (pos) {
    const cartographic = Cartographic.fromCartesian(pos)
    const lon = Math.toDegrees(cartographic.longitude) // 经度
    const lat = Math.toDegrees(cartographic.latitude) // 纬度
    const alt = cartographic.height // 高度
    return [lon, lat, alt]
  }
  return []
}

export { cartesian2ToCartesian3, cartesian2ToWGS84, cartesian3ToWGS84 }
