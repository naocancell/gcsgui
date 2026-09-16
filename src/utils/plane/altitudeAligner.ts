import * as Cesium from 'cesium'
import type { PlaneState } from '@/types/entityoptions'

/**
 * 飞机地面起飞基准高程校准记录
 */
export interface CalibrationState {
  groundTelemetryAlt: number // 飞控地面初始绝对海拔
  groundTerrainHeight: number // 地图当时地表物理高度 (0 或 DEM 采样值)
  deltaH: number // 偏置量 = groundTelemetryAlt - groundTerrainHeight
  calibrated: boolean // 是否已锁定地面基准
  timestamp: number
}

/**
 * 从 Cesium 地图场景中获取指定经纬度的地表物理高程（米）
 * 若未加载 DEM（纯椭球模式）或采样失败，安全保底返回 0
 */
export function getTerrainHeightAt(viewer: any, lon: number, lat: number): number {
  if (!viewer?.scene?.globe) return 0
  try {
    const carto = Cesium.Cartographic.fromDegrees(lon, lat)
    const h = viewer.scene.globe.getHeight(carto)
    return Number.isFinite(h) ? Number(h) : 0
  } catch {
    return 0
  }
}

/**
 * 综合多源参数判定飞机当前是否处于地面静止或滑跑状态
 */
export function isPlaneOnGround(plane: PlaneState): boolean {
  const raw = plane.raw as any

  // 1. 若飞控提供了相对高度字段 (如 FP95 的 relativeAltitude 或 C2 的 rel_height)
  const relAlt = raw?.relativeAltitude ?? raw?.rel_height
  if (typeof relAlt === 'number' && Number.isFinite(relAlt)) {
    if (relAlt <= 1.5) return true
    if (relAlt > 5.0) return false // 相对高明确大于5米，必然已在空中
  }

  // 2. 结合水平地速与垂直速度判定地面低速状态
  const groundSpeed = Number(plane.groundSpeed ?? raw?.groundSpeed ?? raw?.adsVl ?? 0)
  const verticalSpeed = Math.abs(Number(plane.verticalSpeed ?? raw?.verticalSpeed ?? raw?.adsVu ?? 0))

  // 地面静止或低速滑行（地速 < 1.5 m/s 且垂直升降速度 < 0.4 m/s）
  return groundSpeed < 1.5 && verticalSpeed < 0.4
}

/**
 * 高程自对齐与校准管理器
 */
export class AltitudeAligner {
  private records = new Map<string, CalibrationState>()

  /**
   * 计算飞机在 Cesium 三维场景中的实际渲染高度（椭球高）
   * @param plane 飞机统一状态对象
   * @param viewer Cesium Viewer 实例
   * @returns 修正后可直接传给 Cartesian3.fromDegrees 的空间高度值
   */
  public getRenderHeight(plane: PlaneState, viewer?: any): number {
    const rawAlt = Number(plane.alt)
    if (!Number.isFinite(rawAlt)) return 0

    const terrainHeight = getTerrainHeightAt(viewer, plane.lon, plane.lat)
    let record = this.records.get(plane.id)
    const onGround = isPlaneOnGround(plane)

    // 1. 若尚未完成有效地面校准
    if (!record || !record.calibrated) {
      if (onGround || !record) {
        const deltaH = rawAlt - terrainHeight
        record = {
          groundTelemetryAlt: rawAlt,
          groundTerrainHeight: terrainHeight,
          deltaH,
          calibrated: onGround, // 处于地面状态时正式锁定基准
          timestamp: Date.now(),
        }
        this.records.set(plane.id, record)

        if (onGround) {
          // 地面静止状态强制紧贴地表，消除任何初值微小漂移
          return terrainHeight
        }
      }
    }

    // 2. 使用已校准偏置量进行高度平移
    const deltaH = record ? record.deltaH : 0
    const calculatedAlt = rawAlt - deltaH

    // 3. 安全防穿地保护：渲染高度绝不低于当前经纬度下的地表三角网格高度
    return Math.max(calculatedAlt, terrainHeight)
  }

  /**
   * 获取指定飞机的当前标定状态信息
   */
  public getCalibration(id: string): CalibrationState | undefined {
    return this.records.get(id)
  }

  /**
   * 重置指定飞机或全部飞机的地面标定状态
   */
  public reset(id?: string): void {
    if (id) {
      this.records.delete(id)
    } else {
      this.records.clear()
    }
  }
}

/** 全局单例 */
export const altitudeAligner = new AltitudeAligner()
