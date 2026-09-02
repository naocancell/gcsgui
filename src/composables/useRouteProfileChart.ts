/**
 * 文件描述：航线地形剖面分析图表 Composable (ECharts)
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import type { EChartsType } from 'echarts'
import { useMessage } from 'naive-ui'
import type { Airline } from '@/types/entityoptions'
import { getDistance, transLonlat2Car3 } from '@/utils/map/geocomputation'
import {
  drawEcharts_RouteDetection,
  profileAnalyseAtTerrainLevel,
} from '@/utils/map/SpatialAnalysis'

export type RouteProfileChartData = {
  distanceArray: number[]
  elevationArray: number[]
  orderArr: number[]
  heightArr: number[]
  routeDistanceArr: number[]
}

export type RouteProfileCacheEntry = {
  routeCode: string
  data: RouteProfileChartData
}

export const MAX_ROUTE_PROFILE_SAMPLES = 5000
export const ROUTE_PROFILE_TERRAIN_LEVEL = 13

/**
 * 闭合航线用于剖面图时，临时追加首点，不修改原始数据。
 */
export function getProfilePoints(route: Airline) {
  const points = (route.points || []).map((pt) => ({ ...pt }))
  if (!route.isClose || points.length < 2) {
    return points
  }

  const first = points[0]
  const last = points[points.length - 1]

  const alreadyClosed =
    Math.abs(first.lon - last.lon) < 1e-8 &&
    Math.abs(first.lat - last.lat) < 1e-8 &&
    Math.abs(first.alt - last.alt) < 1e-3

  if (!alreadyClosed) {
    points.push({
      ...first,
      nPt: points.length + 1,
    })
  }

  return points
}

export function getRouteProfileDistances(
  cartesianPositions: ReturnType<typeof transLonlat2Car3>,
) {
  const distances = [0]
  for (let index = 1; index < cartesianPositions.length; index++) {
    const segmentDistance = Math.round(
      getDistance(cartesianPositions[index - 1], cartesianPositions[index]) *
        1000,
    )
    distances.push(distances[index - 1] + segmentDistance)
  }
  return distances
}

export function getEffectiveProfileInterval(
  routeDistanceArr: number[],
  segmentCount: number,
  requestedInterval: number,
) {
  const totalDistance = routeDistanceArr[routeDistanceArr.length - 1] ?? 0
  const availableSamples = Math.max(
    1,
    MAX_ROUTE_PROFILE_SAMPLES - segmentCount * 2,
  )

  return Math.max(
    requestedInterval,
    Math.ceil(totalDistance / availableSamples),
  )
}

export function getRouteProfileCacheKey(
  route: Airline,
  interval: number,
) {
  return JSON.stringify([
    String(route.unicode),
    interval,
    ROUTE_PROFILE_TERRAIN_LEVEL,
    Boolean(route.isClose),
    (route.points || []).map((point) => [
      Number(point.lon),
      Number(point.lat),
      Number(point.alt),
    ]),
  ])
}

export function useRouteProfileChart(getSelectedRoute: () => Airline | null) {
  const uiMsg = useMessage()

  let myChart: EChartsType | undefined = undefined
  let profileChartResizeObserver: ResizeObserver | null = null

  const profileInterval = ref<number | null>(1000)
  const routeProfileCache = new Map<string, RouteProfileCacheEntry>()

  let profileRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let profileSamplingTimer: ReturnType<typeof setTimeout> | null = null
  let profileSamplingFrame: number | null = null
  let profileSamplingRequestId = 0

  function getProfileInterval() {
    return Math.max(100, profileInterval.value ?? 1000)
  }

  function cacheRouteProfile(
    route: Airline,
    cacheKey: string,
    data: RouteProfileChartData,
  ) {
    routeProfileCache.delete(cacheKey)
    routeProfileCache.set(cacheKey, {
      routeCode: String(route.unicode),
      data,
    })

    if (routeProfileCache.size > 20) {
      const oldestKey = routeProfileCache.keys().next().value
      if (oldestKey) routeProfileCache.delete(oldestKey)
    }
  }

  function clearRouteProfileCache(routeCode: string | number) {
    const normalizedRouteCode = String(routeCode)
    routeProfileCache.forEach((entry, cacheKey) => {
      if (entry.routeCode === normalizedRouteCode) {
        routeProfileCache.delete(cacheKey)
      }
    })
  }

  function ensureProfileChart(domId = 'echarts-profile') {
    const element = document.getElementById(domId)
    if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) {
      return undefined
    }
    if (!myChart || myChart.isDisposed()) {
      myChart = echarts.getInstanceByDom(element) ?? echarts.init(element, 'dark')
    }
    return myChart
  }

  function resizeProfileChart() {
    ensureProfileChart()?.resize()
  }

  function renderRouteProfile(data: RouteProfileChartData) {
    const chart = ensureProfileChart()
    if (!chart) return

    drawEcharts_RouteDetection(
      chart,
      data.distanceArray,
      data.elevationArray,
      data.orderArr,
      data.heightArr,
      data.routeDistanceArr,
    )

    requestAnimationFrame(() => {
      if (!chart.isDisposed()) chart.resize()
    })
  }

  function cancelPendingProfileSampling() {
    profileSamplingRequestId += 1
    if (profileSamplingFrame != null) {
      cancelAnimationFrame(profileSamplingFrame)
      profileSamplingFrame = null
    }
    if (profileSamplingTimer) {
      clearTimeout(profileSamplingTimer)
      profileSamplingTimer = null
    }
    myChart?.hideLoading()
  }

  function showRouteProfileLoading() {
    ensureProfileChart()?.showLoading('default', {
      text: '正在采样中',
      color: '#63e2b7',
      textColor: '#ffffff',
      maskColor: 'rgba(16, 16, 20, 0.88)',
    })
  }

  function drawRouteProfile(route?: Airline | null, options?: { force?: boolean }) {
    const targetRoute = route ?? getSelectedRoute()
    cancelPendingProfileSampling()

    if (!targetRoute?.points || targetRoute.points.length < 2) {
      myChart?.clear()
      return
    }

    const interval = getProfileInterval()
    const cacheKey = getRouteProfileCacheKey(targetRoute, interval)
    const cachedProfile = options?.force
      ? undefined
      : routeProfileCache.get(cacheKey)

    if (cachedProfile) {
      renderRouteProfile(cachedProfile.data)
      return
    }

    const profilePoints = getProfilePoints(targetRoute)
    const routeIsClose = Boolean(targetRoute.isClose)

    showRouteProfileLoading()

    const requestId = ++profileSamplingRequestId

    profileSamplingFrame = requestAnimationFrame(() => {
      profileSamplingFrame = null

      profileSamplingTimer = setTimeout(async () => {
        profileSamplingTimer = null
        if (requestId !== profileSamplingRequestId) return

        try {
          const cartesianPositions = transLonlat2Car3(profilePoints)
          const routeDistanceArr = getRouteProfileDistances(cartesianPositions)
          const effectiveInterval = getEffectiveProfileInterval(
            routeDistanceArr,
            Math.max(0, cartesianPositions.length - 1),
            interval,
          )
          const result = await profileAnalyseAtTerrainLevel(
            window.viewer,
            cartesianPositions,
            effectiveInterval,
            ROUTE_PROFILE_TERRAIN_LEVEL,
          )

          if (requestId !== profileSamplingRequestId) return

          const data: RouteProfileChartData = {
            distanceArray: result.distanceArray,
            elevationArray: result.elevationArray,
            orderArr: profilePoints.map((_, index) => {
              if (routeIsClose && index === profilePoints.length - 1) {
                return 1
              }
              return index + 1
            }),
            heightArr: profilePoints.map((point) => point.alt),
            routeDistanceArr,
          }

          cacheRouteProfile(targetRoute, cacheKey, data)
          renderRouteProfile(data)
        } catch (error) {
          if (requestId !== profileSamplingRequestId) return
          console.error('[drawRouteProfile] 地形剖面采样失败：', error)
          uiMsg.error('地形剖面采样失败')
        } finally {
          if (requestId === profileSamplingRequestId) {
            myChart?.hideLoading()
          }
        }
      }, 0)
    })
  }

  function redrawRouteProfile() {
    const route = getSelectedRoute()
    if (!route) return
    drawRouteProfile(route, { force: true })
  }

  function handleProfileIntervalChanged() {
    cancelPendingProfileSampling()
  }

  function scheduleProfileRefresh(isActiveTabProfile: boolean) {
    if (profileRefreshTimer) {
      clearTimeout(profileRefreshTimer)
      profileRefreshTimer = null
    }

    if (!isActiveTabProfile) return
    cancelPendingProfileSampling()

    profileRefreshTimer = setTimeout(() => {
      profileRefreshTimer = null
      if (!isActiveTabProfile) return
      drawRouteProfile(getSelectedRoute())
    }, 200)
  }

  onMounted(() => {
    const profileChartElement = document.getElementById('echarts-profile')
    if (profileChartElement && typeof ResizeObserver !== 'undefined') {
      profileChartResizeObserver = new ResizeObserver(() => {
        resizeProfileChart()
      })
      profileChartResizeObserver.observe(profileChartElement)
    }
  })

  onBeforeUnmount(() => {
    if (profileRefreshTimer) {
      clearTimeout(profileRefreshTimer)
      profileRefreshTimer = null
    }
    cancelPendingProfileSampling()
    profileChartResizeObserver?.disconnect()
    profileChartResizeObserver = null
    myChart?.dispose()
  })

  return {
    profileInterval,
    routeProfileCache,
    ensureProfileChart,
    resizeProfileChart,
    drawRouteProfile,
    redrawRouteProfile,
    handleProfileIntervalChanged,
    scheduleProfileRefresh,
    cancelPendingProfileSampling,
    clearRouteProfileCache,
  }
}
