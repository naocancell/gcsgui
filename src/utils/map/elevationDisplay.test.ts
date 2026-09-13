import { describe, expect, it } from 'vitest'
import { resolveElevationSample } from './elevationDisplay'

describe('resolveElevationSample', () => {
  it('椭球地形始终标记为 WGS84，并保留负高程', () => {
    expect(
      resolveElevationSample({
        height: -12.34,
        terrainIsEllipsoid: true,
        terrainSampleOk: false,
      }),
    ).toEqual({ text: '-12.3 m', source: 'WGS84' })
  })

  it('sampleTerrain 成功且当前不是椭球地形时标记为 DEM，即使高度接近 0', () => {
    expect(
      resolveElevationSample({
        height: 0.1,
        terrainIsEllipsoid: false,
        terrainSampleOk: true,
      }),
    ).toEqual({ text: '0.1 m', source: 'DEM' })
  })

  it('sample 失败时即使高度大于 0.5m 仍为 WGS84', () => {
    expect(
      resolveElevationSample({
        height: 12,
        terrainIsEllipsoid: false,
        terrainSampleOk: false,
      }),
    ).toEqual({ text: '12.0 m', source: 'WGS84' })
  })

  it('非法高度返回 null', () => {
    expect(
      resolveElevationSample({
        height: Number.NaN,
        terrainIsEllipsoid: false,
        terrainSampleOk: true,
      }),
    ).toBeNull()
    expect(
      resolveElevationSample({
        height: undefined,
        terrainIsEllipsoid: false,
        terrainSampleOk: true,
      }),
    ).toBeNull()
  })
})
