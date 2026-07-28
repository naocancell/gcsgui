import {
  sampleTerrain,
  Cartesian3,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
  Color,
  Entity,
} from 'cesium'
import { ref } from 'vue'
import type { AirlinePoint } from '@/types/entityoptions'
import { useMessage, MessageReactive } from 'naive-ui'
// 获取 message 实例

type RouteSample = {
  distance: number
  cartographic: Cartographic
  cartesian: Cartesian3
}
//分析每次的批次大小
const ANALYSIS_CHUNK_SIZE = 250
//绘制时候的批次大小
const DRAW_BATCH_SIZE = 100
const losEntities: Entity[] = []

class LosAnalysisCancelledError extends Error {
  constructor() {
    super('LOS analysis cancelled')
    this.name = 'LosAnalysisCancelledError'
  }
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new LosAnalysisCancelledError()
}
//暂时停止当前异步函数，将js主线程交还给浏览器，让浏览器有机会处理镜头、点击和界面渲染后，再继续分析。
function yieldToMainThread() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function clearLosEntities() {
  const viewer = window.viewer
  if (!viewer || losEntities.length === 0) return

  viewer.entities.suspendEvents()

  try {
    losEntities.forEach((entity) => {
      viewer.entities.remove(entity)
    })

    losEntities.length = 0
  } finally {
    viewer.entities.resumeEvents()
  }

  viewer.scene.requestRender()
}

function toggleLosEntitiesVisibility() {
  if (losEntities.length === 0) return null

  const visible = !losEntities[0].show
  losEntities.forEach((entity) => {
    entity.show = visible
  })
  window.viewer?.scene.requestRender()

  return visible
}
export function useRouteLineOfSight() {
  //开始分析的时候一直显示消息
  const message = useMessage()
  let messageReactive: MessageReactive | null = null
  let activeAnalysisController: AbortController | null = null
  const ifCalculateRefractionCorrection = ref<boolean>(false)
  const losAnalysing = ref<boolean>(false)
  //获取两个点之间的三维直线采样点及地面对应的点的地形高度
  /*
      @param startCartesian: Cartesian3
      @param endCartesian: Cartesian3
      @param interval //间隔多少米进行采样
    */
  async function sampleAlongLine(
    startCartesian: Cartesian3,
    endCartesian: Cartesian3,
    interval: number,
    signal?: AbortSignal,
  ) {
    if (interval <= 0) {
      throw new Error('interval 必须大于 0')
    }
    const terrainProvider = window.viewer?.terrainProvider
    if (!terrainProvider) {
      throw new Error('terrainProvider 不存在')
    }

    const cartographics: Cartographic[] = [] //插值点的经纬度（无高度）
    const distances: number[] = [] //各采样点沿地表投影的累计距离
    const lineHeights: number[] = []

    // 使用椭球面距离确定采样数量。
    const startCarto = Cartographic.fromCartesian(startCartesian)
    const endCarto = Cartographic.fromCartesian(endCartesian)
    const geodesic = new EllipsoidGeodesic(startCarto, endCarto) //沿着椭球体形成测线
    const surfaceDistance = geodesic.surfaceDistance //测线长度距离
    if (surfaceDistance === 0) {
      return {
        sampledCartographics: [],
        distances: [],
        lineHeights: [],
        surfaceDistance,
      }
    }

    const segmentCount = Math.ceil(surfaceDistance / interval) //采样点的数量应该是多少
    let accumulatedDistance = 0 //累积距离用于大气修正
    let previousCarto: Cartographic | undefined

    for (let i = 0; i <= segmentCount; i++) {
      //当这一批次执行完毕的时候,就暂停一次，并检查是否终止分析
      if (i > 0 && i % ANALYSIS_CHUNK_SIZE === 0) {
        await yieldToMainThread()
        throwIfCancelled(signal)
      }

      const t = i / segmentCount
      //对应的三维插值 获取三维直线上的一个点
      const linePoint = Cartesian3.lerp(
        startCartesian,
        endCartesian,
        t,
        new Cartesian3(),
      )
      const lineCarto = Cartographic.fromCartesian(linePoint)
      const terrainCarto = new Cartographic(
        lineCarto.longitude,
        lineCarto.latitude,
        0,
      )
      //计算地面上的累计距离
      if (previousCarto) {
        accumulatedDistance += new EllipsoidGeodesic(
          previousCarto,
          terrainCarto,
        ).surfaceDistance
      }

      cartographics.push(terrainCarto)
      distances.push(accumulatedDistance)
      lineHeights.push(lineCarto.height) //三维直线上采样点的高度
      previousCarto = terrainCarto
    }
    //采样点（地形高度）
    const sampledCartographics = await sampleTerrain(
      terrainProvider,
      11,
      cartographics,
    )
    throwIfCancelled(signal)

    // 输出每个采样点对应的最大可用地形瓦片等级（控制台输出）
    // const sampleTileInfos = sampledCartographics.map((carto, index) => {
    //   const availability = terrainProvider.availability

    //   const level = availability
    //     ? availability.computeMaximumLevelAtPosition(carto)
    //     : undefined

    //   const tileXY =
    //     level !== undefined
    //       ? terrainProvider.tilingScheme.positionToTileXY(carto, level)
    //       : undefined

    //   return {
    //     index,
    //     distance: distances[index],
    //     longitude: CesiumMath.toDegrees(carto.longitude),
    //     latitude: CesiumMath.toDegrees(carto.latitude),
    //     height: carto.height,
    //     level,
    //     tileX: tileXY?.x,
    //     tileY: tileXY?.y,
    //   }
    // })
    //console.table(sampleTileInfos)
    // 统计总点数
    //const totalCount = sampledCartographics.length
    // 统计没有获取到地形高度的点
    //const missingHeightIndexes: number[] = []

    // sampledCartographics.forEach((carto, index) => {
    //   if (carto.height === undefined || Number.isNaN(carto.height)) {
    //     missingHeightIndexes.push(index)
    //   }
    // })
    //const missingHeightCount = missingHeightIndexes.length
    //const validHeightCount = totalCount - missingHeightCount
    // const stats = {
    //   totalCount,
    //   validHeightCount,
    //   missingHeightCount,
    //   missingHeightIndexes,
    // }
    //console.log('地形采样统计:', stats)
    return {
      sampledCartographics,
      distances,
      lineHeights,
      surfaceDistance,
    }
  }
  //获取两点之间三维直角坐标直线上对应的采样点  对比高度
  async function isVisiable(
    startCarto: Cartographic,
    endCarto: Cartographic,
    interval: number,
    signal?: AbortSignal,
  ) {
    const startCartesian = Cartesian3.fromRadians(
      startCarto.longitude,
      startCarto.latitude,
      startCarto.height,
    )
    const endCartesian = Cartesian3.fromRadians(
      endCarto.longitude,
      endCarto.latitude,
      endCarto.height,
    )
    const { sampledCartographics, lineHeights, distances, surfaceDistance } =
      await sampleAlongLine(startCartesian, endCartesian, interval, signal)

    for (let i = 1; i < sampledCartographics.length - 1; i++) {
      if (i % ANALYSIS_CHUNK_SIZE === 0) {
        await yieldToMainThread()
        throwIfCancelled(signal)
      }

      let lineHeight = lineHeights[i]
      let terrainHeight = sampledCartographics[i].height
      if (terrainHeight === undefined) {
        terrainHeight = 0
      }

      //等效地球半径修正模型
      if (ifCalculateRefractionCorrection.value) {
        const earthRadius = 6371008.8
        const effectiveEarthRadiusFactor = 4 / 3
        const totalDistance = distances.at(-1) ?? surfaceDistance
        const distanceFromStart = distances[i]
        const distanceToEnd = totalDistance - distanceFromStart
        const refractionCorrection =
          ((1 - 1 / effectiveEarthRadiusFactor) *
            distanceFromStart *
            distanceToEnd) /
          (2 * earthRadius)
        lineHeight += refractionCorrection
      }
      //console.log(terrainHeight,lineHeight)
      if (terrainHeight > lineHeight) {
        return false
      }
    }
    // console.log(
    //   routeVisable ? '通视，考虑地形及地球曲率' : '不通视，被地形遮挡',
    // )
    return true
  }
  //对航点进行采样（500m）
  async function sampleRouteByDistance(
    routePoints: AirlinePoint[],
    interval = 500,
    signal?: AbortSignal,
  ): Promise<RouteSample[]> {
    if (routePoints.length < 2) return []
    if (interval <= 0) throw new Error('采样间隔必须大于0')

    const ellipsoid = Ellipsoid.WGS84 //WGS84 地球椭球体对象。
    const samples: RouteSample[] = [] //航线上采样点

    let accumulatedDistance = 0 //累计距离
    let nextSampleDistance = 0 //下一个采样点的距离
    let generatedSampleCount = 0
    //遍历航点 一段一段处理
    for (let i = 0; i < routePoints.length - 1; i++) {
      const startPoint = routePoints[i]
      const endPoint = routePoints[i + 1]

      const start = Cartographic.fromDegrees(
        startPoint.lon,
        startPoint.lat,
        startPoint.alt,
      )
      const end = Cartographic.fromDegrees(
        endPoint.lon,
        endPoint.lat,
        endPoint.alt,
      )

      const geodesic = new EllipsoidGeodesic(start, end, ellipsoid)
      const surfaceDistance = geodesic.surfaceDistance
      const heightDifference = end.height - start.height //高差

      // 将椭球表面距离近似换算为当前飞行高度处的弧长。
      const averageHeight = (start.height + end.height) / 2
      //水平距离
      const horizontalDistance =
        surfaceDistance * (1 + averageHeight / ellipsoid.maximumRadius)

      // 当前航段的近似三维长度。
      const segment3dDistance = Math.hypot(horizontalDistance, heightDifference)

      if (segment3dDistance === 0) continue
      //当前航段的累计总距离
      const segmentEndDistance = accumulatedDistance + segment3dDistance
      //如果下一个采样点还落在当前航段内
      while (nextSampleDistance <= segmentEndDistance) {
        if (
          generatedSampleCount > 0 &&
          generatedSampleCount % ANALYSIS_CHUNK_SIZE === 0
        ) {
          await yieldToMainThread()
          throwIfCancelled(signal)
        }

        //比上一个航段距离长
        const localDistance = nextSampleDistance - accumulatedDistance
        //是否落在本航段内部
        if (localDistance >= 0) {
          //在本行段中采样点的累计长度所占的比例
          const fraction = localDistance / segment3dDistance

          // 经纬度沿椭球测地线插值，非Cartesian3直线插值。
          const sampleCartographic = geodesic.interpolateUsingFraction(
            fraction,
            new Cartographic(),
          )

          // 高度在航点之间线性变化。
          sampleCartographic.height = start.height + heightDifference * fraction

          samples.push({
            distance: nextSampleDistance,
            cartographic: sampleCartographic,
            cartesian: ellipsoid.cartographicToCartesian(
              sampleCartographic,
              new Cartesian3(),
            ),
          })
          generatedSampleCount++
        }

        nextSampleDistance += interval
      }

      accumulatedDistance = segmentEndDistance
    }

    // 如果终点不刚好落在500米倍数处，额外保留航线终点。
    const lastPoint = routePoints.at(-1)!
    const lastSampleDistance = samples.at(-1)?.distance ?? -1

    if (accumulatedDistance - lastSampleDistance > 0.001) {
      const cartographic = Cartographic.fromDegrees(
        lastPoint.lon,
        lastPoint.lat,
        lastPoint.alt,
      )

      samples.push({
        distance: accumulatedDistance,
        cartographic,
        cartesian: ellipsoid.cartographicToCartesian(cartographic),
      })
    }

    return samples
  }

  //拿到选中的飞机的航点数据函数
  function getSelectedRoute() {
    const routeManage = window.routeManageViewer
    const routeId = routeManage?.selectedRouteId

    if (!routeId) {
      message.info('请选中一条行航线！')
      return null
    }

    const routeItem = routeManage.routesMap?.get(String(routeId))

    if (!routeItem) {
      return null
    }
    //飞机航点数组AirlinePoints
    return routeItem.line.points
  }
  //取消通视分析
  function stopLosAnalysis() {
    const controller = activeAnalysisController
    if (!controller || controller.signal.aborted) return false
    //发出取消任务信号
    controller.abort()
    activeAnalysisController = null
    losAnalysing.value = false
    messageReactive?.destroy()
    messageReactive = null
    clearLosEntities()
    message.info('已停止通视分析')
    return true
  }

  //绘制观察点到采样点的los 传入一个观察点
  async function drawLosEntities(
    startCarto: Cartographic,
    routeInterval = 500,
    losInterval = 200,
  ) {
    //拿到飞机航点数据
    const airlinePoints = getSelectedRoute()
    if (!airlinePoints) {
      return
    }

    if (losAnalysing.value) {
      message.warning('正在进行无线电通视分析，请稍后！')
      return
    }
    //一直显示正在进行通视分析
    messageReactive = message.loading('正在进行通视分析', {
      duration: 0,
    })
    //清除上一次的结果实体
    clearLosEntities()
    losAnalysing.value = true
    const controller = new AbortController()
    const { signal } = controller
    activeAnalysisController = controller

    try {
      const startCartesian = Cartesian3.fromRadians(
        startCarto.longitude,
        startCarto.latitude,
        startCarto.height,
      )
      //根据间距获取到航线上采样点
      const airLineSamples = await sampleRouteByDistance(
        airlinePoints,
        routeInterval,
        signal,
      )

      const results = await analyseWithConcurrency(
        airLineSamples,
        startCarto,
        1,
        losInterval,
        signal,
      )

      for (
        let batchStart = 0;
        batchStart < airLineSamples.length;
        batchStart += DRAW_BATCH_SIZE
      ) {
        await yieldToMainThread()
        throwIfCancelled(signal)

        const batchEnd = Math.min(
          batchStart + DRAW_BATCH_SIZE,
          airLineSamples.length,
        )
        window.viewer.entities.suspendEvents()
        try {
          for (let index = batchStart; index < batchEnd; index++) {
            const sample = airLineSamples[index]
            const entity = window.viewer.entities.add({
              name: 'los实体',
              polyline: {
                positions: [startCartesian, sample.cartesian],
                width: 1,
                material: results[index] ? Color.GREEN : Color.RED,
              },
            })
            losEntities.push(entity)
          }
        } finally {
          window.viewer.entities.resumeEvents()
        }
      }

      window.viewer.scene.requestRender()
      return true
    } catch (error) {
      if (error instanceof LosAnalysisCancelledError) return false
      throw error
    } finally {
      if (activeAnalysisController === controller) {
        activeAnalysisController = null
        losAnalysing.value = false
        //分析完成不再显示
        messageReactive?.destroy()
        messageReactive = null
      }
    }
  }

  //限制一次性分析los的数量
  async function analyseWithConcurrency(
    samples: RouteSample[],
    start: Cartographic,
    concurrency = 3,
    interval = 200,
    signal?: AbortSignal,
  ) {
    const results = new Array<boolean>(samples.length)
    let cursor = 0

    async function worker() {
      while (cursor < samples.length) {
        throwIfCancelled(signal)
        const index = cursor++
        const sample = samples[index]

        // 每条LOS最多约1000个地形采样点，最小间隔200m。
        results[index] = await isVisiable(
          start,
          sample.cartographic,
          interval,
          signal,
        )
      }
    }

    const workerCount = Math.min(concurrency, samples.length)

    await Promise.all(Array.from({ length: workerCount }, worker))

    return results
  }

  //对两个点之间进行通视分析
  return {
    isVisiable,
    sampleAlongLine,
    sampleRouteByDistance, //对航线进行采样
    getSelectedRoute,
    drawLosEntities,
    stopLosAnalysis,
    toggleLosEntitiesVisibility,
    //是否开启大气校正
    ifCalculateRefractionCorrection,
  }
}
