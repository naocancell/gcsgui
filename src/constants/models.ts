/**
 * 3D模型资源路径定义
 */
import cesiumAirPlane from '@/assets/models/Cesium_Air.glb?url'
import fp985Plane from '@/assets/models/FP-985.gltf?url'
import fp98Plane from '@/assets/models/fp-98.gltf?url'

export interface ModelAssetMap {
  defaultAirPlane: string
  fp985: string
  fp98: string
}

/** 默认3D模型资源配置字典 */
export const MODEL_ASSETS: Readonly<ModelAssetMap> = {
  defaultAirPlane: cesiumAirPlane,
  fp985: fp985Plane,
  fp98: fp98Plane,
} as const

export { cesiumAirPlane, fp985Plane, fp98Plane }
