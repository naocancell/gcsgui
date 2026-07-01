/*
飞机类型配置表（模型/材质集中管理）
 */
import * as Cesium from "cesium";
import type { PlaneType } from "@/types/entityoptions";
import fp98 from "@/assets/models/fp-98.gltf";
//飞机加载时候的配置信息
export interface PlaneConfig {
  url: string;
  scale: number;
  minimumPixelSize: number;
  maximumScale: number;
  color: Cesium.Color;
  colorBlendAmount: number;
}
//约束飞机的模型和材质
export const PLANE_CONFIG: Record<PlaneType, PlaneConfig> = {
  uavInfo: {
    url: fp98,
    scale: 0.1,
    minimumPixelSize: 64,
    maximumScale: 20000,
    color: Cesium.Color.RED,
    colorBlendAmount: 0.8,
  },
  fp95: {
    url: fp98,
    scale: 0.15,
    minimumPixelSize: 64,
    maximumScale: 20000,
    color: Cesium.Color.LIME,
    colorBlendAmount: 0.7,
  },
};