import { getAzimuth } from '@/utils/map/geocomputation.ts'
import { Cartesian3 } from 'cesium'

class Angle {
  constructor() {}

  /**
   * 十进制经纬度转度分秒，精确至毫秒
   * @param decimal_var 十进制经纬度
   * @constructor
   */
  static DecimalDegree2DMS(decimal_var: number | string) {
    if (!decimal_var.toString().includes('.'))
      return decimal_var.toString() + "°0'0''"
    let decimalStr = decimal_var.toString().split('.')
    let degreeStr = decimalStr[0]
    if (decimalStr[1]) {
      let minutes =
        (Number(decimalStr[1]) / Math.pow(10, decimalStr[1].length)) * 60
      if (!minutes.toString().includes('.'))
        return degreeStr + '°' + minutes.toString() + "'0''"
      let minuteSecondsStr = minutes.toString().split('.')
      if (minuteSecondsStr[1]) {
        let secondStr =
          (Number(minuteSecondsStr[1]) /
            Math.pow(10, minuteSecondsStr[1].length)) *
          60
        return (
          degreeStr +
          '°' +
          minuteSecondsStr[0] +
          "'" +
          secondStr.toFixed(3) +
          "''"
        )
      }
    }
    return ''
  }

  /**
   * 计算方位角，单位度
   * @param p1 起点
   * @param p2 终点
   * @param digits 保留小数位数，默认保留1位小数
   */
  static getAzimuth(p1: Cartesian3, p2: Cartesian3, digits = 1) {
    return getAzimuth(p1, p2, digits)
  }

  /**
   * 十进制度转弧度
   * @param degree 十进制度
   */
  static degree2rad(degree: number): number {
    return (Math.PI / 180) * degree
  }
  /**
   * 弧度转十进制度
   * @param rad 弧度
   */
  static rad2degree(rad: number): number {
    return (180 / Math.PI) * rad
  }
}

export { Angle }
