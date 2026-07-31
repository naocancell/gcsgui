/*
后端接收过来的结构转换为固定渲染结构 
 */
import type { UAVInfo, FP95Aggregate, FP95Frame94Sub1, FP981CAggregate, PlaneState } from "@/types/entityoptions";


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

export function isValidTransponderTarget(sub1: FP95Frame94Sub1): boolean {
  return sub1.sAddress !== '000000'
    && sub1.sAddress !== 'FFFFFF'
    && Number.isFinite(sub1.adsLon)
    && Number.isFinite(sub1.adsLat)
    && sub1.adsLon >= -180
    && sub1.adsLon <= 180
    && sub1.adsLat >= -90
    && sub1.adsLat <= 90
    && !(sub1.adsLon === 0 && sub1.adsLat === 0)
}

/** 将 94 帧应答机目标转换为统一渲染结构 */
export function normalizeTransponder(sub1: FP95Frame94Sub1): PlaneState | null {
  if (!isValidTransponderTarget(sub1)) return null;
  const legacySub1 = sub1 as FP95Frame94Sub1 & { ads_yaw?: number };
  const candidateHeading = sub1.adsYaw ?? legacySub1.ads_yaw ?? 0;
  const heading = Number.isFinite(candidateHeading) ? candidateHeading : 0;
  return {
    id: `transponder:${sub1.sAddress}`,
    type: "transponder",

    lon: sub1.adsLon,
    lat: sub1.adsLat,
    alt: sub1.adsAlt,
    groundSpeed: sub1.adsVl,
    verticalSpeed: sub1.adsVu,
    heading,
    pitch: 0,
    roll: 0,
    raw: sub1,
    showTrail: false,
  };
}
