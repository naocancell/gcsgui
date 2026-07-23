// @/hooks/useTerrainWarning.ts
import * as Cesium from 'cesium'
import { ref } from 'vue'
import { getTerrainHeightsAtLevel } from '@/utils/map/terrainSampling'
//参数
interface TerrainWarningOptions {
  distance?: number // 前视距离, 默认 1000 米
  steps?: number // 把这段距离切成多少段, 默认 20,也就是 21 个点
  intervalMs?: number // 最小采样间隔, 0 表示跟随 Cesium tick 尽快刷新
  terrainLevel?: number // 固定地形采样等级, 不跟随相机缩放变化
  warnClearance?: number // 净空低于这个值就报警,默认 100 米
}
//面板展示的数据 后面是一个数组
export interface TerrainProfilePoint {
  distance: number
  terrainHeight: number
  flightHeight: number
  clearance: number
}

//算出前方一排地面点
function buildForwardGroundPoints(
  aircraftPosition: Cesium.Cartesian3, //飞机世界坐标
  headingDeg: number, //飞机航向用于计算点的位置
  totalDistance: number, //总距离目前是1000米
  steps: number, //分几段
) {
  const aircraftCarto = Cesium.Cartographic.fromCartesian(aircraftPosition)

  /*
   * 获取飞机正下方
   * 使用飞机经纬度, 局部坐标系原点高度设为0，
   * 高度0m获取对应的地面点的高度。
   */
  const groundOrigin = Cesium.Cartesian3.fromRadians(
    aircraftCarto.longitude,
    aircraftCarto.latitude,
    0,
  )

  const heading = Cesium.Math.toRadians(headingDeg)
  //以飞机底部投影点为原点构建局部坐标系eastNorthUpToFixedFrame
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(groundOrigin)

  const cartographics: Cesium.Cartographic[] = []
  const distances: number[] = []

  for (let i = 0; i <= steps; i++) {
    const currentDistance = (totalDistance / steps) * i

    const east = Math.sin(heading) * currentDistance

    const north = Math.cos(heading) * currentDistance

    const localPoint = new Cesium.Cartesian3(east, north, 0)
    //再将局部坐标系下的某个点转成世界坐标
    const worldPoint = Cesium.Matrix4.multiplyByPoint(
      enu,
      localPoint,
      new Cesium.Cartesian3(),
    )
    //将世界坐标转成经纬度
    const carto = Cesium.Cartographic.fromCartesian(worldPoint)

    /*
     * ENU切平面转回经纬度时会产生约0.078m的曲率高度，
     * 查询地形时明确清零。
     */
    cartographics.push(
      new Cesium.Cartographic(carto.longitude, carto.latitude, 0),
    )
    //每一段长度的数组 0 50 100 150 200 ...1000
    distances.push(currentDistance)
  }

  return {
    cartographics, //经纬度,高度0m
    distances,
  }
}
//主函数
export function useTerrainWarning(
  viewer: Cesium.Viewer,
  getAircraftPosition: () => Cesium.Cartesian3 | undefined,
  getAircraftHeading: () => number | undefined,
  options: TerrainWarningOptions = {},
) {
  //设置默认值
  const {
    distance = 1000,
    steps = 20,
    intervalMs = 0,
    terrainLevel = 11,
    warnClearance = 100,
  } = options

  const active = ref(false)
  const isWarning = ref(false)
  const minClearance = ref<number>(Infinity) //实时的最低净空
  const actualTerrainLevel = ref<number | null>(null)

  // 给左侧面板用的剖面数据
  const profilePoints = ref<TerrainProfilePoint[]>([])

  let flightPositions: Cesium.Cartesian3[] = [] //飞机预计飞行点
  let terrainPositions: Cesium.Cartesian3[] = [] // 地形线的点

  let flightEntity: Cesium.Entity | null = null
  let terrainEntity: Cesium.Entity | null = null
  let removeTick: Cesium.Event.RemoveCallback | null = null

  let lastSampleTime = 0 // 上次采样的时间戳(节流用)
  let sampling = false //是否正在采样(防重入)
  let pendingSample = false //采样期间有新 tick 时，结束后立即补采最新位置
  let sampleVersion = 0
  let cachedTerrainLevel: number | undefined
  function createEntities() {
    if (!flightEntity) {
      flightEntity = viewer.entities.add({
        id: 'terrain-warning-flight-line',
        polyline: {
          positions: new Cesium.CallbackProperty(() => flightPositions, false),
          width: 3,
          material: Cesium.Color.CYAN,
          clampToGround: false,
        },
      })
    }

    if (!terrainEntity) {
      terrainEntity = viewer.entities.add({
        id: 'terrain-warning-ground-line',
        polyline: {
          positions: new Cesium.CallbackProperty(() => terrainPositions, false),
          width: 3,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => {
              return isWarning.value ? Cesium.Color.RED : Cesium.Color.LIME
            }, false),
          ),
          clampToGround: false,
        },
      })
    }
  }

  async function update() {
    if (!active.value) return

    const now = performance.now()

    /*
     * 把节流放到最前面。
     * 避免Cesium每一帧都重新计算前向点。
     */
    if (sampling) {
      pendingSample = true
      return
    }

    if (intervalMs > 0 && now - lastSampleTime < intervalMs) {
      pendingSample = true
      return
    }

    pendingSample = false

    const aircraftPosition = getAircraftPosition()

    const aircraftHeading = getAircraftHeading()

    if (!aircraftPosition) {
      console.warn('高度预警：未获取到选中飞机位置')
      return
    }

    if (
      aircraftHeading === undefined ||
      aircraftHeading === null ||
      !Number.isFinite(Number(aircraftHeading))
    ) {
      console.warn('高度预警：未获取到有效航向', aircraftHeading)
      return
    }

    lastSampleTime = now
    sampling = true
    const currentSampleVersion = ++sampleVersion

    try {
      const aircraftCarto = Cesium.Cartographic.fromCartesian(aircraftPosition)

      // 飞机当前绝对海拔高度
      const flightHeight = aircraftCarto.height

      /*
       * 生成前方1000m地面经纬度点。
       *
       */
      const { cartographics, distances } = buildForwardGroundPoints(
        aircraftPosition,
        Number(aircraftHeading),
        distance,
        steps,
      )

      /*
       * 按固定地形等级采样，不使用 globe.getHeight。
       * globe.getHeight 依赖相机当前加载到的瓦片，缩放会改变精度。
       */
      const terrainSample = await getTerrainHeightsAtLevel(
        viewer,
        cartographics,
        terrainLevel,
        cachedTerrainLevel,
      )

      if (!active.value || currentSampleVersion !== sampleVersion) {
        return
      }

      /*
       * 固定等级地形采样失败时，不使用旧高度，
       * 也不使用0，等待下一次更新重试。
       */
      if (!terrainSample) {
        console.log('前方固定等级地形采样失败，等待下一次采样')

        viewer.scene.requestRender()
        return
      }

      cachedTerrainLevel = terrainSample.level
      actualTerrainLevel.value = terrainSample.level
      const terrainHeights = terrainSample.heights

      /*
       * 飞机预计飞行轨迹线：
       * 沿当前航向前进1000m，
       * 高度暂时保持当前飞行高度。
       */
      flightPositions = cartographics.map((carto) =>
        Cesium.Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          flightHeight,
        ),
      )

      /*
       * 地图上的地形剖面线。
       * 抬高1m，避免与地表完全重叠产生闪烁。
       */
      terrainPositions = cartographics.map((carto, index) =>
        Cesium.Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          terrainHeights[index] + 1,
        ),
      )

      /*
       * 左侧面板数据。
       */
      profilePoints.value = cartographics.map((_, index) => {
        const terrainHeight = terrainHeights[index]

        return {
          distance: distances[index],
          terrainHeight,
          flightHeight,
          clearance: flightHeight - terrainHeight,
        }
      })

      minClearance.value = Math.min(
        ...profilePoints.value.map((point) => point.clearance),
      )

      isWarning.value = minClearance.value < warnClearance

      viewer.scene.requestRender()
    } catch (error) {
      console.error('高度预警地形计算失败：', error)

      /*
       * 发生异常时，不要显示错误的“正常”状态。
       */
      profilePoints.value = []
      flightPositions = []
      terrainPositions = []
      minClearance.value = Infinity
      isWarning.value = false
    } finally {
      sampling = false
      if (pendingSample && active.value) {
        void update()
      }
    }
  }

  function start() {
    if (active.value) return

    active.value = true
    // createEntities()

    removeTick = viewer.clock.onTick.addEventListener(() => {
      update()
    })
  }

  function stop() {
    active.value = false
    isWarning.value = false
    minClearance.value = Infinity
    actualTerrainLevel.value = null

    profilePoints.value = []

    flightPositions = []
    terrainPositions = []

    if (removeTick) {
      removeTick()
      removeTick = null
    }

    pendingSample = false
    sampling = false
    sampleVersion++
    cachedTerrainLevel = undefined

    if (flightEntity) {
      viewer.entities.remove(flightEntity)
      flightEntity = null
    }

    if (terrainEntity) {
      viewer.entities.remove(terrainEntity)
      terrainEntity = null
    }
  }

  function toggle() {
    if (active.value) {
      stop()
    } else {
      start()
    }
  }

  return {
    active,
    isWarning,
    minClearance,
    actualTerrainLevel,
    profilePoints,
    distance,
    warnClearance,
    start,
    stop,
    toggle,
  }
}
