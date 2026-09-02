/**
 * 文件描述：航线气象预报图表 Composable (ECharts)
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import type { EChartsType } from 'echarts'
import { useMessage, useNotification, type NotificationType } from 'naive-ui'
import type { Airline } from '@/types/entityoptions'
import {
  query_surface_forecast,
  query_upper_forecast,
  requireWeatherLevel,
} from '@/core/gis/weatherRequest'
import { setChartOptions } from '@/core/gis/weatherCharts'

export function useRouteWeatherChart(getSelectedRoute: () => Airline | null) {
  const uiMsg = useMessage()
  const notification = useNotification()

  let weatherChart: EChartsType | undefined = undefined
  const routePtNumber = ref(1)
  const selectedLevel = ref<number | null>(null)
  const levelOptions = ref<any[]>([])
  const nowTime = ref('')
  let timer: ReturnType<typeof setInterval> | null = null

  const notify = (type: NotificationType, title: string, detail: string) => {
    notification[type]({
      title,
      meta: detail,
      duration: 3000,
      closable: true,
      keepAliveOnHover: true,
    })
  }

  function getTimesInterval() {
    const now = new Date()
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    const hours = now.getHours().toString().padStart(2, '0')
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const seconds = now.getSeconds().toString().padStart(2, '0')

    nowTime.value = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  function initWeatherLevel() {
    requireWeatherLevel().then((res) => {
      if (!res.data.success) {
        notify('error', '气象信息查询失败', res.data.message)
        return
      }

      levelOptions.value =
        res.data.data.levelsAvailableList[0].pressureLevels.map(
          (level: number, index: number) => {
            return {
              value: level,
              label:
                level +
                'hPa/ ' +
                res.data.data.levelsAvailableList[0].heightLevels[index] +
                'm',
            }
          },
        )

      levelOptions.value.reverse()
      levelOptions.value.unshift({ value: -1, label: '地面' })
      selectedLevel.value = -1
    })
  }

  function queryWeather(lon: number, lat: number, level?: number) {
    let response: Promise<any>
    if (level == null || level === -1) {
      response = query_surface_forecast(lon, lat)
    } else {
      response = query_upper_forecast(lon, lat, level)
    }

    response
      .then((res) => {
        if (!res.data.success) {
          notify('error', '气象信息查询失败', res.data.message)
          return
        }

        const weatherData = res.data.data
        const timeArr = weatherData.time.map((item: string) => {
          const i = item.indexOf('T')
          return item.slice(i + 1, i + 3) + '时'
        })

        if (!Reflect.has(weatherData, 'precip')) {
          weatherData.precip = Array.from({ length: timeArr.length }, () => 0)
        }

        if (weatherChart && !weatherChart.isDisposed()) {
          setChartOptions(
            weatherChart,
            timeArr.slice(0, 8),
            weatherData.temp.slice(0, 8),
            weatherData.windSpeed.slice(0, 8),
            weatherData.wind360.slice(0, 8),
            weatherData.precip.slice(0, 8),
            weatherData.humidity.slice(0, 8),
          )
        }
      })
      .catch((e) => {
        uiMsg.error('气象信息查询失败：' + e.message, {
          duration: 3000,
          keepAliveOnHover: true,
        })
      })
  }

  function refreshWeatherOfCurrentPoint() {
    const route = getSelectedRoute()
    if (!route?.points?.length) {
      weatherChart?.clear()
      return
    }

    if (routePtNumber.value > route.points.length) {
      routePtNumber.value = route.points.length
    }
    if (routePtNumber.value < 1) {
      routePtNumber.value = 1
    }

    const currentPoint = route.points[routePtNumber.value - 1]
    if (currentPoint?.lon != null && currentPoint?.lat != null) {
      queryWeather(
        currentPoint.lon,
        currentPoint.lat,
        Number(selectedLevel.value),
      )
    } else {
      weatherChart?.clear()
    }
  }

  function prevPtWeather() {
    const route = getSelectedRoute()
    if (!route?.points?.length) return

    routePtNumber.value -= 1
    const entity = window.viewer?.entities?.getById(
      route.unicode + '-航点' + routePtNumber.value.toString(),
    )
    if (entity) {
      window.viewer.flyTo(entity, { duration: 1 })
    }
    refreshWeatherOfCurrentPoint()
  }

  function nextPtWeather() {
    const route = getSelectedRoute()
    if (!route?.points?.length) return

    routePtNumber.value += 1
    const entity = window.viewer?.entities?.getById(
      route.unicode + '-航点' + routePtNumber.value.toString(),
    )
    if (entity) {
      window.viewer.flyTo(entity, { duration: 1 })
    }
    refreshWeatherOfCurrentPoint()
  }

  function levelChanged(key: string | number) {
    selectedLevel.value = Number(key)
    refreshWeatherOfCurrentPoint()
  }

  function initWeatherChart(domId = 'weatherChart') {
    const el = document.getElementById(domId)
    if (el) {
      weatherChart = echarts.getInstanceByDom(el) ?? echarts.init(el, 'dark')
    }
    return weatherChart
  }

  function resizeWeatherChart() {
    weatherChart?.resize()
  }

  onMounted(() => {
    initWeatherChart()
    initWeatherLevel()
    timer = setInterval(getTimesInterval, 1000)
  })

  onBeforeUnmount(() => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    weatherChart?.dispose()
  })

  return {
    weatherChart,
    routePtNumber,
    selectedLevel,
    levelOptions,
    nowTime,
    initWeatherChart,
    resizeWeatherChart,
    initWeatherLevel,
    refreshWeatherOfCurrentPoint,
    prevPtWeather,
    nextPtWeather,
    levelChanged,
    queryWeather,
  }
}
