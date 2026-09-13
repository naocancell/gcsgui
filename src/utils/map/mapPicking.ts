/**
 * 地图左键是否处于独占选点（引导点 / 启动点）。其它拾取应提前 return。
 */
export function isExclusiveMapPicking(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      (window.guidancePointPicking || window.startupLocationPicking),
  )
}

export function setStartupLocationPicking(active: boolean): void {
  if (typeof window === 'undefined') return
  window.startupLocationPicking = active
}
