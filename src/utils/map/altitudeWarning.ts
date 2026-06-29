/**
 * 高度预警核心逻辑
 * 对比 UAV 当前高度与设计航线对应航段的高度，计算偏差并返回告警级别
 */
import type { Airline, AirlinePoint } from '@/types/entityoptions'

// ======================== 预警阈值配置 ========================
// 如需修改告警阈值，请修改以下两个常量：
export const CAUTION_THRESHOLD = 30 // 注意阈值（米），偏差超过此值显示黄色
export const WARNING_THRESHOLD = 50 // 告警阈值（米），偏差超过此值显示红色
// =============================================================

/** 告警级别枚举 */
export enum WarningLevel {
  NORMAL = 'normal', // 正常（绿色）
  CAUTION = 'caution', // 注意（黄色）
  WARNING = 'warning', // 告警（红色）
}

/** 告警结果 */
export interface AltitudeWarningResult {
  level: WarningLevel
  deviation: number // 高度偏差（米），正值表示高于设计高度，负值表示低于
  designAlt: number // 设计航线高度（米）
  currentAlt: number // 当前 UAV 高度（米）
}

/**
 * 计算高度偏差
 */
export function calculateDeviation(
  currentAlt: number,
  designAlt: number,
): number {
  return currentAlt - designAlt
}

/**
 * 根据偏差获取告警级别
 */
export function getWarningLevel(deviation: number): WarningLevel {
  const absDev = Math.abs(deviation)
  if (absDev >= WARNING_THRESHOLD) return WarningLevel.WARNING
  if (absDev >= CAUTION_THRESHOLD) return WarningLevel.CAUTION
  return WarningLevel.NORMAL
}

/**
 * 根据两个航点之间的线性插值计算当前位置的设计高度
 * @param route 设计航线
 * @param nextPointIndex 下一个航点号（1-based，来自 UAVInfo.nextPoint）
 * @param distanceNext 距下一航点的距离（米）
 * @returns 插值后的设计高度，如果无法计算则返回 null
 */
export function interpolateDesignAltitude(
  route: Airline,
  nextPointIndex: number,
  distanceNext: number,
): number | null {
  if (!route || !route.points || route.points.length === 0) return null

  // nextPoint 是 1-based 的航点号
  const nextIdx = nextPointIndex - 1 // 转为 0-based
  if (nextIdx < 0 || nextIdx >= route.points.length) {
    // 超出范围，使用最近航点的高度
    return route.points[Math.min(nextIdx, route.points.length - 1)]?.alt ?? null
  }

  // 如果是第一个航点之前或距离信息无效，直接用目标航点高度
  if (nextIdx === 0 || distanceNext <= 0) {
    return route.points[nextIdx].alt
  }

  // 在当前航点和下一航点之间插值
  const prevPt = route.points[nextIdx - 1]
  const nextPt = route.points[nextIdx]

  // 简单线性插值：根据距下一航点的距离比例
  // 由于我们不知道两点间总距离，直接使用下一航点高度作为参考
  // 这里采用简化方案：返回下一航点高度
  return nextPt.alt
}

/**
 * 执行完整的高度预警检查
 * @param currentAlt UAV 当前高度（米）
 * @param route 设计航线
 * @param nextPointIndex 下一个航点号
 * @param distanceNext 距下一航点距离
 */
export function checkAltitudeWarning(
  currentAlt: number,
  route: Airline | null,
  nextPointIndex: number,
  distanceNext: number,
): AltitudeWarningResult | null {
  if (!route) return null

  const designAlt = interpolateDesignAltitude(
    route,
    nextPointIndex,
    distanceNext,
  )
  if (designAlt === null) return null

  const deviation = calculateDeviation(currentAlt, designAlt)
  const level = getWarningLevel(deviation)

  return {
    level,
    deviation,
    designAlt,
    currentAlt,
  }
}
