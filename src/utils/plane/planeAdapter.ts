/*
后端接收过来的结构转换为固定渲染结构 
 */
import type { UAVInfo, FP95Aggregate, FP981CAggregate, PlaneState } from "@/types/entityoptions";


export function normalizeUAVInfo(uav: UAVInfo): PlaneState {
  return {
    id: `${uav.uavSeries}:${uav.uavId}`,
    type: "uavInfo",

    lon: uav.longitude,
    lat: uav.latitude,
    alt: uav.altitude,
    groundSpeed: uav.groundSpeed, // 水平地速 m/s
    verticalSpeed: uav.verticalSpeed, // 垂直速度 m/s
    heading: uav.headingAngle,
    pitch: uav.pitchAngle,
    roll: uav.rollAngle,
    raw: uav,
    showTrail: true,//显示轨迹线
  };
}

export function normalizeFP95(item: FP95Aggregate): PlaneState | null {
  if (!item.frame83) return null;
  return {
    id: `fp95:${item.uavId}`,
    type: "fp95",

    lon: item.frame83.longitude,
    lat: item.frame83.latitude,
    alt: item.frame83.altitude,
    groundSpeed: item.frame83.groundSpeed,
    verticalSpeed: item.frame83.verticalSpeed,
    heading: item.frame81?.headingAngle ?? item.frame83.groundTrack,
    pitch: item.frame81?.pitchAngle ?? 0,
    roll: item.frame81?.rollAngle ?? 0,
    raw: item,
    showTrail: false,//不显示轨迹线
  };
}

export function normalizeFP981C(item: FP981CAggregate): PlaneState {
  if (!item.c2) {
    throw new Error(`FP981C ${item.uav_id} missing C2 position frame`);
  }

  return {
    id: `fp981c:${item.uav_id}`,
    type: "fp981c",

    lon: item.c2.gps_longitude / 10_000_000,
    lat: item.c2.gps_latitude / 10_000_000,
    alt: item.c2.hb_height,

    heading: (item.c1?.head_angle ?? item.c2.ground_speed_direct ?? 0) / 100,
    pitch: (item.c1?.fy_angle ?? 0) / 100,
    roll: (item.c1?.gz_angle ?? 0) / 100,
    raw: item,
    showTrail: false,
  };
}
