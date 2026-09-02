import axios, { type AxiosResponse } from 'axios'
import CryptoJS from 'crypto-js'

export interface WeatherResponse<T = unknown> {
  success: boolean
  code: number
  message: string | number
  data: T
}

/**
 * 查询未来24小时指定位置的地面气象变量信息
 *
 * @param lon 经度
 * @param lat 纬度
 */
export function query_surface_forecast(
  lon: number,
  lat: number,
): Promise<AxiosResponse<WeatherResponse>> {
  const timestamp = Date.now().toString()
  return axios({
    method: 'POST',
    url: '/onlinetest/htfp/weather/v1/surface/querySurfaceForecast',
    headers: {
      'Content-Type': 'application/json',
      timestamp: timestamp,
      signature: CryptoJS.HmacSHA1(
        '/htfp/weather/v1/surface/querySurfaceForecast',
        timestamp,
      ).toString(),
    },
    data: {
      latitude: lat,
      longitude: lon,
    },
  })
}

/**
 * 查询未来24小时指定位置和高度的高空气象变量信息
 * @param lon 经度
 * @param lat 纬度
 * @param level 气压高度 (hPa)
 */
export function query_upper_forecast(
  lon: number,
  lat: number,
  level: number,
): Promise<AxiosResponse<WeatherResponse>> {
  const timestamp = Date.now().toString()
  return axios({
    method: 'POST',
    url: '/onlinetest/htfp/weather/v1/upper/queryUpperForecast',
    headers: {
      'Content-Type': 'application/json',
      timestamp: timestamp,
      signature: CryptoJS.HmacSHA1(
        '/htfp/weather/v1/upper/queryUpperForecast',
        timestamp,
      ).toString(),
    },
    data: {
      latitude: lat,
      longitude: lon,
      level: level,
    },
  })
}

/**
 * 查询可用气象高度层
 */
export function requireWeatherLevel(): Promise<AxiosResponse<WeatherResponse>> {
  const timestamp = Date.now().toString()
  return axios({
    method: 'POST',
    url: '/onlinetest/htfp/weather/v1/info/queryLevelsAvailable',
    headers: {
      'Content-Type': 'application/json',
      timestamp: timestamp,
      signature: CryptoJS.HmacSHA1(
        '/htfp/weather/v1/info/queryLevelsAvailable',
        timestamp,
      ).toString(),
    },
    data: { dataSource: 'GFS' },
  })
}
