import {
  Airline,
  AirlinePoint,
  UavDynamicInfo,
  getUnicode,
} from '@/types/entityoptions.ts'
import { useLayerStore } from '@/store/layerManagerStore.ts'

/**
 * 处理来自中心指控websocket的数据，返回所需数据
 * @param websocketDataCC
 * @return UavDynamicInfo
 */
function dataProcess(websocketDataCC: any): UavDynamicInfo | null {
  let data: UavDynamicInfo = {
    alt: 0,
    groundSpeed: 0,
    heading: 0,
    pitch: 0,
    lat: 0,
    lon: 0,
    uavId: '',
    uavType: '',
  }
  if (websocketDataCC.infoType === 1) {
    let aUavInfo: any = websocketDataCC.info[0] //目前只取第一个uav
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
          aUavInfo.shortUavDynamicInfo.shortPositionInfo.groundSpeed * 0.001 //km/h
      }
    }
  }
  return data.lon === 0 && data.lat === 0 ? null : data
}

/**
 * 处理来自QT端 websocket的数据，返回所需数据
 * @param websocketDataQT
 * @return UavDynamicInfo
 */
function dataProcess_fromQT(websocketDataQT: any): UavDynamicInfo | null {
  let data: UavDynamicInfo = {
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
  data.alt = Number(websocketDataQT.pos.height) + useLayerStore().navi.hFactor
  data.groundSpeed = websocketDataQT.pos.groundSpeed //km/h

  useLayerStore().navi.currentRouteID = websocketDataQT.navi.currentRouteID
  useLayerStore().navi.nextRouteID = websocketDataQT.navi.nextRouteID
  useLayerStore().navi.nextPoint = websocketDataQT.navi.nextPoint
  useLayerStore().navi.distonext = websocketDataQT.navi.distonext

  // console.log(data.lon,data.lat, data.alt)
  //
  return data.lon === 0 && data.lat === 0 ? null : data
}

function dataProcess_fromQT_route(websocketDataQT: any): Airline | null {
  let data: Airline = {
    code: 0,
    PtNum: 0,
    isClose: false,
    name: '',
    points: [],
    totalDistance: 0,
    unicode: getUnicode(),
  }
  if (!websocketDataQT.route) return null
  data.PtNum = websocketDataQT.route.points.length
  data.isClose = websocketDataQT.route.isClose
  for (let i = 0; i < websocketDataQT.route.points.length; i++) {
    let aPt: AirlinePoint = {
      alt: 0,
      ch1: 0,
      ch2: 0,
      lat: 0,
      lon: 0,
      nPt: 0,
      speed: 0,
    }
    aPt.lon = websocketDataQT.route.points[i].lon
    aPt.lat = websocketDataQT.route.points[i].lat
    aPt.alt = websocketDataQT.route.points[i].height
    aPt.ch1 = websocketDataQT.route.points[i].ch1
    aPt.ch2 = websocketDataQT.route.points[i].ch2
    aPt.nPt = websocketDataQT.route.points[i].nPt
    aPt.speed = websocketDataQT.route.points[i].nV
    data.code = websocketDataQT.route.points[i].nL
    data.points.push(aPt)
  }
  data.name = 'lineID-' + data.code.toString()
  console.log(data)

  return data.PtNum == 0 ? null : data
}

function getUavTypeStr(type: number): string {
  switch (type) {
    case 1:
      return '981A'
    case 2:
      return '981C'
    default:
      return 'test'
  }
}
export { dataProcess_fromQT, dataProcess_fromQT_route }
