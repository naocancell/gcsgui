/**
 * 文件描述：地形剖面计算与高度预警 Composable
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as Cesium from 'cesium'
import { useMessage } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useSelectedPlaneStore, type SelectedPlaneMeta } from '@/store/selectedPlaneStore'
import { useUavStore } from '@/store/uavStore'
import { useTerrainWarning } from '@/hooks/useTerrainWarning'
import { getAircraftHeading } from '@/composables/useAircraftCompanion'

export const profileWidth = 340
export const profileHeight = 180
export const profilePadding = 28

export function calculateProfileRange(points: { terrainHeight: number; flightHeight: number }[]) {
  if (!points.length) return null

  const heights = points.flatMap((p) => [p.terrainHeight, p.flightHeight])
  const min = Math.min(...heights)
  const max = Math.max(...heights)
  const padding = Math.max(20, (max - min) * 0.15)

  return {
    min: min - padding,
    max: max + padding,
  }
}

export function computeProfileX(
  distanceM: number,
  warningDistance: number,
  width = profileWidth,
  padding = profilePadding,
): number {
  const usableWidth = width - padding * 2
  return padding + (distanceM / warningDistance) * usableWidth
}

export function computeProfileY(
  height: number,
  range: { min: number; max: number } | null,
  pHeight = profileHeight,
  padding = profilePadding,
): number {
  if (!range) return pHeight - padding
  const usableHeight = pHeight - padding * 2
  const ratio = (height - range.min) / (range.max - range.min)
  return pHeight - padding - ratio * usableHeight
}

export function getAircraftLabel(meta: SelectedPlaneMeta, uavStore: ReturnType<typeof useUavStore>): string {
  if (meta.kind === 'uavInfo') {
    const uav = uavStore.uavInfoMap.get(meta.key)
    if (uav) return `${uav.uavSeries}-${uav.uavId}`
  }

  if (meta.kind === 'fp95') {
    const aircraftId = meta.key.replace('fp95:', '')
    return `FP95-${aircraftId}`
  }

  const aircraftId = meta.key.replace('fp981c:', '')
  return `FP981C-${aircraftId}`
}

export function useTerrainWarningProfile() {
  const message = useMessage()
  const selectedPlaneStore = useSelectedPlaneStore()
  const { selectedModel, selectedMeta } = storeToRefs(selectedPlaneStore)
  const uavStore = useUavStore()

  const terrainWarningApi = ref<ReturnType<typeof useTerrainWarning> | null>(null)
  type TerrainWarningTarget = {
    model: Cesium.Model
    meta: SelectedPlaneMeta
  }
  let terrainWarningTarget: TerrainWarningTarget | null = null
  const terrainWarningTargetLabel = ref('')
  const terrainWarningDistance = ref(10000)
  const terrainWarningClearance = ref(100)
  const terrainWarningDistanceInput = ref<number | null>(10000)
  const terrainWarningClearanceInput = ref<number | null>(100)

  function getTerrainWarningAircraftPosition(): Cesium.Cartesian3 | undefined {
    const model = terrainWarningTarget?.model
    if (!model || model.isDestroyed()) return undefined
    return Cesium.Matrix4.getTranslation(
      model.modelMatrix,
      new Cesium.Cartesian3(),
    )
  }

  function getTerrainWarningAircraftHeading(): number | undefined {
    const meta = terrainWarningTarget?.meta
    return meta ? getAircraftHeading(meta, uavStore) : undefined
  }

  const profileRange = computed(() => {
    return calculateProfileRange(terrainProfilePoints.value)
  })

  function profileX(distanceM: number) {
    return computeProfileX(distanceM, terrainWarningDistance.value)
  }

  function profileY(height: number) {
    return computeProfileY(height, profileRange.value)
  }

  const terrainPolylinePoints = computed(() => {
    return terrainProfilePoints.value
      .map((p) => `${profileX(p.distance)},${profileY(p.terrainHeight)}`)
      .join(' ')
  })

  const flightPolylinePoints = computed(() => {
    return terrainProfilePoints.value
      .map((p) => `${profileX(p.distance)},${profileY(p.flightHeight)}`)
      .join(' ')
  })

  const profileMinHeightLabel = computed(() => {
    if (!profileRange.value) return '--'
    return profileRange.value.min.toFixed(0)
  })

  const profileMaxHeightLabel = computed(() => {
    if (!profileRange.value) return '--'
    return profileRange.value.max.toFixed(0)
  })

  const terrainWarningAircraftHeight = computed(() => {
    const height = terrainProfilePoints.value[0]?.flightHeight
    return Number.isFinite(height) ? `${height.toFixed(0)} m` : '--'
  })

  function applyTerrainWarningOptions() {
    terrainWarningApi.value?.updateOptions({
      distance: terrainWarningDistance.value,
      warnClearance: terrainWarningClearance.value,
    })
  }

  function updateTerrainWarningDistance(value: number | null) {
    if (value === null || value < 1000 || value > 10000) return
    terrainWarningDistance.value = value
    applyTerrainWarningOptions()
  }

  function updateTerrainWarningClearance(value: number | null) {
    if (value === null || value < 100 || value > 2000) return
    terrainWarningClearance.value = value
    applyTerrainWarningOptions()
  }

  function restoreTerrainWarningInputs() {
    terrainWarningDistanceInput.value = terrainWarningDistance.value
    terrainWarningClearanceInput.value = terrainWarningClearance.value
  }

  const terrainWarningActive = computed(
    () => terrainWarningApi.value?.active ?? false,
  )

  const terrainWarningIsDanger = computed(
    () => terrainWarningApi.value?.isWarning ?? false,
  )

  const terrainWarningMinClearance = computed(
    () => terrainWarningApi.value?.minClearance ?? Infinity,
  )

  const terrainProfilePoints = computed(
    () => terrainWarningApi.value?.profilePoints ?? [],
  )

  const terrainWarningStatusText = computed(() => {
    if (!terrainWarningActive.value) return '未开启'
    if (terrainWarningMinClearance.value === Infinity) {
      return '地形采样中'
    }
    const clearance = terrainWarningMinClearance.value.toFixed(0)
    return terrainWarningIsDanger.value
      ? `危险：最小离地高度 ${clearance} m`
      : `安全：最小离地高度 ${clearance} m`
  })

  function toggleSelectedPlaneTerrainWarning() {
    if (terrainWarningActive.value) {
      terrainWarningApi.value?.stop()
      terrainWarningTarget = null
      terrainWarningTargetLabel.value = ''
      return
    }

    if (!selectedModel.value || !selectedMeta.value) {
      message.warning('请先选中一架飞机')
      return
    }

    const meta = { ...selectedMeta.value }
    const label = getAircraftLabel(meta, uavStore)
    terrainWarningTarget = {
      model: selectedModel.value,
      meta,
    }
    terrainWarningTargetLabel.value = label
    terrainWarningApi.value?.start()
  }

  function initTerrainWarning() {
    if (!window.viewer) return
    terrainWarningApi.value = useTerrainWarning(
      window.viewer,
      getTerrainWarningAircraftPosition,
      getTerrainWarningAircraftHeading,
      {
        distance: terrainWarningDistance.value,
        steps: 50,
        intervalMs: 100,
        terrainLevel: 13,
        warnClearance: terrainWarningClearance.value,
      },
    )
  }

  onMounted(() => {
    initTerrainWarning()
  })

  onBeforeUnmount(() => {
    terrainWarningApi.value?.stop()
  })

  return {
    terrainWarningApi,
    terrainWarningTargetLabel,
    terrainWarningDistance,
    terrainWarningClearance,
    terrainWarningDistanceInput,
    terrainWarningClearanceInput,
    terrainWarningActive,
    terrainWarningIsDanger,
    terrainWarningMinClearance,
    terrainProfilePoints,
    terrainPolylinePoints,
    flightPolylinePoints,
    profileRange,
    profileMinHeightLabel,
    profileMaxHeightLabel,
    terrainWarningAircraftHeight,
    terrainWarningStatusText,
    profileWidth,
    profileHeight,
    profilePadding,
    profileX,
    profileY,
    initTerrainWarning,
    applyTerrainWarningOptions,
    updateTerrainWarningDistance,
    updateTerrainWarningClearance,
    restoreTerrainWarningInputs,
    toggleSelectedPlaneTerrainWarning,
  }
}
