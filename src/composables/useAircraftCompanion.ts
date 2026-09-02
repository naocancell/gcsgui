/**
 * 文件描述：三维飞机伴飞跟踪 Composable
 */
import { ref, onBeforeUnmount } from 'vue'
import * as Cesium from 'cesium'
import { useMessage } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useSelectedPlaneStore, type SelectedPlaneMeta } from '@/store/selectedPlaneStore'
import { useUavStore } from '@/store/uavStore'

export function getAircraftHeading(meta: SelectedPlaneMeta, uavStore: ReturnType<typeof useUavStore>): number | undefined {
  if (meta.kind === 'uavInfo') {
    return uavStore.uavInfoMap.get(meta.key)?.headingAngle
  }

  if (meta.kind === 'fp95') {
    const fp95 = uavStore.fp95Aggregate
    if (fp95 && `fp95:${fp95.uavId}` === meta.key) {
      return fp95.frame81?.headingAngle ?? fp95.frame83?.groundTrack
    }
  }

  if (meta.kind === 'fp981c') {
    const fp981c = uavStore.fp981cMap.get(meta.key.replace('fp981c:', ''))
    return (
      (fp981c?.c1?.head_angle ?? fp981c?.c2?.ground_speed_direct ?? 0) / 100
    )
  }

  return undefined
}

export function constrainCompanionOffset(
  offset: Cesium.Cartesian3,
  minimumCompanionHeight = 30,
  minimumCompanionRange = 80,
) {
  offset.z = Math.max(offset.z, minimumCompanionHeight)
  const range = Cesium.Cartesian3.magnitude(offset)
  if (range < minimumCompanionRange) {
    Cesium.Cartesian3.multiplyByScalar(
      offset,
      minimumCompanionRange / Math.max(range, 1),
      offset,
    )
  }
}

export function useAircraftCompanion() {
  const message = useMessage()
  const selectedPlaneStore = useSelectedPlaneStore()
  const { selectedModel, selectedMeta } = storeToRefs(selectedPlaneStore)
  const uavStore = useUavStore()

  const companionMode = ref(false)
  let companionModel: Cesium.Model | null = null
  let removeCompanionRender: (() => void) | null = null

  function getSelectedAircraftHeading(): number | undefined {
    const meta = selectedMeta.value
    if (!meta) return undefined
    return getAircraftHeading(meta, uavStore)
  }

  function stopCompanionMode() {
    const viewer = window.viewer as Cesium.Viewer | undefined
    removeCompanionRender?.()
    removeCompanionRender = null

    if (viewer) {
      viewer.trackedEntity = undefined
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    }

    companionModel = null
    companionMode.value = false
  }

  function startCompanionMode() {
    const viewer = window.viewer as Cesium.Viewer | undefined
    const model = selectedModel.value
    if (
      !viewer ||
      !model ||
      model.isDestroyed() ||
      !viewer.scene.primitives.contains(model)
    ) {
      stopCompanionMode()
      message.warning('请先在地图上选中一架飞机')
      return
    }

    removeCompanionRender?.()
    companionModel = model

    const initialHeading = Cesium.Math.toRadians(
      getSelectedAircraftHeading() ?? 0,
    )
    const followDistance = 250
    const targetPosition = new Cesium.Cartesian3()
    const initialCameraOffset = new Cesium.HeadingPitchRange(
      initialHeading,
      Cesium.Math.toRadians(-20),
      followDistance,
    )
    const cameraOffset = new Cesium.Cartesian3()
    let hasAppliedInitialView = false

    const updateCompanionCamera = () => {
      if (
        !companionModel ||
        companionModel.isDestroyed() ||
        !viewer.scene.primitives.contains(companionModel)
      ) {
        stopCompanionMode()
        return
      }

      if (hasAppliedInitialView) {
        Cesium.Cartesian3.clone(viewer.camera.position, cameraOffset)
        constrainCompanionOffset(cameraOffset)
      }

      Cesium.Matrix4.getTranslation(companionModel.modelMatrix, targetPosition)

      viewer.camera.lookAt(
        targetPosition,
        hasAppliedInitialView ? cameraOffset : initialCameraOffset,
      )
      hasAppliedInitialView = true
    }

    viewer.scene.preRender.addEventListener(updateCompanionCamera)
    removeCompanionRender = () => {
      viewer.scene.preRender.removeEventListener(updateCompanionCamera)
    }
    updateCompanionCamera()
    companionMode.value = true
  }

  function activeCompanionMode() {
    if (companionMode.value) {
      stopCompanionMode()
    } else {
      startCompanionMode()
    }
  }

  onBeforeUnmount(() => {
    stopCompanionMode()
  })

  return {
    companionMode,
    startCompanionMode,
    stopCompanionMode,
    activeCompanionMode,
    getSelectedAircraftHeading,
  }
}
