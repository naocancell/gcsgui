export type ElevationSource = 'DEM' | 'WGS84'

export interface ElevationSample {
  text: string
  source: ElevationSource
}

/**
 * 高程来源按 terrain provider / sampleTerrain 是否成功判断，而不是用高度绝对值。
 */
export function resolveElevationSample(options: {
  height: number | undefined
  terrainIsEllipsoid: boolean
  terrainSampleOk: boolean
}): ElevationSample | null {
  const { height, terrainIsEllipsoid, terrainSampleOk } = options
  if (height === undefined || !Number.isFinite(height)) return null
  return {
    text: `${height.toFixed(1)} m`,
    source: terrainSampleOk && !terrainIsEllipsoid ? 'DEM' : 'WGS84',
  }
}
