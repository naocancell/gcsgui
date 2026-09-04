/**
 * 模拟飞机导引的页面业务控制器。
 *
 * 负责表单状态、地图选点、Cesium 标记和导引启停；
 * 路径规划与位置推进放在 simulatedGuidance.ts，飞机数据的定时更新由 uavStore 负责
 */
import * as Cesium from 'cesium'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import { useSelectedPlaneStore } from '@/store/selectedPlaneStore'
import { useUavStore } from '@/store/uavStore'
import {
  createLineGuidance,
  createOrbitGuidance,
  SIMULATED_GUIDANCE_MAX_VERTICAL_SPEED,
  type SimulatedGuidance,
} from '@/utils/map/simulatedGuidance'

export type GuidanceMode = 'line' | 'orbit'
export type GuidancePointKind = 'start' | 'target' | 'center'

// 导引线直接使用飞行高度，不额外增加显示偏移，避免和飞机实际轨迹看起来不重合
const GUIDANCE_DISPLAY_OFFSET = 0

export function useSimulatedGuidance() {
  const message = useMessage()
  const uavStore = useUavStore()
  const selectedPlaneStore = useSelectedPlaneStore()
  const { selectedMeta } = storeToRefs(selectedPlaneStore)

  // 弹窗表单状态：用于本次导引配置
  const guidanceMode = ref<GuidanceMode | null>(null)
  const showGuidanceModal = ref(false)
  const guidanceStart = ref<{ lon: number; lat: number } | null>(null)
  const guidanceTarget = ref<{ lon: number; lat: number } | null>(null)
  const guidanceCenter = ref<{ lon: number; lat: number } | null>(null)
  const guidanceAltitude = ref(500)
  const guidanceRadius = ref(500)
  const guidanceLaps = ref(2)
  const guidancePicking = ref<GuidancePointKind | null>(null)

  // 记录当前正在执行导引的飞机。用户选中其他飞机后，仍要能正确取消原来的导引。
  const guidanceActive = ref(false)
  const guidanceAircraftKey = ref<string | null>(null)

  // Cesium 事件和实体不是响应式数据，单独保存引用，结束导引时统一销毁。
  let guidancePickHandler: Cesium.ScreenSpaceEventHandler | null = null
  let guidanceRouteEntities: Cesium.Entity[] = []
  let guidancePointMarkers: Cesium.Entity[] = []
  let guidancePreviousCursor = ''

  // 当前功能只支持模拟服务生成的 UAVInfo 飞机，不对真实遥测目标下发导引
  const canGuideSelectedPlane = computed(() =>
    Boolean(uavStore.isMock && selectedMeta.value?.kind === 'uavInfo'),
  )

  const guidanceMenuOptions = computed(() => [
    { label: '直线导引', key: 'line', disabled: !canGuideSelectedPlane.value },
    { label: '盘旋导引', key: 'orbit', disabled: !canGuideSelectedPlane.value },
    {
      label: '取消当前导引',
      key: 'cancel',
      disabled: !guidanceActive.value && !guidanceMode.value,
    },
  ])

  // 每次执行操作前都重新从 Store 取飞机，避免使用弹窗打开时留下的旧数据。
  function getSelectedSimulatedUav() {
    const key = selectedMeta.value?.key
    if (!key || !canGuideSelectedPlane.value) return null
    const uav = uavStore.uavInfoMap.get(key)
    return uav ? { key, uav } : null
  }

  // 一次只保留一个地图选点监听；否则重复打开选点会让一次点击触发多个回调
  function destroyGuidancePickHandler(keepPointPicking = false) {
    const viewer = window.viewer as Cesium.Viewer | undefined
    guidancePickHandler?.destroy()
    guidancePickHandler = null
    guidancePicking.value = null
    if (viewer) viewer.scene.canvas.style.cursor = guidancePreviousCursor
    guidancePreviousCursor = ''
    if (!keepPointPicking) window.guidancePointPicking = false
  }

  // 清理由本功能创建的起点、终点和圆心标记，不影响地图上的其他实体
  function clearGuidancePointMarkers() {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (viewer) {
      guidancePointMarkers.forEach((entity) => viewer.entities.remove(entity))
    }
    guidancePointMarkers = []
  }

  function markGuidancePoint(
    kind: GuidancePointKind,
    point: { lon: number; lat: number },
  ) {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (!viewer) return
    const label =
      kind === 'start'
        ? '直线起点'
        : kind === 'target'
          ? '直线终点'
          : '盘旋圆心'
    const old = guidancePointMarkers.find(
      (entity) => entity.id === `guidance-${kind}`,
    )
    if (old) viewer.entities.remove(old)
    const marker = viewer.entities.add({
      id: `guidance-${kind}`,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0),
      point: {
        pixelSize: 12,
        color: kind === 'center' ? Cesium.Color.CYAN : Cesium.Color.ORANGE,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: label,
        font: 'bold 14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    guidancePointMarkers = guidancePointMarkers.filter(
      (entity) => entity !== old,
    )
    guidancePointMarkers.push(marker)
    viewer.scene.requestRender()
  }

  function elevateGuidancePointMarkers(
    guidance: SimulatedGuidance,
    altitude: number,
  ) {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (!viewer) return
    const points = {
      start: guidance.start,
      target: guidance.target,
      center: guidance.center,
    }
    ;(['start', 'target', 'center'] as const).forEach((kind) => {
      const point = points[kind]
      const marker = guidancePointMarkers.find(
        (entity) => entity.id === `guidance-${kind}`,
      )
      if (!point || !marker) return
      marker.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(
          point.lon,
          point.lat,
          Math.max(0, altitude),
        ),
      )
      if (marker.point) {
        marker.point.heightReference = new Cesium.ConstantProperty(
          Cesium.HeightReference.NONE,
        )
      }
    })
    viewer.scene.requestRender()
  }

  // 优先取地球/地形交点，点到飞机模型或已有航线时也尽量返回下面的地面坐标。
  function pickGuidanceGroundPoint(
    viewer: Cesium.Viewer,
    position: Cesium.Cartesian2,
  ) {
    const ray = viewer.camera.getPickRay(position)
    if (ray) {
      const groundPoint = viewer.scene.globe.pick(ray, viewer.scene)
      if (groundPoint) return groundPoint
    }
    if (viewer.scene.pickPositionSupported) {
      const depthPoint = viewer.scene.pickPosition(position)
      if (depthPoint) return depthPoint
    }
    return viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
  }

  function pickGuidancePoint(kind: GuidancePointKind) {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (!viewer) {
      message.warning('地图尚未初始化完成，请稍后再试')
      return
    }
    destroyGuidancePickHandler()
    guidancePicking.value = kind
    window.guidancePointPicking = true
    guidancePreviousCursor = viewer.scene.canvas.style.cursor
    viewer.scene.canvas.style.cursor = 'crosshair'

    // 选点时暂时隐藏弹窗，避免遮挡地图；选中或失败后再恢复。
    showGuidanceModal.value = false
    guidancePickHandler = new Cesium.ScreenSpaceEventHandler(
      viewer.scene.canvas,
    )
    guidancePickHandler.setInputAction(
      (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const point = pickGuidanceGroundPoint(viewer, event.position)
        if (!point) {
          message.warning('无法获取该位置的地面坐标，请重新选择')
          showGuidanceModal.value = true
          return
        }
        const cartographic = Cesium.Cartographic.fromCartesian(point)
        const picked = {
          lon: Cesium.Math.toDegrees(cartographic.longitude),
          lat: Cesium.Math.toDegrees(cartographic.latitude),
        }
        if (kind === 'start') guidanceStart.value = picked
        else if (kind === 'target') guidanceTarget.value = picked
        else guidanceCenter.value = picked
        markGuidancePoint(kind, picked)

        // 此次点击之后 PlaneInfo 仍可能收到同一个 Cesium 事件，因此继续保留抑制标记，
        // 等用户开始或取消导引时再释放，避免选点顺带改变当前选中的飞机。
        destroyGuidancePickHandler(true)
        showGuidanceModal.value = true
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    )
  }

  // 删除旧导引线，重新应用参数时地图上只显示最新的一条。
  function removeGuidanceRoute() {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (viewer) {
      guidanceRouteEntities.forEach((entity) => viewer.entities.remove(entity))
    }
    guidanceRouteEntities = []
  }

  function drawGuidanceRoute(guidance: SimulatedGuidance) {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (!viewer) return
    removeGuidanceRoute()
    const altitudeDelta = guidance.altitude - guidance.currentAltitude

    // 按最大垂直速度反推爬升/下降所需的水平距离，用它给整条三维导引线分配高度。
    const climbDistance =
      Math.abs(altitudeDelta) > 0
        ? (guidance.speed * Math.abs(altitudeDelta)) /
          SIMULATED_GUIDANCE_MAX_VERTICAL_SPEED
        : 0
    let travelledDistance = 0
    const positions = guidance.points.map((point, index) => {
      if (index > 0) {
        const previous = guidance.points[index - 1]
        const geodesic = new Cesium.EllipsoidGeodesic(
          Cesium.Cartographic.fromDegrees(previous.lon, previous.lat),
          Cesium.Cartographic.fromDegrees(point.lon, point.lat),
        )
        travelledDistance += geodesic.surfaceDistance
      }
      const climbProgress =
        climbDistance > 0 ? Math.min(1, travelledDistance / climbDistance) : 1
      const routeAltitude =
        guidance.currentAltitude + altitudeDelta * climbProgress
      return Cesium.Cartesian3.fromDegrees(
        point.lon,
        point.lat,
        routeAltitude + GUIDANCE_DISPLAY_OFFSET,
      )
    })
    if (
      climbDistance > travelledDistance &&
      guidance.points.length > 0 &&
      Math.abs(altitudeDelta) > 0
    ) {
      // 航线太短而高度尚未到达目标值时，在终点补出剩余的高度变化。
      const lastPoint = guidance.points[guidance.points.length - 1]
      positions.push(
        Cesium.Cartesian3.fromDegrees(
          lastPoint.lon,
          lastPoint.lat,
          guidance.altitude + GUIDANCE_DISPLAY_OFFSET,
        ),
      )
    }
    guidanceRouteEntities.push(
      viewer.entities.add({
        polyline: {
          positions,
          width: 4,
          material:
            guidance.mode === 'orbit' ? Cesium.Color.CYAN : Cesium.Color.ORANGE,
          clampToGround: false,
        },
      }),
    )
    viewer.scene.requestRender()
  }

  function cancelGuidance() {
    // 优先取消实际执行导引的飞机，不能直接依赖用户此刻选中的飞机。
    const key = guidanceAircraftKey.value ?? selectedMeta.value?.key
    if (key) {
      uavStore.clearSimulatedGuidance(key)
      uavStore.resumeSimulatedPlane(key)
    }
    removeGuidanceRoute()
    clearGuidancePointMarkers()
    guidanceActive.value = false
    guidanceAircraftKey.value = null
    guidanceMode.value = null
    showGuidanceModal.value = false
    destroyGuidancePickHandler()
  }

  function openGuidance(mode: GuidanceMode) {
    if (!canGuideSelectedPlane.value) {
      message.warning('请先开启模拟飞行并选中模拟飞机')
      return
    }
    if (guidanceActive.value || guidanceMode.value) cancelGuidance()
    const selected = getSelectedSimulatedUav()
    if (!selected) return

    // 配置和地图选点期间暂停原有的直线模拟，防止飞机移动后起始状态失效。
    uavStore.pauseSimulatedPlane(selected.key)
    guidanceAircraftKey.value = selected.key
    guidanceAltitude.value = Math.max(
      0,
      Math.round(selected.uav.altitude ?? 500),
    )
    guidanceMode.value = mode
    guidanceStart.value = null
    guidanceTarget.value = null
    guidanceCenter.value = null
    clearGuidancePointMarkers()
    showGuidanceModal.value = true
  }

  function applyGuidance() {
    const selected = getSelectedSimulatedUav()
    if (!selected) {
      message.warning('请先选中模拟飞机')
      return
    }

    // 以点击“开始导引”这一刻的遥测作为路径规划起始状态。
    const start = {
      lon: selected.uav.longitude,
      lat: selected.uav.latitude,
      heading: selected.uav.headingAngle,
      speed: selected.uav.groundSpeed,
      altitude: selected.uav.altitude,
    }
    let guidance: SimulatedGuidance
    try {
      if (guidanceMode.value === 'line') {
        if (!guidanceStart.value || !guidanceTarget.value) {
          message.warning('请在地图上选择直线起点和终点')
          return
        }
        guidance = createLineGuidance(
          start,
          guidanceStart.value,
          guidanceTarget.value,
          guidanceAltitude.value,
        )
      } else if (guidanceMode.value === 'orbit') {
        if (!guidanceCenter.value) {
          message.warning('请在地图上选择盘旋圆心')
          return
        }
        guidance = createOrbitGuidance(
          start,
          guidanceCenter.value,
          guidanceRadius.value,
          guidanceLaps.value,
          guidanceAltitude.value,
        )
      } else {
        return
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导引路径生成失败')
      return
    }

    // Store 接管后会在模拟定时器中持续调用 guidancePosition 推进飞机位置。
    if (!uavStore.setSimulatedGuidance(selected.key, guidance)) {
      message.error('导引仅支持模拟飞行中的 UAVInfo 飞机')
      return
    }
    drawGuidanceRoute(guidance)
    elevateGuidancePointMarkers(guidance, guidance.altitude)

    // 理论上一次只控制一架飞机；若选择对象发生过变化，先恢复之前的飞机。
    if (
      guidanceAircraftKey.value &&
      guidanceAircraftKey.value !== selected.key
    ) {
      uavStore.clearSimulatedGuidance(guidanceAircraftKey.value)
      uavStore.resumeSimulatedPlane(guidanceAircraftKey.value)
    }
    guidanceAircraftKey.value = selected.key
    guidanceActive.value = true
    showGuidanceModal.value = false
    window.guidancePointPicking = false
    message.success(
      guidance.mode === 'line' ? '直线导引已开始' : '盘旋导引已开始',
    )
  }

  function handleGuidanceMenu(key: string | number) {
    if (key === 'line' || key === 'orbit') openGuidance(key)
    else if (key === 'cancel') cancelGuidance()
  }

  watch(
    () => uavStore.isMock,
    (running) => {
      // 模拟服务关闭后，导引引用和 Cesium 临时实体也必须同步清掉。
      if (!running && (guidanceActive.value || guidanceMode.value)) {
        cancelGuidance()
      }
    },
  )

  // 工具栏所在组件卸载时释放地图事件和实体，避免再次进入页面后重复响应。
  onBeforeUnmount(cancelGuidance)

  return {
    guidanceMode,
    showGuidanceModal,
    guidanceStart,
    guidanceTarget,
    guidanceCenter,
    guidanceAltitude,
    guidanceRadius,
    guidanceLaps,
    guidancePicking,
    guidanceActive,
    guidanceMenuOptions,
    canGuideSelectedPlane,
    pickGuidancePoint,
    applyGuidance,
    cancelGuidance,
    handleGuidanceMenu,
  }
}
