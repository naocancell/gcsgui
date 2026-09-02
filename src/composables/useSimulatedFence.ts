/**
 * 文件描述：模拟电子围栏检测与警报 Composable
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import * as Cesium from 'cesium'
import { useMessage } from 'naive-ui'
import { useUavStore } from '@/store/uavStore'
import type { PlaneState } from '@/types/entityoptions'
import { normalizeUAVInfo, normalizeFP981C } from '@/utils/plane/planeAdapter'
import {
  createSimulatedElectronicFence,
  getSimulatedElectronicFenceAlerts,
  removeSimulatedElectronicFence,
  SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION,
  type ElectronicFenceResult,
  type SimulatedElectronicFence,
} from '@/utils/map/simulatedElectronicFence'

export function formatFenceDistance(distanceMeters: number): string {
  return distanceMeters > 10_000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`
}

export function extractMonitoredPlanes(uavStore: ReturnType<typeof useUavStore>): PlaneState[] {
  const planes: PlaneState[] = []
  uavStore.uavInfoMap?.forEach((uav) => {
    if (Number.isFinite(uav.longitude) && Number.isFinite(uav.latitude)) {
      planes.push(normalizeUAVInfo(uav))
    }
  })
  uavStore.fp981cMap?.forEach((item) => {
    if (item.c2) planes.push(normalizeFP981C(item))
  })
  return planes
}

export function useSimulatedFence() {
  const message = useMessage()
  const uavStore = useUavStore()

  const simulatedFenceVisible = ref(false)
  const simulatedFenceResults = ref<ElectronicFenceResult[]>([])
  const simulatedFenceRef = ref<SimulatedElectronicFence | null>(null)
  let simulatedFence: SimulatedElectronicFence | null = null

  function getMonitoredPlanes(): PlaneState[] {
    return extractMonitoredPlanes(uavStore)
  }

  function refreshSimulatedFenceResults() {
    if (!simulatedFenceVisible.value || !simulatedFence) return
    simulatedFenceResults.value = getSimulatedElectronicFenceAlerts(
      simulatedFence,
      getMonitoredPlanes(),
    )
  }

  function focusSimulatedArea() {
    const viewer = window.viewer as Cesium.Viewer | undefined
    if (!viewer) return

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION.lon,
        SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION.lat,
        450_000,
      ),
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
      duration: 1.5,
    })
  }

  function toggleSimulatedFence() {
    if (!window.viewer) {
      message.warning('地图尚未准备完成')
      return
    }
    if (simulatedFenceVisible.value) {
      simulatedFenceVisible.value = false
      removeSimulatedElectronicFence(window.viewer, simulatedFence)
      simulatedFence = null
      simulatedFenceRef.value = null
      simulatedFenceResults.value = []
      return
    }

    simulatedFence = createSimulatedElectronicFence(
      window.viewer,
      SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION,
    )
    simulatedFenceRef.value = simulatedFence
    simulatedFenceVisible.value = true
    refreshSimulatedFenceResults()
    focusSimulatedArea()
    window.viewer.scene.requestRender()
  }

  function toggleMockFlight() {
    const wasMockRunning = uavStore.isMock
    uavStore.toggleMockUavInfoService()
    if (!wasMockRunning) focusSimulatedArea()
  }

  watch(
    () => [uavStore.uavInfoMap, uavStore.fp981cMap],
    refreshSimulatedFenceResults,
  )

  onBeforeUnmount(() => {
    if (window.viewer && simulatedFence) {
      removeSimulatedElectronicFence(window.viewer, simulatedFence)
    }
    simulatedFence = null
    simulatedFenceRef.value = null
  })

  return {
    simulatedFenceVisible,
    simulatedFenceResults,
    simulatedFence: simulatedFenceRef,
    toggleSimulatedFence,
    refreshSimulatedFenceResults,
    focusSimulatedArea,
    toggleMockFlight,
    formatFenceDistance,
    getMonitoredPlanes,
  }
}
