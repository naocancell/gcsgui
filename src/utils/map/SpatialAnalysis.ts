/**
 文件描述：空间分析方法
 创建时间：2024/4/15 9:52
 创建人：Zhaipeixiu
 */

import { getDistance, getElevation } from '@/utils/map/geocomputation.ts'
import { Cartesian3, Cartographic, EllipsoidGeodesic, Viewer } from 'cesium'
import * as echarts from 'echarts'
import { EChartsType } from 'echarts'
import { Airline } from '@/types/entityoptions.ts'
import { getTerrainHeightsAtLevel } from '@/utils/map/terrainSampling'
import { logger } from '@/utils/logger'
type ProfileResult = {
  distanceArray: number[]
  elevationArray: number[]
  terrainLevel?: number
}

function getProfileSamplePositions(
  start: Cartesian3,
  end: Cartesian3,
  interval: number,
) {
  const cartographics: Cartographic[] = []
  const distanceArray: number[] = []
  const startCartographic = Cartographic.fromCartesian(start)
  const endCartographic = Cartographic.fromCartesian(end)
  const isSameSurfacePosition =
    startCartographic.longitude === endCartographic.longitude &&
    startCartographic.latitude === endCartographic.latitude
  const geodesic = isSameSurfacePosition
    ? null
    : new EllipsoidGeodesic(startCartographic, endCartographic)
  const totalLen = geodesic?.surfaceDistance ?? 0

  cartographics.push(
    new Cartographic(
      startCartographic.longitude,
      startCartographic.latitude,
      0,
    ),
  )
  distanceArray.push(0)

  if (interval > 0 && geodesic) {
    for (
      let sampleDistance = interval;
      sampleDistance + 0.5 < totalLen;
      sampleDistance += interval
    ) {
      cartographics.push(
        geodesic.interpolateUsingSurfaceDistance(
          sampleDistance,
          new Cartographic(),
        ),
      )
      distanceArray.push(Math.round(sampleDistance))
    }
  }

  cartographics.push(
    new Cartographic(endCartographic.longitude, endCartographic.latitude, 0),
  )
  distanceArray.push(Math.round(totalLen))

  return { cartographics, distanceArray }
}

/**
 * 两点间地形剖面分析数值计算
 * @param viewer 地图Viewer
 * @param start 起点
 * @param end 终点
 * @param interval 线段采样间隔 m为单位
 * @return 从起点至终点剖面线的海拔高度数组
 */
export function elevationProfile(
  viewer: Viewer,
  start: Cartesian3,
  end: Cartesian3,
  interval: number,
) {
  const { cartographics, distanceArray } = getProfileSamplePositions(
    start,
    end,
    interval,
  )
  const elevationArray = cartographics.map((point) =>
    Math.round(getElevation(viewer, point)),
  )

  return { distanceArray, elevationArray }
}

/**
 * 折线段地形剖面分析数值计算
 * @param viewer 地图Viewer
 * @param polyline 折线点数组
 * @param interval 线段采样间隔 m为单位
 * @return 从折线起点至终点剖面线的海拔高度数组
 */
export function profileAnalyse(
  viewer: Viewer,
  polyline: Cartesian3[],
  interval: number,
) {
  let result: ProfileResult = { distanceArray: [], elevationArray: [] }
  let temp_dis = 0 //每两点之间的距离
  for (let i = 0; i <= polyline.length - 2; i++) {
    let temp = elevationProfile(viewer, polyline[i], polyline[i + 1], interval)
    result.elevationArray = result.elevationArray.concat(temp.elevationArray)
    temp.distanceArray.forEach((distance) => {
      result.distanceArray.push(distance + temp_dis)
    })
    if (temp.distanceArray.length > 0) {
      temp_dis += temp.distanceArray[temp.distanceArray.length - 1]
    }
  }
  return result
}

/**
 * 使用高度预警共用的地形接口，以指定等级为起点采样折线剖面。
 */
export async function profileAnalyseAtTerrainLevel(
  viewer: Viewer,
  polyline: Cartesian3[],
  interval: number,
  terrainLevel: number,
): Promise<ProfileResult> {
  const distanceArray: number[] = []
  const cartographics: Cartographic[] = []
  let accumulatedDistance = 0

  for (let index = 0; index < polyline.length - 1; index++) {
    const segment = getProfileSamplePositions(
      polyline[index],
      polyline[index + 1],
      interval,
    )

    segment.distanceArray.forEach((distance) => {
      distanceArray.push(distance + accumulatedDistance)
    })
    cartographics.push(...segment.cartographics)
    accumulatedDistance = distanceArray[distanceArray.length - 1] ?? 0
  }

  const terrainSample = await getTerrainHeightsAtLevel(
    viewer,
    cartographics,
    terrainLevel,
    undefined,
    {
      batchSize: 100,
      attemptsPerLevel: 3,
      retryDelayMs: 150,
    },
  )

  if (!terrainSample) {
    throw new Error(`${terrainLevel} 级及以下地形均采样失败`)
  }

  return {
    distanceArray,
    elevationArray: terrainSample.heights.map((height) => Math.round(height)),
    terrainLevel: terrainSample.level,
  }
}

/**
 * 折线段地形剖面分析数值计算（异步处理函数）
 * @param viewer 地图Viewer
 * @param route 航线
 * @param interval 线段采样间隔 m为单位
 * @return 从折线起点至终点剖面线的海拔高度数组
 */
export function profileAnalyse_promise(
  viewer: Viewer,
  route: Airline,
  interval: number,
) {
  return new Promise((resolve) => {
    let result: ProfileResult = { distanceArray: [], elevationArray: [] }
    let polyline = []
    //航线转为坐标点数组
    route.points.forEach((point) => {
      polyline.push(Cartesian3.fromDegrees(point.lon, point.lat, point.alt))
    })
    let temp_dis = 0 //每两点之间的距离
    for (let i = 0; i <= polyline.length - 2; i++) {
      let temp = elevationProfile(
        viewer,
        polyline[i],
        polyline[i + 1],
        interval,
      )
      result.elevationArray = result.elevationArray.concat(temp.elevationArray)
      temp.distanceArray.forEach((distance) => {
        result.distanceArray.push(distance + temp_dis)
      })
      if (temp.distanceArray.length > 0) {
        temp_dis += temp.distanceArray[temp.distanceArray.length - 1]
      }
    }
    resolve(result)
  })
}

/**
 * 两点间通视分析（基于最大斜率的算法） <br>
 * 返回值：通视为true，不通视为false，异常返回undefined
 * @param viewer 地图
 * @param viewpoint 视点
 * @param target 目标点
 * @param h1 视点地面挂高 m
 * @param h2 目标点地面挂高 m
 * @param curvature 是否考虑地球曲率
 * @param breakNum 采样间隔，默认为100个断点
 */
export function visibilityAnalyse(
  viewer: Viewer,
  viewpoint: Cartesian3,
  target: Cartesian3,
  h1: number,
  h2: number,
  curvature: boolean,
  breakNum = 100,
) {
  // 获取视点高度和目标点高度
  let viewpointH = getElevation(viewer, viewpoint) + h1
  let targetH = getElevation(viewer, target) + h2
  if (viewpointH === -9999.2024 + h1) {
    logger.warn('无法获取视点海拔高度！')
    return undefined
  }
  if (targetH === -9999.2024 + h2) {
    logger.warn('无法获取目标点海拔高度！')
    return undefined
  }
  // 计算首尾点距离 m
  let totalLen = getDistance(viewpoint, target) * 1000
  // 计算首尾点斜率
  let visibleK = (targetH - viewpointH) / totalLen

  // 逐个计算断点与视点的斜率
  for (let i = 1; i <= breakNum; i++) {
    let breakP = Cartesian3.lerp(
      viewpoint,
      target,
      i / breakNum,
      new Cartesian3(),
    )
    let breakPH = getElevation(viewer, breakP) //断点海拔
    if (breakPH == -9999.2024) return false

    let breakPDis = Math.floor(getDistance(viewpoint, breakP) * 1000) //断点与视点的距离
    // 计算断点与视点的斜率
    let breakPK = (breakPH - viewpointH) / breakPDis
    if (breakPK > visibleK) {
      return false
    }
  }

  if (curvature) {
    let Rmax = 2.898 * (Math.sqrt(h1) + Math.sqrt(h2))
    if (Rmax < totalLen / 1000.0) return false
  }
  return true
}

/**
 * 两点间通视分析（基于最大斜率的算法） <br>
 * 返回值：通视为true，不通视为false
 * @param profile   剖面分析的结果
 * @param curvature 是否考虑地球曲率
 * @param startExtraH 视点地面挂高 m
 * @param endExtraH   目标点地面挂高 m
 */
export function visibilityAnalyse2(
  profile: ProfileResult,
  curvature: boolean,
  startExtraH: number,
  endExtraH: number,
) {
  // 计算起点、终点的高度（海拔+挂高）m
  let startH = profile.elevationArray[0] + startExtraH
  let endH = profile.elevationArray.at(-1) + endExtraH
  // 计算首尾点斜率
  let visibleK = (endH - startH) / profile.distanceArray.at(-1)
  // 逐个计算断点与视点的斜率
  for (let i = 1; i < profile.elevationArray.length; i++) {
    let breakPK =
      (profile.elevationArray[i] - startH) / profile.distanceArray[i]
    if (breakPK > visibleK) return false
  }

  if (curvature) {
    let coefficient: number = 3.57 //考虑大气折射 4.12， 公司文件给出 2.898
    let Rmax = coefficient * (Math.sqrt(startExtraH) + Math.sqrt(endExtraH))
    if (Rmax < profile.distanceArray.at(-1) / 1000.0) return false
  }
  return true
}

/**
 * 销毁剖面与通视分析图表实例并释放资源
 */
export function disposeProfileEChart() {
  const dom = document.getElementById('profileEChart')
  if (dom) {
    const chart = echarts.getInstanceByDom(dom)
    if (chart) {
      chart.dispose()
    }
  }
}

/**
 *  绘制地形剖面折线图
 * @param xData x数组
 * @param yData y数组，以面积线绘制
 */
export function drawEchartsProfileAnalyse(xData: number[], yData: number[]) {
  const dom = document.getElementById('profileEChart')
  if (!dom) return
  let myChart = echarts.getInstanceByDom(dom) ?? echarts.init(dom)
  // 绘制图表
  myChart.setOption({
    legend: {
      show: true,
      type: 'plain',
      top: '5%',
      data: [
        {
          name: 'groundLine',
          itemStyle: 'inherit',
          lineStyle: 'inherit',
        },
      ],
    },
    tooltip: {
      show: true,
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      formatter: '地表高度: {c0}',
    },
    xAxis: {
      data: xData,
      name: '距离/米',
      nameTextStyle: {
        fontWeight: 'bolder',
        fontSize: 14,
      },
      nameLocation: 'end',
      axisLine: {
        onZero: false,
        show: true, // 是否显示坐标轴轴线
        symbol: ['none', 'arrow'],
        symbolSize: [7, 10],
      },
      axisLabel: {
        formatter: '{value}',
        margin: 5,
      },
      axisTick: {
        show: true, // 是否显示坐标轴刻度
        inside: true, // 坐标轴刻度是否朝内，默认朝外
        alignWithLabel: true,
        lineStyle: {
          color: '#000000', //刻度线的颜色
          type: 'solid', //坐标轴线线的类型（solid实线类型；dashed虚线类型；dotted点状类型）
        },
      },
    },
    yAxis: {
      type: 'value',
      name: '高度/米',
      nameTextStyle: {
        fontWeight: 'bolder',
        fontSize: 14,
      },
      nameLocation: 'end',
      position: 'left',
      axisLabel: {
        formatter: '{value}',
      },
      axisLine: {
        show: true,
        symbol: ['none', 'arrow'],
        symbolSize: [7, 10],
      },
    },
    series: [
      {
        name: 'groundLine',
        type: 'line',
        data: yData,
        areaStyle: {
          color: '#37a5fb',
          opacity: 0.5,
        },
      },
    ],
  })
}

/**
 *  绘制地形碰撞检测剖面图
 * @param myChart ECharts对象
 * @param xData x数组
 * @param yData y数组，以面积线绘制
 * @param height 水平辅助线的高度
 * @param max_distance 预先探测距离
 */
export function drawEcharts_CollisionDetection(
  myChart: EChartsType,
  xData: number[],
  yData: number[],
  height: number,
  max_distance: number,
) {
  // 绘制图表
  myChart.setOption(
    {
      /** 配置图标离容器上下左右的距离 */
      grid: {
        top: '20%',
        right: '5%',
        left: '10%',
        bottom: '12%',
      },
      legend: {
        show: true,
        type: 'plain',
        top: '5%',
        data: [
          {
            name: '地形',
            itemStyle: 'inherit',
            lineStyle: 'inherit',
          },
          {
            //视线图例
            name: '飞机高度',
            lineStyle: {
              type: 'dotted',
              width: 3,
              color: '#f8364d',
            },
            itemStyle: {
              fontSize: 18,
            },
          },
        ],
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
        },
        formatter: '地表高度: {c0}',
      },
      xAxis: {
        max: Math.ceil(max_distance).toString(),
        data: xData,
        nameTextStyle: {
          fontWeight: 'bolder',
          fontSize: 14,
        },
        nameLocation: 'bottom',
        axisLine: {
          onZero: false,
          show: true, // 是否显示坐标轴轴线
          symbol: ['none', 'arrow'],
          symbolSize: [7, 10],
        },
        axisLabel: {
          formatter: '{value} m',
          margin: 5,
        },
        axisTick: {
          show: true, // 是否显示坐标轴刻度
          inside: true, // 坐标轴刻度是否朝内，默认朝外
          alignWithLabel: true,
          lineStyle: {
            color: '#000000', //刻度线的颜色
            type: 'solid', //坐标轴线线的类型（solid实线类型；dashed虚线类型；dotted点状类型）
          },
        },
      },
      yAxis: {
        type: 'value',
        name: '高度/米',
        max: (value: any) => {
          return Math.floor(Math.max(value.max, height) * 1.01)
        },
        min: (value: any) => {
          return Math.floor(value.min * 0.99)
        },
        nameTextStyle: {
          fontWeight: 'bolder',
          fontSize: 14,
        },
        nameLocation: 'end',
        position: 'left',
        axisLabel: {
          formatter: '{value}',
        },
        axisLine: {
          show: true,
          symbol: ['none', 'arrow'],
          symbolSize: [7, 10],
        },
      },
      series: [
        {
          name: '地形',
          type: 'line',
          data: yData,
          areaStyle: {
            color: '#37a5fb',
            opacity: 0.5,
          },
          markLine: {
            name: '飞机高度',
            data: [
              {
                yAxis: height.toString(),
                itemStyle: {
                  normal: { color: '#c60c30' },
                },
              },
            ],
            symbol: ['circle', 'arrow'],
            label: {
              formatter: '飞机高度',
              show: true,
              position: 'middle',
              fontSize: 15,
              fontWeight: 'bold',
              color: '#e73d3d',
            },
            lineStyle: {
              //标注线样式
              type: 'dashed',
              color: 'red',
              width: 10,
            },
          },
        },
        {
          type: 'line',
          symbol: 'none',
          name: '飞机高度',
          color: 'transparent',
        },
      ],
    },
    false,
  )
}

/**
 *  绘制（更新）地形碰撞检测剖面图
 * @param myChart ECharts对象
 * @param xData x数组
 * @param yData y数组，以面积线绘制
 * @param yData2 y数组2，以折线绘制
 */
export function drawEcharts_CollisionDetection2(
  myChart: EChartsType,
  xData: number[],
  yData: number[],
  yData2: number[],
) {
  // 绘制图表
  myChart.setOption(
    {
      /** 配置图标离容器上下左右的距离 */
      grid: {
        top: '20%',
        right: '5%',
        left: '10%',
        bottom: '12%',
      },
      legend: {
        show: true,
        type: 'plain',
        top: '5%',
        data: [
          {
            name: '地表高度',
            itemStyle: 'inherit',
            lineStyle: 'inherit',
          },
          {
            name: '飞机高度',
            lineStyle: 'inherit',
          },
        ],
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
        },
        formatter: '地表高度: {c0}<br>飞机高度: {c1}',
      },
      xAxis: {
        data: xData,
        // name: '距离/米',
        nameTextStyle: {
          fontWeight: 'bolder',
          fontSize: 14,
        },
        nameLocation: 'end',
        axisLine: {
          onZero: false,
          show: true, // 是否显示坐标轴轴线
          symbol: ['none', 'arrow'],
          symbolSize: [7, 10],
        },
        axisLabel: {
          formatter: '{value}',
          margin: 5,
        },
        axisTick: {
          show: true, // 是否显示坐标轴刻度
          inside: true, // 坐标轴刻度是否朝内，默认朝外
          alignWithLabel: true,
          lineStyle: {
            color: '#000000', //刻度线的颜色
            type: 'solid', //坐标轴线线的类型（solid实线类型；dashed虚线类型；dotted点状类型）
          },
        },
      },
      yAxis: {
        max: (value: any) => {
          return Math.floor(value.max * 1.01)
        },
        min: (value: any) => {
          return Math.floor(value.min * 0.99)
        },
        type: 'value',
        name: '高度/米',
        nameTextStyle: {
          fontWeight: 'bolder',
          fontSize: 14,
        },
        nameLocation: 'end',
        position: 'left',
        axisLabel: {
          formatter: '{value}',
        },
        axisLine: {
          show: true,
          symbol: ['none', 'arrow'],
          symbolSize: [7, 10],
        },
      },
      series: [
        {
          name: '地表高度',
          type: 'line',
          data: yData,
          areaStyle: {
            color: '#37a5fb',
            opacity: 0.5,
          },
        },
        {
          name: '飞机高度',
          type: 'line',
          symbol: 'none',
          color: 'red',
          data: yData2,
        },
      ],
    },
    false,
  )
}

/**
 *  绘制通视分析图 面积线和直线
 * @param xData x数组，地面距离
 * @param yData y数组，以面积线绘制
 * @param startHeight 视线起始点高度（包含地面挂高）
 * @param endHeight  视线终点高度（包含地面挂高）
 */
export const drawEchartsVisibility = (
  xData: number[],
  yData: number[],
  startHeight: number,
  endHeight: number,
) => {
  const dom = document.getElementById('profileEChart')
  if (!dom) return
  let myChart = echarts.getInstanceByDom(dom) ?? echarts.init(dom) //Echarts-UnitTest
  // 绘制图表
  myChart.setOption({
    legend: {
      show: true,
      type: 'plain',
      top: '7%',
      data: [
        {
          //地形剖面图例
          name: '剖面线',
          itemStyle: {
            fontSize: 18,
          },
          lineStyle: 'inherit',
        },
        {
          //视线图例
          name: '视线',
          lineStyle: {
            type: 'dotted',
            width: 3,
            color: '#f8364d',
          },
          itemStyle: {
            fontSize: 18,
          },
        },
      ],
      selectedMode: false, //图例选择模式关闭
    },
    tooltip: {
      show: true,
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      formatter: '地表高度: {c0}',
    },
    xAxis: {
      boundaryGap: false,
      max: (value: any) => {
        return value.max * 1.01
      },
      min: 0,
      data: xData,
      name: '距离/m',
      nameTextStyle: {
        fontWeight: 'bolder',
        fontSize: 14,
      },
      nameLocation: 'end',
      axisLine: {
        onZero: false,
        show: true, // 是否显示坐标轴轴线
        symbol: ['none', 'arrow'],
        symbolSize: [7, 10],
      },
      axisLabel: {
        formatter: '{value}',
        margin: 5,
      },
      axisTick: {
        show: true, // 是否显示坐标轴刻度
        inside: true, // 坐标轴刻度是否朝内，默认朝外
        alignWithLabel: true,
        lineStyle: {
          color: '#000000', //刻度线的颜色
          type: 'solid', //坐标轴线线的类型（solid实线类型；dashed虚线类型；dotted点状类型）
        },
      },
    },
    yAxis: {
      max: (value: any) => {
        return Math.floor(Math.max(value.max, startHeight, endHeight) * 1.01)
      },
      min: (value: any) => {
        return Math.floor(Math.min(value.min, startHeight, endHeight) * 0.99)
      },
      type: 'value',
      name: '高度/ m',
      nameTextStyle: {
        fontWeight: 'bolder',
        fontSize: 14,
      },
      nameLocation: 'end',
      position: 'left',
      axisLabel: {
        formatter: '{value}',
      },
      axisLine: {
        show: true,
        symbol: ['none', 'arrow'],
        symbolSize: [7, 10],
      },
    },
    series: [
      {
        name: '剖面线',
        type: 'line',
        data: yData,
        areaStyle: {
          color: '#37a5fb',
          opacity: 0.5,
        },
        markLine: {
          data: [
            [
              { coord: ['0', startHeight.toString()] },
              { coord: [xData.at(-1)?.toString(), endHeight.toString()] },
              // Markline中的坐标点必须为string，否则异常
            ],
          ],
          symbol: ['circle', 'arrow'],
          label: {
            formatter: '模 拟 视 线',
            show: true,
            position: 'middle',
            fontSize: 15,
            fontWeight: 'bold',
            color: '#e73d3d',
          },
          lineStyle: {
            //标注线样式
            type: 'dashed',
            color: 'red',
            width: 10,
          },
        },
      },
      {
        /* 视线的series */ type: 'line',
        symbol: 'none',
        name: '视线',
        color: 'transparent',
      },
    ],
  })
}

/**
 *  航线管理页面图表
 * @param myChart
 * @param xData 地形距离数组，地面距离
 * @param yData 地形高度数组，以面积线绘制
 * @param routeArr 航点序号数组
 * @param routeHeight  航线高度数组，以折线绘制
 * @param routeDistanceArr 航点沿航线的累计距离数组
 */
export const drawEcharts_RouteDetection = (
  myChart: EChartsType,
  xData: number[],
  yData: number[],
  routeArr: number[],
  routeHeight: number[],
  routeDistanceArr: number[] = routeArr.map((_, index) => index),
) => {
  const terrainData = xData.map((distance, index) => [distance, yData[index]])
  const routeData = routeDistanceArr.map((distance, index) => ({
    value: [distance, routeHeight[index]],
    waypoint: routeArr[index],
  }))
  const profileMaxDistance = Math.max(
    0,
    xData[xData.length - 1] ?? 0,
    routeDistanceArr[routeDistanceArr.length - 1] ?? 0,
  )

  // 绘制图表
  myChart.setOption(
    {
      backgroundColor: '#101014',
      grid: {
        containLabel: true,
        top: '15%',
        // Reserve enough space for the x-axis name in the narrow route panel.
        right: 64,
        left: ' 5%',
        bottom: '5%',
      },
      legend: {
        show: true,
        type: 'plain',
        top: '7%',
        right: '5%',
        data: [
          {
            //地形剖面图例
            name: '地形剖面',
            itemStyle: { fontSize: 14 },
            lineStyle: 'inherit',
          },
          {
            //视线图例
            name: '航线高度',
            lineStyle: 'inherit',
            itemStyle: { fontSize: 14 },
          },
        ],
        selectedMode: true, //图例选择模式
        inactiveColor: '#626161',
      },
      tooltip: {
        show: true,
        appendToBody: true,
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
        },
        formatter: (params: any) => {
          const items = Array.isArray(params) ? params : [params]
          const distance = Number(items[0]?.axisValue ?? 0)
          const waypointHitTolerance = Math.max(
            1,
            (profileMaxDistance / Math.max(myChart.getWidth(), 1)) * 2,
          )
          let nearestWaypointIndex = -1
          let nearestWaypointDistance = Number.POSITIVE_INFINITY

          routeDistanceArr.forEach((waypointDistance, index) => {
            const distanceToWaypoint = Math.abs(waypointDistance - distance)

            if (distanceToWaypoint < nearestWaypointDistance) {
              nearestWaypointIndex = index
              nearestWaypointDistance = distanceToWaypoint
            }
          })

          let nearestTerrainIndex = -1
          let nearestTerrainDistance = Number.POSITIVE_INFINITY

          xData.forEach((terrainDistance, index) => {
            const distanceToTerrain = Math.abs(terrainDistance - distance)

            if (distanceToTerrain < nearestTerrainDistance) {
              nearestTerrainIndex = index
              nearestTerrainDistance = distanceToTerrain
            }
          })

          const terrainHeight =
            nearestTerrainIndex >= 0 ? yData[nearestTerrainIndex] : undefined
          const lines: string[] = []

          if (
            nearestWaypointIndex >= 0 &&
            nearestWaypointDistance <= waypointHitTolerance
          ) {
            lines.push(`航点: ${routeArr[nearestWaypointIndex]}`)
            lines.push(`航点高度: ${routeHeight[nearestWaypointIndex]}m`)
          }

          if (terrainHeight != null) {
            lines.push(`地形高度: ${terrainHeight}m`)
          }

          lines.push(`距离: ${Math.round(distance)}m`)

          return lines.join('<br>')
        },
      },
      xAxis: {
        type: 'value',
        boundaryGap: false,
        min: 0,
        max: profileMaxDistance > 0 ? profileMaxDistance : undefined,
        name: '距离/m',
        nameTextStyle: {
          fontWeight: 'bolder',
          fontSize: 12,
        },
        axisLine: {
          onZero: false,
          show: true, // 是否显示坐标轴轴线
          symbol: ['none', 'arrow'],
          symbolSize: [7, 10],
        },
        axisLabel: {
          formatter: '{value}',
          margin: 4,
        },
      },
      yAxis: {
        type: 'value',
        name: '高度/m',
        nameTextStyle: {
          fontSize: 12,
        },
        nameLocation: 'end',
        position: 'left',
        axisLabel: {
          formatter: '{value}',
          margin: 4,
        },
        axisLine: {
          show: true,
          symbol: ['none', 'arrow'],
          symbolSize: [7, 10],
        },
      },
      series: [
        {
          name: '地形剖面',
          type: 'line',
          data: terrainData,
          showSymbol: false,
          areaStyle: {
            color: '#37a5fb',
            opacity: 0.5,
          },
        },
        {
          name: '航线高度',
          type: 'line',
          data: routeData,
          lineStyle: {
            color: '#8ae73d',
          },
          symbolSize: 7,
          emphasis: {
            scale: 1.5,
            itemStyle: {
              borderColor: '#ffffff',
              borderWidth: 2,
            },
          },
        },
      ],
    },
    true,
  )
}
