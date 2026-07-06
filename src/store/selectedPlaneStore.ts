// @/store/selectedPlaneStore.ts
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type * as Cesium from 'cesium'
import type { PlaneType } from '@/types/entityoptions'

export interface SelectedPlaneMeta {
  key: string
  kind: PlaneType
}

export const useSelectedPlaneStore = defineStore('selectedPlane', () => {
  const selectedModel = shallowRef<Cesium.Model | null>(null)
  const selectedMeta = ref<SelectedPlaneMeta | null>(null)

  function setSelectedPlane(model: Cesium.Model | null, meta: SelectedPlaneMeta | null) {
    selectedModel.value = model
    selectedMeta.value = meta
  }

  function clearSelectedPlane() {
    selectedModel.value = null
    selectedMeta.value = null
  }

  return {
    selectedModel,
    selectedMeta,
    setSelectedPlane,
    clearSelectedPlane,
  }
})