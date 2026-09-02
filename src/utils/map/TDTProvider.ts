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
//专用地理编码服务
const TDT_geoCode = 'fdcb75858870c951753957ac29bc8167'
const TDT_tk = '1c5b7cbf9da7d33b221f68c32b6a1791'
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
 * 天地图地理编码服务
 * @param word 地名
 */
export interface TDTGeocoderResponse {
  msg: string
  status: string
  searchVersion?: string
  location?: {
    score: number
    level: string
    lon: string
    lat: string
    keyWord: string
  }
}

export function Geocoder(word: string) {
  const ds = encodeURIComponent(JSON.stringify({ keyWord: word }))
  const url = `https://api.tianditu.gov.cn/geocoder?ds=${ds}&tk=${TDT_geoCode}`
  return axios.get<TDTGeocoderResponse>(url)
}

export interface TDTPlaceSearchPoi {
  name: string
  address?: string
  lonlat: string
}

export interface TDTPlaceSearchResponse {
  count?: string | number
  msg?: string
  pois?: TDTPlaceSearchPoi[]
}

/** 天地图地名搜索服务，用于 Cesium 搜索框的中文联想。 */
export function searchTDTPlaces(word: string, count: number = 8) {
  const postStr = encodeURIComponent(
    JSON.stringify({
      keyWord: word,
      level: 12,
      mapBound: '73,18,135,54',
      queryType: 1,
      start: 0,
      count,
    }),
  )
  const url = `https://api.tianditu.gov.cn/v2/search?postStr=${postStr}&type=query&tk=${TDT_geoCode}`
  return axios.get<TDTPlaceSearchResponse>(url)
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
