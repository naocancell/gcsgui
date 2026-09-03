/**
 * 文件描述：航线气象预报图表 Composable (ECharts)
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import type { EChartsType } from 'echarts'
import { useMessage } from 'naive-ui'
import type { Airline } from '@/types/entityoptions'
import {
  query_surface_forecast,
  query_upper_forecast,
  requireWeatherLevel,
} from '@/core/gis/weatherRequest'
import { setChartOptions } from '@/core/gis/weatherCharts'

export function useRouteWeatherChart(getSelectedRoute: () => Airline | null) {
  const uiMsg = useMessage()

  let weatherChart: EChartsType | undefined = undefined
  const routePtNumber = ref(1)
  const selectedLevel = ref<number | null>(null)
  const levelOptions = ref<any[]>([])
  const nowTime = ref('')
  let timer: ReturnType<typeof setInterval> | null = null

  function getWeatherErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const candidate = error as {
        message?: unknown
        code?: unknown
        response?: { data?: { message?: unknown } }
      }
      const responseMessage = candidate.response?.data?.message
      if (responseMessage !== undefined && responseMessage !== null) {
        return String(responseMessage)
      }
      if (candidate.code === 'ECONNABORTED') {
        return '请求超时，请检查网络或气象服务'
      }
      if (candidate.message) return String(candidate.message)
    }
    return String(error || '未知错误')
  }

  function showWeatherError(title: string, detail: unknown) {
    uiMsg.error(`${title}：${String(detail || '未知错误')}`, {
      duration: 5000,
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

  async function initWeatherLevel() {
    try {
      const res = await requireWeatherLevel()
      if (!res.data.success) {
        showWeatherError('气象高度层加载失败', res.data.message)
        return
      }

      const levelData = (res.data.data as any)?.levelsAvailableList?.[0]
      if (!Array.isArray(levelData?.pressureLevels)) {
        showWeatherError('气象高度层加载失败', '服务返回数据不完整')
        return
      }

      levelOptions.value = levelData.pressureLevels.map(
        (level: number, index: number) => ({
          value: level,
          label: `${level}hPa/ ${levelData.heightLevels?.[index] ?? '--'}m`,
        }),
      )

      levelOptions.value.reverse()
      levelOptions.value.unshift({ value: -1, label: '地面' })
      selectedLevel.value = -1
    } catch (error) {
      showWeatherError('气象高度层加载失败', getWeatherErrorMessage(error))
    }
  }

  async function queryWeather(lon: number, lat: number, level?: number) {
    try {
      const res =
        level == null || level === -1
          ? await query_surface_forecast(lon, lat)
          : await query_upper_forecast(lon, lat, level)

      if (!res.data.success) {
        showWeatherError('气象信息查询失败', res.data.message)
        return
      }

      const weatherData = res.data.data as any
      if (
        !Array.isArray(weatherData?.time) ||
        !Array.isArray(weatherData?.temp) ||
        !Array.isArray(weatherData?.windSpeed) ||
        !Array.isArray(weatherData?.wind360) ||
        !Array.isArray(weatherData?.humidity)
      ) {
        showWeatherError('气象信息查询失败', '服务返回数据不完整')
        return
      }

      const timeArr = weatherData.time.map((item: string) => {
        const i = item.indexOf('T')
        return item.slice(i + 1, i + 3) + '时'
      })

      if (!Array.isArray(weatherData.precip)) {
        weatherData.precip = Array.from({ length: timeArr.length }, () => 0)
      }

      const chart = weatherChart ?? initWeatherChart()
      if (chart && !chart.isDisposed()) {
        setChartOptions(
          chart,
          timeArr.slice(0, 8),
          weatherData.temp.slice(0, 8),
          weatherData.windSpeed.slice(0, 8),
          weatherData.wind360.slice(0, 8),
          weatherData.precip.slice(0, 8),
          weatherData.humidity.slice(0, 8),
        )
      }
    } catch (error) {
      showWeatherError('气象信息查询失败', getWeatherErrorMessage(error))
    }
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
        selectedLevel.value ?? -1,
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
