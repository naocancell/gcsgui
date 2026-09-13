/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-07 13:57:05
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-10 15:47:36
 * @Description:
 */
import type { Cesium, Viewer } from 'cesium'

// 扩展全局变量
declare global {
  // 定义全局Cesium类型
  // const Cesium: Cesium
  // 允许扩展 Window
  interface Window {
    Cesium: Cesium
    CESIUM_BASE_URL: string
    viewer: Viewer
    measureViewer: any
    guidancePointPicking?: boolean
    startupLocationPicking?: boolean
  }
}
