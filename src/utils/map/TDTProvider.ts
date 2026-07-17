/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-03-07 16:04:55
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-15 16:06:06
 * @Description:
 */
// 天地图影像服务
import {
  WebMapTileServiceImageryProvider,
  GeographicTilingScheme,
  WebMercatorTilingScheme,
  CesiumTerrainProvider,
} from 'cesium'
import axios from 'axios'

//地图服务枚举类型：_c为墨卡托投影，_w为经纬度投影
enum TDTLayerType {
  Vec = 'vec', //矢量底图
  Cva = 'cva', //矢量注记
  Img = 'img', //影像底图
  Cia = 'cia', //影像注记
  Ter = 'ter', //地形晕渲
  Cta = 'cta', //地形注记
  Ibo = 'ibo', //全球境界
}
enum TDTProjectionType {
  WebMercator = 'w',
  WGS84 = 'c',
}
//天地图token
const TDT_tk = '1c5b7cbf9da7d33b221f68c32b6a1791'
const TDT_tk3D = '910a4befdfd04d5423268b0aced82248'
// 服务域名
const tdtUrl = 'https://t{s}.tianditu.gov.cn'
// 服务负载子域
const subdomains = ['0', '1', '2', '3', '4', '5', '6', '7']
/**
 * 获取天地图影像服务
 * @param layerType :影像类型
 * @param projectionType :投影类型
 * @param minimumLevel :最小缩放级别
 * @param maximumLevel :最大缩放级别
 * @returns :ImageryProvider
 */
export function getTDTProvider(
  layerType: string,
  projectionType: string,
  minimumLevel: number = 0,
  maximumLevel: number = 18,
) {
  // 切片方式
  const tilingScheme =
    projectionType == TDTProjectionType.WGS84
      ? new GeographicTilingScheme()
      : new WebMercatorTilingScheme()
  const tileMatrixLabels =
    projectionType == TDTProjectionType.WGS84
      ? new Array(19).fill(1).map((v, i) => `${i + 1}`)
      : undefined
  const imageryProvider = new WebMapTileServiceImageryProvider({
    //影像底图
    url:
      `${tdtUrl}/DataServer?T=${layerType}_${projectionType}&x={TileCol}&y={TileRow}&l={TileMatrix}&tk=` +
      TDT_tk,
    subdomains: subdomains, //天地图8个服务器
    minimumLevel: minimumLevel, //定义最小缩放级别
    maximumLevel: maximumLevel, //定义最大缩放级别
    layer: layerType,
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: projectionType, //'GoogleMapsCompatible', //使用谷歌的瓦片切片方式
    tilingScheme: tilingScheme,
    tileMatrixLabels: tileMatrixLabels,
  })
  return imageryProvider
}
/**
 * 获取天地图三维地形服务
 * @returns ImageryProvider
 */
export function getTDTTerrainProvider() {
  const terrainUrls: string[] = []

  for (let i = 0; i < subdomains.length; i++) {
    const url =
      tdtUrl.replace('{s}', subdomains[i]) +
      '/mapservice/swdx?T=elv_c&tk=' +
      TDT_tk3D
    terrainUrls.push(url)
  }

  const provider = new window.Cesium.GeoTerrainProvider({
    urls: terrainUrls,
  })
  if (provider.errorEvent) {
    provider.errorEvent.addEventListener((error: any) => {
      // 静默处理瓦片请求或解析失败引起的异常，关闭重试以避免频繁日志刷屏
      if (error) {
        error.retry = false
      }
    })
  }
  return provider
}

/**
 * 天地图地理编码服务
 * @param word 地名
 */
export function Geocoder(word: string) {
  let url = `https://api.tianditu.gov.cn/geocoder?ds={"keyWord":"${word}"}&tk=`
  return axios.get(url + TDT_tk)
}

/**
 * 天地图逆地理编码服务
 * @param lon 经度
 * @param lat 纬度
 */
export function reverseGeocoder(lon: number, lat: number) {
  let url = `https://api.tianditu.gov.cn/geocoder?postStr={'lon':${lon},'lat':${lat},'ver':1}&type=geocode&tk=`
  return axios.get(url + TDT_tk)
}
export { TDTLayerType, TDTProjectionType }
