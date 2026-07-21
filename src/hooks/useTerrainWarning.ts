// @/hooks/useTerrainWarning.ts
import * as Cesium from 'cesium'
import { ref } from 'vue'
//参数
interface TerrainWarningOptions {
  distance?: number      // 前视距离, 默认 1000 米
  steps?: number         // 把这段距离切成多少段, 默认 20,也就是 21 个点
  intervalMs?: number    // 多久采样一次,默认 500 毫秒
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
  aircraftPosition: Cesium.Cartesian3,//飞机世界坐标
  headingDeg: number,//飞机航向用于计算点的位置
  totalDistance: number, //总距离目前是1000米
  steps: number,//分几段
) {
  const aircraftCarto =
    Cesium.Cartographic.fromCartesian(aircraftPosition)

  /*
   * 获取飞机正下方
   * 使用飞机经纬度, 局部坐标系原点高度设为0，
   * 高度0m获取对应的地面点的高度。
   */
  const groundOrigin =
    Cesium.Cartesian3.fromRadians(
      aircraftCarto.longitude,
      aircraftCarto.latitude,
      0,
    )

  const heading =
    Cesium.Math.toRadians(headingDeg)
  //以飞机底部投影点为原点构建局部坐标系eastNorthUpToFixedFrame
  const enu =
    Cesium.Transforms.eastNorthUpToFixedFrame(
      groundOrigin,
    )

  const cartographics: Cesium.Cartographic[] = []
  const distances: number[] = []

  for (let i = 0; i <= steps; i++) {
    const currentDistance =
      (totalDistance / steps) * i

    const east =
      Math.sin(heading) * currentDistance

    const north =
      Math.cos(heading) * currentDistance

    const localPoint =
      new Cesium.Cartesian3(
        east,
        north,
        0,
      )
    //再将局部坐标系下的某个点转成世界坐标
    const worldPoint =
      Cesium.Matrix4.multiplyByPoint(
        enu,
        localPoint,
        new Cesium.Cartesian3(),
      )
    //将世界坐标转成经纬度
    const carto =
      Cesium.Cartographic.fromCartesian(worldPoint)

    /*
     * ENU切平面转回经纬度时会产生约0.078m的曲率高度，
     * 查询地形时明确清零。
     */
    cartographics.push(
      new Cesium.Cartographic(
        carto.longitude,
        carto.latitude,
        0,
      ),
    )
    //每一段长度的数组 0 50 100 150 200 ...1000
    distances.push(currentDistance)
  }

  return {
    cartographics,//经纬度,高度0m
    distances,
  }
}
//查询地形高度
function getTerrainHeightsFromGlobe(
  cartographics: Cesium.Cartographic[],
): number[] | null {
  //拿到地球对象
  const globe = window.viewer.scene.globe

  const heights: number[] = []
  const invalidIndexes: number[] = []

  cartographics.forEach((carto, index) => {
    /*
     * 创建一个高度为0的新对象。
     * 避免任何原始高度参与查询结果。
     */
    const queryPoint =
      new Cesium.Cartographic(
        carto.longitude,
        carto.latitude,
        0,
      )

    const height =
      globe.getHeight(queryPoint)

    if (
      height === undefined ||
      height === null ||
      !Number.isFinite(height)
    ) {
      invalidIndexes.push(index)
      return
    }

    heights.push(height)
  })

  if (invalidIndexes.length > 0) {
    console.warn(
      '部分天地图地形瓦片尚未加载：',
      invalidIndexes,
    )

    return null
  }

  return heights
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
        intervalMs = 500,
        warnClearance = 100,
    } = options

    const active = ref(false)
    const isWarning = ref(false)
    const minClearance = ref<number>(Infinity)//实时的最低净空

    // 给左侧面板用的剖面数据
    const profilePoints = ref<TerrainProfilePoint[]>([])

    let flightPositions: Cesium.Cartesian3[] = []//飞机预计飞行点
    let terrainPositions: Cesium.Cartesian3[] = []// 地形线的点

    let flightEntity: Cesium.Entity | null = null
    let terrainEntity: Cesium.Entity | null = null
    let removeTick: Cesium.Event.RemoveCallback | null = null

    let lastSampleTime = 0 // 上次采样的时间戳(节流用)
    let sampling = false  //是否正在采样(防重入)
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
            clampToGround: true,
            },
        })
        }
    }


    async function update() {
        const now = Date.now()

        /*
        * 把节流放到最前面。
        * 避免Cesium每一帧都重新计算前向点。
        */
        if (
            sampling ||
            now - lastSampleTime < intervalMs
        ) {
            return
        }

        const aircraftPosition =
            getAircraftPosition()

        const aircraftHeading =
            getAircraftHeading()

        if (!aircraftPosition) {
            console.warn(
            '高度预警：未获取到选中飞机位置',
            )
            return
        }

        if (
            aircraftHeading === undefined ||
            aircraftHeading === null ||
            !Number.isFinite(Number(aircraftHeading))
        ) {
            console.warn(
            '高度预警：未获取到有效航向',
            aircraftHeading,
            )
            return
        }

        lastSampleTime = now
        sampling = true

        try {
            const aircraftCarto =
            Cesium.Cartographic.fromCartesian(
                aircraftPosition,
            )

            // 飞机当前绝对海拔高度
            const flightHeight =
            aircraftCarto.height

            /*
            * 生成前方1000m地面经纬度点。
            * 
            */
            const {
                cartographics,
                distances,
            } = buildForwardGroundPoints(
                aircraftPosition,
                Number(aircraftHeading),
                distance,
                steps,
            )

            /*
            * 直接读取Cesium Globe中已经加载的天地图地形。
            */
            const terrainHeights =getTerrainHeightsFromGlobe(cartographics,)

            /*
            * 天地图瓦片尚未加载时，不使用旧高度，
            * 也不使用0，等待下一次更新重试。
            */
            if (!terrainHeights) {console.log('前方地形瓦片尚未加载，等待下一次采样')

            viewer.scene.requestRender()
            return
        }

        /*
        * 飞机预计飞行轨迹线：
        * 沿当前航向前进1000m，
        * 高度暂时保持当前飞行高度。
        */
        flightPositions =
        cartographics.map((carto) =>
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
        terrainPositions =
        cartographics.map(
            (carto, index) =>
            Cesium.Cartesian3.fromRadians(
                carto.longitude,
                carto.latitude,
                terrainHeights[index] + 1,
            ),
        )

        /*
        * 左侧面板数据。
        */
        profilePoints.value =
        cartographics.map((_, index) => {
            const terrainHeight =
            terrainHeights[index]

            return {
            distance: distances[index],
            terrainHeight,
            flightHeight,
            clearance:
                flightHeight - terrainHeight,
            }
        })

        minClearance.value = Math.min(
        ...profilePoints.value.map(
            (point) => point.clearance,
        ),
        )

        isWarning.value =
        minClearance.value < warnClearance

        viewer.scene.requestRender()
    } catch (error) {
        console.error(
        '高度预警地形计算失败：',
        error,
        )

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

        profilePoints.value = []

        flightPositions = []
        terrainPositions = []

        if (removeTick) {
        removeTick()
        removeTick = null
        }

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
        profilePoints,
        distance,
        warnClearance,
        start,
        stop,
        toggle,
    }
}