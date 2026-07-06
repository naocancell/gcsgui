/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-04-13 10:36:06
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-16 13:47:55
 * @Description:
 */
import { Color, Cartesian2, HeightReference } from 'cesium'
export interface EntityOptions {
  id?: string
  name?: string
  show?: boolean
  pixelSize?: number //点大小
  outlineColor?: Color //轮廓线颜色
  color?: Color //点颜色
  fillColor?: Color //填充颜色
  fill?: boolean //是否填充
  width?: number //线宽
  outlineWidth?: number
  text?: string //标注内容
  font?: string //字体
  pixelOffset?: Cartesian2 //偏移量
  image?: string //图片url
  imageWidth?: number //图片宽
  imageHeight?: number //图片高
  heightReference?: HeightReference
}
export type UavDynamicInfo = {
  uavId: string
  uavType: string
  uavFlightControlSn?: string
  heading: number
  pitch: number
  lon: number
  lat: number
  alt: number
  groundSpeed: number //地速，单位：km/h，精确到小数点后三位
}
export type AirlinePoint = {
  lon: number
  lat: number
  alt: number
  ch2: number
  ch1: number //任务特征字, 2为闭合航线 0为开航线
  speed: number //航点特征字
  nPt: number //航点号
}

export type Airline = {
  name: string
  code: number //航线编号
  unicode: string //航线唯一码，前端有效（用于图层管理、store管理和地图Entity管理）
  PtNum: number
  isClose: boolean
  totalDistance: number
  points: AirlinePoint[]
  isDesignRoute?: boolean //是否为设计航线（用于三维增强渲染和高度预警）
}

export type routeTerrain = {
  routeID: number
  distanceArray: number[]
  elevationArray: number[]
}

/**
 * 生成唯一码（随机字符串+时间戳）
 * @param len 随机字符串长度，默认12
 */
export function getUnicode(len: number = 12): string {
  let timestamp = new Date().getTime()
  /****默认去掉了容易混淆的字符oOLl,9gq,Vv,Uu,I1****/
  let $chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678'
  let maxPos = $chars.length
  let randomStr = ''
  for (let i = 0; i < len; i++) {
    randomStr += $chars.charAt(Math.floor(Math.random() * maxPos))
  }
  return randomStr + timestamp
}

// 与rust后端交互的结构体
export interface UAVInfo {
  uavSeries: string // UAV型号，0->981A; 1->981C; 2->981C;3->98;4->985;
  uavId: number // 飞机号
  longitude: number // 经度
  latitude: number // 纬度
  altitude: number // 海拔高度
  relativeAltitude: number // 相对海拔高度
  groundSpeed: number // 地速 m/s
  groundSpeedDirection: number // 地速方向 0->360°
  verticalSpeed: number // 垂直速度 m/s
  airspeed: number // 空速 m/s
  trueAirspeed: number // 真空速 m/s
  pitchAngle: number // 俯仰角°
  rollAngle: number // 滚转角°
  headingAngle: number // 航向角°
  currentRouteId: number // 当前航线号
  nextRouteId: number // 下一航线号
  nextPoint: number // 下一个航点号
  distanceNext: number // 待飞距
}

 export type FP95Frame94Sub1 = {
    addressType: string;       // 地址类型 ("ICAO地址"|"临时地址")
    sAddress: string;          // S模式地址十六进制字符串
    adsLon: number;            // 经度 (double / f64)
    adsLat: number;            // 纬度 (double / f64)
    adsAlt: number;            // 高度 (float / f32, 单位: 米)
    adsVl: number;             // 水平速度 (float / f32, 单位: m/s)
    adsVu: number;             // 垂直速度 (float / f32, 单位: m/s)
    adsYaw: number;            // 航向角 (float / f32, 单位: 度)
    flightNum: number[];       // 航班号原始字节 [u8; 8]
    adsAlt2: number;           // 原始反转后高度字 (u16)
    adsSpeed: [number, number, number]; // 原始速度字节 [u8; 3]
    adsYaw2: number;           // 原始航向字 (u8)
  }

  // 后端推送的是所有在线无人机状态的数组
  export type FP95EventPayload = FP95Frame94Sub1[];
  
  //将不同的飞机结构体统一用于渲染
  export type PlaneType = "uavInfo" | "fp95";;

  // 渲染层结构
  export interface PlaneState {
    id: string;  // 唯一键，UAV用 "UAV-{uavId}"，FP95用 sAddress
    type: PlaneType;// 飞机类型
    lon: number;// 经度
    lat: number;// 纬度
    alt: number;// 海拔高度
    heading: number;// 航向角
    pitch?: number;// 俯仰角
    roll?: number;// 滚转角
    groundSpeed?: number;// 地速
    verticalSpeed: number // 垂直速度 m/s
    raw: UAVInfo | FP95Frame94Sub1; // 保留原始数据，点击时用
    showTrail?: boolean;// 是否显示轨迹
  }



