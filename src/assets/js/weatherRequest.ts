import axios from 'axios'
import CryptoJS from 'crypto-js'

type WeatherResponse = {
  success: boolean
  code: number
  message: number
  data: any //响应数据
}

/**查询未来24小时，指定位置的地面气象变量信息
 *
 * @param lon 经度
 * @param lat 纬度
 */
function query_surface_forecast(lon: number, lat: number) {
  let timestamp = Date.now().toString()
  return axios({
    method: 'POST',
    url: '/onlinetest/htfp/weather/v1/surface/querySurfaceForecast',
    headers: {
      'Content-Type': 'application/json',
      timestamp: timestamp,
      signature: CryptoJS.HmacSHA1(
        '/htfp/weather/v1/surface/querySurfaceForecast',
        timestamp,
      ),
    },
    data: {
      latitude: lat,
      longitude: lon,
    },
  })
}

/** 查询未来24小时，指定位置和高度的高空气象变量信息
 * @param lon 经度
 * @param lat 纬度
 * @param level 气压高度 hPa
 */

function query_upper_forecast(lon: number, lat: number, level: number) {
  let timestamp = Date.now().toString()
  return axios({
    method: 'POST',
    url: '/onlinetest/htfp/weather/v1/upper/queryUpperForecast',
    headers: {
      'Content-Type': 'application/json',
      timestamp: timestamp,
      signature: CryptoJS.HmacSHA1(
        '/htfp/weather/v1/upper/queryUpperForecast',
        timestamp,
      ),
    },
    data: {
      latitude: lat,
      longitude: lon,
      level: level,
    },
  })
}

/**
 * 查询高度层
 */
function requireWeatherLevel() {
  let timestamp = Date.now().toString()
  return axios({
    method: 'POST',
    url: '/onlinetest/htfp/weather/v1/info/queryLevelsAvailable',
    headers: {
      'Content-Type': 'application/json',
      timestamp: timestamp,
      signature: CryptoJS.HmacSHA1(
        '/htfp/weather/v1/info/queryLevelsAvailable',
        timestamp,
      ),
    },
    data: { dataSource: 'GFS' },
  })
}
export { query_upper_forecast, query_surface_forecast, requireWeatherLevel }
