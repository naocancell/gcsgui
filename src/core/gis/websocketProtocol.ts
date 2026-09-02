import {
  type Airline,
  type AirlinePoint,
  type UavDynamicInfo,
  getUnicode,
} from '@/types/entityoptions'
import { useLayerStore } from '@/store/layerManagerStore'

/**
 * 处理来自中心指控 WebSocket 的数据，提取无人机遥测动态信息
 * @param websocketDataCC 中心指控原始 WebSocket 数据包
 * @returns 格式化后的无人机动态信息，无效时返回 null
 */
export function dataProcess(websocketDataCC: any): UavDynamicInfo | null {
  const data: UavDynamicInfo = {
    alt: 0,
    groundSpeed: 0,
    heading: 0,
    pitch: 0,
    lat: 0,
    lon: 0,
    uavId: '',
    uavType: '',
  }
  if (websocketDataCC?.infoType === 1 && Array.isArray(websocketDataCC.info) && websocketDataCC.info.length > 0) {
    const aUavInfo: any = websocketDataCC.info[0] // 目前只取第一个 uav
    sessionStorage.setItem('uavId', aUavInfo.uavId)
    data.uavId = aUavInfo.uavId
    data.uavType = getUavTypeStr(aUavInfo.uavType)
    data.uavFlightControlSn = aUavInfo.uavFlightControlSn
    if (aUavInfo.hasShortUavDynamicInfo) {
      if (aUavInfo.shortUavDynamicInfo.hasShortAttitudeInfo) {
        data.heading =
          aUavInfo.shortUavDynamicInfo.shortAttitudeInfo.courseAngle * 0.01
      }
      if (aUavInfo.shortUavDynamicInfo.hasShortPositionInfo) {
        data.lon = aUavInfo.shortUavDynamicInfo.shortPositionInfo.lng * 10 ** -7
        data.lat = aUavInfo.shortUavDynamicInfo.shortPositionInfo.lat * 10 ** -7
        data.alt = aUavInfo.shortUavDynamicInfo.shortPositionInfo.alt * 10 ** -2
        data.groundSpeed =
          aUavInfo.shortUavDynamicInfo.shortPositionInfo.groundSpeed * 0.001 // km/h
      }
    }
  }
  return data.lon === 0 && data.lat === 0 ? null : data
}

/**
 * 处理来自 QT 客户端 WebSocket 的无人机位姿与导航数据
 * @param websocketDataQT QT 客户端原始 WebSocket 数据
 * @returns 格式化后的无人机动态信息，无效时返回 null
 */
export function dataProcess_fromQT(websocketDataQT: any): UavDynamicInfo | null {
  if (!websocketDataQT?.pos) return null

  const layerStore = useLayerStore()
  const data: UavDynamicInfo = {
    alt: 0,
    groundSpeed: 0,
    heading: 0,
    pitch: 0,
    lat: 0,
    lon: 0,
    uavId: '',
    uavType: '',
  }
  data.uavId = websocketDataQT.pos.uavId
  data.uavType = websocketDataQT.pos.uavType
  data.heading = websocketDataQT.pos.HeadAngle
  data.pitch = websocketDataQT.pos.FyAngle
  data.lon = websocketDataQT.pos.lon
  data.lat = websocketDataQT.pos.lat
  data.alt = Number(websocketDataQT.pos.height) + (layerStore?.navi?.hFactor ?? 0)
  data.groundSpeed = websocketDataQT.pos.groundSpeed // km/h

  if (layerStore?.navi && websocketDataQT.navi) {
    layerStore.navi.currentRouteID = websocketDataQT.navi.currentRouteID
    layerStore.navi.nextRouteID = websocketDataQT.navi.nextRouteID
    layerStore.navi.nextPoint = websocketDataQT.navi.nextPoint
    layerStore.navi.distonext = websocketDataQT.navi.distonext
  }

  return data.lon === 0 && data.lat === 0 ? null : data
}

/**
 * 处理来自 QT 客户端 WebSocket 的航线数据
 * @param websocketDataQT QT 客户端原始航线数据
 * @returns 解析后的航线对象，无航线时返回 null
 */
export function dataProcess_fromQT_route(websocketDataQT: any): Airline | null {
  if (!websocketDataQT?.route?.points) return null

  const data: Airline = {
    code: 0,
    PtNum: websocketDataQT.route.points.length,
    isClose: Boolean(websocketDataQT.route.isClose),
    name: '',
    points: [],
    totalDistance: 0,
    unicode: getUnicode(),
  }

  for (let i = 0; i < websocketDataQT.route.points.length; i++) {
    const rawPt = websocketDataQT.route.points[i]
    const aPt: AirlinePoint = {
      alt: rawPt.height ?? 0,
      ch1: rawPt.ch1 ?? 0,
      ch2: rawPt.ch2 ?? 0,
      lat: rawPt.lat ?? 0,
      lon: rawPt.lon ?? 0,
      nPt: rawPt.nPt ?? 0,
      speed: rawPt.nV ?? 0,
    }
    data.code = rawPt.nL ?? 0
    data.points.push(aPt)
  }
  data.name = 'lineID-' + data.code.toString()

  return data.PtNum === 0 ? null : data
}

/**
 * 根据无人机数值类型获取对应型号字符串
 * @param type 无人机类型数值
 * @returns 对应型号名称
 */
export function getUavTypeStr(type: number): string {
  switch (type) {
    case 1:
      return '981A'
    case 2:
      return '981C'
    default:
      return 'test'
  }
}
