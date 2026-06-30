/*
后端接收过来的结构转换为固定渲染结构 
 */
import type { UAVInfo, FP95Frame94Sub1,PlaneState } from "@/types/entityoptions";


export function normalizeUAVInfo(uav: UAVInfo): PlaneState {
  return {
    id: `uavInfo:${uav.uavSeries}:${uav.uavId}`,
    type: "uavInfo",

    lon: uav.longitude,
    lat: uav.latitude,
    alt: uav.altitude,

    heading: uav.headingAngle,
    pitch: uav.pitchAngle,
    roll: uav.rollAngle,
    raw: uav,
    showTrail: true,//显示轨迹线
  };
}

export function normalizeFP95(item: FP95Frame94Sub1): PlaneState {
  return {
    id: `fp95:${item.sAddress}`,
    type: "fp95",

    lon: item.adsLon,
    lat: item.adsLat,
    alt: item.adsAlt,

    heading: item.adsYaw,
    pitch: 0,
    roll: 0,
    raw: item,
    showTrail: false,//不显示轨迹线
  };
}