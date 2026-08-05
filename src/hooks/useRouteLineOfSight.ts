import {
  sampleTerrain,
  Cartesian3,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
  Color,
  Entity,
  Cartesian2,
} from 'cesium'
import { ref } from 'vue'
import type { AirlinePoint } from '@/types/entityoptions'
import type { Rectangle, TerrainData, TilingScheme } from 'cesium'
import { useMessage, MessageReactive } from 'naive-ui'
// 获取 message 实例

type RouteSample = {
  distance: number
  cartographic: Cartographic
  cartesian: Cartesian3
}

type LosLineSamples = {
  cartographics: Cartographic[]
  distances: number[]
  lineHeights: number[]
  surfaceDistance: number
}

type PendingLosLine = {
  index: number
  lineSamples: LosLineSamples
}

type TerrainDataWithMesh = TerrainData & {
  createMesh(options: {
    tilingScheme: TilingScheme
    x: number
    y: number
    level: number
    throttle: boolean //是否开启限流保护性能
  }): Promise<unknown>
}

type CachedTerrainTile = {
  terrainData: TerrainDataWithMesh
  rectangle: Rectangle
  meshPromise?: Promise<void>
}

type TerrainTileGroup = {
  key: string
  x: number
  y: number
  positions: Cartographic[]
}

const MAIN_THREAD_TIME_BUDGET_MS = 8
const TIME_BUDGET_CHECK_INTERVAL = 32
const TERRAIN_SAMPLE_BATCH_SIZE = 100
const TERRAIN_SAMPLE_LEVEL = 11
const TERRAIN_TILE_CONCURRENCY = 4
const TERRAIN_REQUEST_RETRY_DELAY_MS = 20
//绘制时候的批次大小
const DRAW_BATCH_SIZE = 100
//结果2略高于原航线，避免两条线共面产生深度冲突
const LOS_RESULT_2_HEIGHT_OFFSET = 0.5
//固定间距采样点与航点累计距离足够接近时视为同一个点。
const ROUTE_SAMPLE_DISTANCE_EPSILON = 0.001
const losResult1Entities: Entity[] = []
const losResult2Entities: Entity[] = []
const viewPointEntities: Entity[] = []

export type LosResultType = 1 | 2

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

function hasExceededTimeBudget(startedAt: number) {
  return performance.now() - startedAt >= MAIN_THREAD_TIME_BUDGET_MS
}

async function yieldAndCheckCancellation(signal?: AbortSignal) {
  await yieldToMainThread()
  throwIfCancelled(signal)
  return performance.now()
}

function clearLosEntities() {
  const viewer = window.viewer
  if (!viewer) return
  if (
    losResult1Entities.length === 0 &&
    losResult2Entities.length === 0 &&
    viewPointEntities.length === 0
  ) {
    return
  }

  viewer.entities.suspendEvents()

  try {
    losResult1Entities.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    losResult1Entities.length = 0

    losResult2Entities.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    losResult2Entities.length = 0

    viewPointEntities.forEach((entity) => {
      viewer.entities.remove(entity)
    })

    viewPointEntities.length = 0
  } finally {
    viewer.entities.resumeEvents()
  }

  viewer.scene.requestRender()
}

function toggleLosResultVisibility(resultType: LosResultType) {
  const entities = resultType === 1 ? losResult1Entities : losResult2Entities
  if (entities.length === 0) return null

  const visible = !entities[0].show
  entities.forEach((entity) => {
    entity.show = visible
  })

  const viewPointVisible =
    losResult1Entities.some((entity) => entity.show) ||
    losResult2Entities.some((entity) => entity.show)
  viewPointEntities.forEach((entity) => {
    entity.show = viewPointVisible
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
  //生成一条视线上的空间高度和对应地形采样位置，不在这里请求地形。
  async function createLineSamples(
    startCartesian: Cartesian3,
    endCartesian: Cartesian3,
    interval: number,
    signal?: AbortSignal,
  ): Promise<LosLineSamples> {
    if (interval <= 0) {
      throw new Error('interval 必须大于 0')
    }
    throwIfCancelled(signal)

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
        cartographics,
        distances: [],
        lineHeights: [],
        surfaceDistance,
      }
    }

    const segmentCount = Math.ceil(surfaceDistance / interval) //采样点的数量应该是多少
    const calculateDistances = ifCalculateRefractionCorrection.value
    let accumulatedDistance = 0 //累积距离用于大气修正
    let previousCarto: Cartographic | undefined
    let sliceStartedAt = performance.now()

    for (let i = 0; i <= segmentCount; i++) {
      if (
        i > 0 &&
        i % TIME_BUDGET_CHECK_INTERVAL === 0 &&
        hasExceededTimeBudget(sliceStartedAt)
      ) {
        sliceStartedAt = await yieldAndCheckCancellation(signal)
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

      if (calculateDistances) {
        if (previousCarto) {
          accumulatedDistance += new EllipsoidGeodesic(
            previousCarto,
            terrainCarto,
          ).surfaceDistance
        }
        distances.push(accumulatedDistance)
        previousCarto = terrainCarto
      }

      cartographics.push(terrainCarto)
      lineHeights.push(lineCarto.height) //三维直线上采样点的高度
    }

    return {
      cartographics,
      distances,
      lineHeights,
      surfaceDistance,
    }
  }

  //获取一条视线的地形高度。独立调用时仍保留原有接口。
  async function sampleAlongLine(
    startCartesian: Cartesian3,
    endCartesian: Cartesian3,
    interval: number,
    signal?: AbortSignal,
  ) {
    const terrainProvider = window.viewer?.terrainProvider
    if (!terrainProvider) {
      throw new Error('terrainProvider 不存在')
    }

    const lineSamples = await createLineSamples(
      startCartesian,
      endCartesian,
      interval,
      signal,
    )

    if (lineSamples.cartographics.length > 0) {
      await sampleTerrain(
        terrainProvider,
        TERRAIN_SAMPLE_LEVEL,
        lineSamples.cartographics,
      )
      throwIfCancelled(signal)
    }

    return {
      sampledCartographics: lineSamples.cartographics,
      distances: lineSamples.distances,
      lineHeights: lineSamples.lineHeights,
      surfaceDistance: lineSamples.surfaceDistance,
    }
  }

  async function evaluateLineVisibility(
    lineSamples: LosLineSamples,
    signal?: AbortSignal,
  ) {
    const { cartographics, lineHeights, distances, surfaceDistance } =
      lineSamples
    const calculateRefraction = ifCalculateRefractionCorrection.value
    const totalDistance = calculateRefraction
      ? (distances.at(-1) ?? surfaceDistance)
      : surfaceDistance
    let sliceStartedAt = performance.now()

    for (let i = 1; i < cartographics.length - 1; i++) {
      if (
        i % TIME_BUDGET_CHECK_INTERVAL === 0 &&
        hasExceededTimeBudget(sliceStartedAt)
      ) {
        sliceStartedAt = await yieldAndCheckCancellation(signal)
      }

      let lineHeight = lineHeights[i]
      const terrainHeight = cartographics[i].height ?? 0

      if (calculateRefraction) {
        const earthRadius = 6371008.8
        const effectiveEarthRadiusFactor = 4 / 3
        const distanceFromStart = distances[i]
        const distanceToEnd = totalDistance - distanceFromStart
        const refractionCorrection =
          ((1 - 1 / effectiveEarthRadiusFactor) *
            distanceFromStart *
            distanceToEnd) /
          (2 * earthRadius)
        lineHeight += refractionCorrection
      }

      if (terrainHeight > lineHeight) {
        return false
      }
    }

    return true
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

    return evaluateLineVisibility(
      {
        cartographics: sampledCartographics,
        distances,
        lineHeights,
        surfaceDistance,
      },
      signal,
    )
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

    //航点可能恰好也是固定间距采样点，此时用精确航点坐标替换，避免重复点。
    function appendSample(distance: number, cartographic: Cartographic) {
      const sample: RouteSample = {
        distance,
        cartographic,
        cartesian: ellipsoid.cartographicToCartesian(
          cartographic,
          new Cartesian3(),
        ),
      }
      const lastSample = samples.at(-1)

      if (
        lastSample &&
        Math.abs(lastSample.distance - distance) <=
          ROUTE_SAMPLE_DISTANCE_EPSILON
      ) {
        samples[samples.length - 1] = sample
        return
      }

      samples.push(sample)
    }

    let accumulatedDistance = 0 //累计距离
    let nextSampleDistance = 0 //下一个采样点的距离
    let timeCheckCounter = 0
    let sliceStartedAt = performance.now()
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

      if (segment3dDistance === 0) {
        appendSample(accumulatedDistance, end)
        continue
      }
      //当前航段的累计总距离
      const segmentEndDistance = accumulatedDistance + segment3dDistance
      //如果下一个采样点还落在当前航段内
      while (nextSampleDistance <= segmentEndDistance) {
        timeCheckCounter++
        if (
          timeCheckCounter % TIME_BUDGET_CHECK_INTERVAL === 0 &&
          hasExceededTimeBudget(sliceStartedAt)
        ) {
          sliceStartedAt = await yieldAndCheckCancellation(signal)
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

          appendSample(nextSampleDistance, sampleCartographic)
        }

        nextSampleDistance += interval
      }

      accumulatedDistance = segmentEndDistance

      //每个航段终点都是原始航点，必须加入分析采样序列。
      appendSample(accumulatedDistance, end)
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
      //绘制出来视点位置 并添加到里面
      const viewPointEntity = window.viewer.entities.add({
        id: 'viewPoint',
        position: startCartesian,
        label: {
          text: '视点',
          pixelOffset: Cartesian2.fromArray([0, -30]),
          font: 'bold 24px', //设置为16像素
          fillColor: Color.YELLOW, // 设置为红色
        },
        point: {
          pixelSize: 16, // 点的大小（像素）
          color: Color.YELLOW, // 点的颜色
          outlineColor: Color.BLACK, // 边框颜色
          outlineWidth: 2, // 边框宽度（像素）
          show: true, // 是否显示
        },
      })
      viewPointEntities.push(viewPointEntity)
      //根据间距获取到航线上采样点
      const airLineSamples = await sampleRouteByDistance(
        airlinePoints,
        routeInterval,
        signal,
      )

      const results = await analyseWithTerrainBatches(
        airLineSamples,
        startCarto,
        losInterval,
        signal,
      )
      const result2Positions = airLineSamples.map((sample) =>
        Cartesian3.fromRadians(
          sample.cartographic.longitude,
          sample.cartographic.latitude,
          sample.cartographic.height + LOS_RESULT_2_HEIGHT_OFFSET,
        ),
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
            const result1Entity = window.viewer.entities.add({
              name: '通视分析结果1',
              show: false,
              polyline: {
                positions: [startCartesian, sample.cartesian],
                width: 1,
                material: results[index] ? Color.GREEN : Color.RED,
              },
            })
            losResult1Entities.push(result1Entity)

            if (index === 0) continue

            const segmentVisible = results[index - 1] && results[index]
            const segmentColor = segmentVisible ? Color.LIME : Color.RED

            const result2Entity = window.viewer.entities.add({
              name: '通视分析结果2',
              show: true,
              polyline: {
                positions: [
                  result2Positions[index - 1],
                  result2Positions[index],
                ],
                width: 5,
                material: segmentColor,
                depthFailMaterial: segmentColor,
              },
            })
            losResult2Entities.push(result2Entity)
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

  //多条视线共享瓦片数据，避免跨批次重复下载和创建地形网格。
  async function analyseWithTerrainBatches(
    samples: RouteSample[],
    start: Cartographic,
    interval = 200,
    signal?: AbortSignal,
  ) {
    const terrainProvider = window.viewer?.terrainProvider
    if (!terrainProvider) {
      throw new Error('terrainProvider 不存在')
    }
    //地形瓦片划分规则
    const tilingScheme = terrainProvider.tilingScheme
    //地形瓦片缓存
    const terrainTileCache = new Map<
      string,
      Promise<CachedTerrainTile | null>
    >()
    //根据某瓦片分组加载对应的 Cesium 地形瓦片，并使用缓存避免同一个瓦片被重复请求。
    async function loadTerrainTile(group: TerrainTileGroup) {
      //检查地形瓦片缓存中是否存已经
      const cachedTile = terrainTileCache.get(group.key)
      if (cachedTile) return cachedTile
      //立即执行异步函数 请求对应的地形瓦片并缓存
      const tilePromise = (async (): Promise<CachedTerrainTile | null> => {
        let requestPromise

        do {
          throwIfCancelled(signal)
          //传入x, y, level 参数，它会返回一个 Promise
          requestPromise = terrainProvider.requestTileGeometry(
            group.x,
            group.y,
            TERRAIN_SAMPLE_LEVEL,
          )
          //如果没有请求成功设置一个延迟定时 然后重复请求
          if (!requestPromise) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, TERRAIN_REQUEST_RETRY_DELAY_MS),
            )
          }
        } while (!requestPromise)

        try {
          const terrainData = (await requestPromise) as TerrainDataWithMesh
          throwIfCancelled(signal)
          return {
            terrainData,
            rectangle: tilingScheme.tileXYToRectangle(
              group.x,
              group.y,
              TERRAIN_SAMPLE_LEVEL,
            ),
          }
        } catch (error) {
          if (error instanceof LosAnalysisCancelledError) throw error
          return null
        }
      })()
      terrainTileCache.set(group.key, tilePromise)
      return tilePromise
    }
    //从地形瓦片中获取高度  返回结果是否需要创建mesh
    function interpolateTerrainHeights(
      tile: CachedTerrainTile,
      positions: Cartographic[],
    ) {
      let meshRequired = false

      for (const position of positions) {
        const height = tile.terrainData.interpolateHeight(
          tile.rectangle,
          position.longitude,
          position.latitude,
        )
        if (height === undefined) {
          meshRequired = true
          break
        }
        position.height = height
      }

      return meshRequired
    }

    async function sampleTileGroup(group: TerrainTileGroup) {
      const tile = await loadTerrainTile(group)
      throwIfCancelled(signal)

      if (!tile) {
        group.positions.forEach((position) => {
          position.height = 0
        })
        return
      }

      if (!interpolateTerrainHeights(tile, group.positions)) return

      if (!tile.meshPromise) {
        tile.meshPromise = tile.terrainData
          .createMesh({
            tilingScheme,
            x: group.x,
            y: group.y,
            level: TERRAIN_SAMPLE_LEVEL,
            throttle: false,
          })
          .then(() => undefined)
      }

      try {
        await tile.meshPromise
        throwIfCancelled(signal)
        interpolateTerrainHeights(tile, group.positions)
      } catch (error) {
        if (error instanceof LosAnalysisCancelledError) throw error
        group.positions.forEach((position) => {
          position.height = 0
        })
      }
    }

    async function sampleTerrainWithCache(positions: Cartographic[]) {
      const tileGroups = new Map<string, TerrainTileGroup>()

      for (const position of positions) {
        const tileXY = tilingScheme.positionToTileXY(
          position,
          TERRAIN_SAMPLE_LEVEL,
        )
        if (!tileXY) {
          position.height = 0
          continue
        }

        const key = `${TERRAIN_SAMPLE_LEVEL}/${tileXY.x}/${tileXY.y}`
        let group = tileGroups.get(key)
        if (!group) {
          group = {
            key,
            x: tileXY.x,
            y: tileXY.y,
            positions: [],
          }
          tileGroups.set(key, group)
        }
        group.positions.push(position)
      }

      const groups = Array.from(tileGroups.values())
      let cursor = 0

      async function worker() {
        while (cursor < groups.length) {
          throwIfCancelled(signal)
          const group = groups[cursor++]
          await sampleTileGroup(group)
        }
      }

      const workerCount = Math.min(TERRAIN_TILE_CONCURRENCY, groups.length)
      await Promise.all(Array.from({ length: workerCount }, worker))
    }

    const results = new Array<boolean>(samples.length)
    const startCartesian = Cartesian3.fromRadians(
      start.longitude,
      start.latitude,
      start.height,
    )
    let pendingLines: PendingLosLine[] = []
    let pendingCartographics: Cartographic[] = []

    async function flushPendingBatch() {
      if (pendingLines.length === 0) return

      const linesToEvaluate = pendingLines
      const cartographicsToSample = pendingCartographics
      pendingLines = []
      pendingCartographics = []

      if (cartographicsToSample.length > 0) {
        await sampleTerrainWithCache(cartographicsToSample)
        throwIfCancelled(signal)
      }

      let sliceStartedAt = performance.now()
      for (const { index, lineSamples } of linesToEvaluate) {
        results[index] = await evaluateLineVisibility(lineSamples, signal)

        if (hasExceededTimeBudget(sliceStartedAt)) {
          sliceStartedAt = await yieldAndCheckCancellation(signal)
        }
      }
    }

    async function sampleOversizedLine(lineSamples: LosLineSamples) {
      for (
        let offset = 0;
        offset < lineSamples.cartographics.length;
        offset += TERRAIN_SAMPLE_BATCH_SIZE
      ) {
        const positions = lineSamples.cartographics.slice(
          offset,
          offset + TERRAIN_SAMPLE_BATCH_SIZE,
        )
        await sampleTerrainWithCache(positions)
        throwIfCancelled(signal)
      }
    }

    let sliceStartedAt = performance.now()

    for (let index = 0; index < samples.length; index++) {
      throwIfCancelled(signal)
      const lineSamples = await createLineSamples(
        startCartesian,
        samples[index].cartesian,
        interval,
        signal,
      )

      if (lineSamples.cartographics.length > TERRAIN_SAMPLE_BATCH_SIZE) {
        await flushPendingBatch()
        await sampleOversizedLine(lineSamples)
        results[index] = await evaluateLineVisibility(lineSamples, signal)
      } else {
        const nextBatchSize =
          pendingCartographics.length + lineSamples.cartographics.length

        if (
          pendingLines.length > 0 &&
          nextBatchSize > TERRAIN_SAMPLE_BATCH_SIZE
        ) {
          await flushPendingBatch()
          sliceStartedAt = performance.now()
        }

        pendingLines.push({ index, lineSamples })
        pendingCartographics.push(...lineSamples.cartographics)
      }

      if (hasExceededTimeBudget(sliceStartedAt)) {
        sliceStartedAt = await yieldAndCheckCancellation(signal)
      }
    }

    await flushPendingBatch()

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
    toggleLosResultVisibility,
    //是否开启大气校正
    ifCalculateRefractionCorrection,
  }
}
