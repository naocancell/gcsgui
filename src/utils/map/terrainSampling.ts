import * as Cesium from 'cesium'

export interface TerrainSampleResult {
  heights: number[]
  level: number
}

export interface TerrainSamplingOptions {
  batchSize?: number
  attemptsPerLevel?: number
  retryDelayMs?: number
}

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function sampleTerrainAtExactLevel(
  viewer: Cesium.Viewer,
  cartographics: Cesium.Cartographic[],
  terrainLevel: number,
  options: TerrainSamplingOptions,
): Promise<TerrainSampleResult | null> {
  const batchSize = Math.max(1, options.batchSize ?? cartographics.length)
  const attemptsPerLevel = Math.max(1, options.attemptsPerLevel ?? 1)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 0)
  const heights: number[] = []

  for (
    let batchStart = 0;
    batchStart < cartographics.length;
    batchStart += batchSize
  ) {
    const sourceBatch = cartographics.slice(batchStart, batchStart + batchSize)
    let sampledBatch: Cesium.Cartographic[] | null = null

    for (let attempt = 1; attempt <= attemptsPerLevel; attempt++) {
      const queryBatch = sourceBatch.map(
        (point) => new Cesium.Cartographic(point.longitude, point.latitude, 0),
      )

      try {
        const result = await Cesium.sampleTerrain(
          viewer.terrainProvider,
          terrainLevel,
          queryBatch,
        )

        if (result.every((point) => Number.isFinite(point.height))) {
          sampledBatch = result
          break
        }
      } catch (error) {
        console.warn(`固定 ${terrainLevel} 级地形采样异常：`, error)
      }

      if (attempt < attemptsPerLevel && retryDelayMs > 0) {
        await wait(attempt * retryDelayMs)
      }
    }

    if (!sampledBatch) {
      console.warn(`固定 ${terrainLevel} 级地形采样失败：`, {
        start: batchStart,
        end: batchStart + sourceBatch.length - 1,
      })
      return null
    }

    heights.push(...sampledBatch.map((point) => point.height))
  }

  return { heights, level: terrainLevel }
}

export async function getTerrainHeightsAtLevel(
  viewer: Cesium.Viewer,
  cartographics: Cesium.Cartographic[],
  terrainLevel: number,
  cachedLevel?: number,
  options: TerrainSamplingOptions = {},
): Promise<TerrainSampleResult | null> {
  if (cartographics.length === 0) {
    return { heights: [], level: terrainLevel }
  }

  if (cachedLevel !== undefined && cachedLevel <= terrainLevel) {
    const cachedResult = await sampleTerrainAtExactLevel(
      viewer,
      cartographics,
      cachedLevel,
      options,
    )

    if (cachedResult) return cachedResult
  }

  for (let level = terrainLevel; level >= 0; level--) {
    if (level === cachedLevel) continue

    const result = await sampleTerrainAtExactLevel(
      viewer,
      cartographics,
      level,
      options,
    )

    if (result) return result
  }

  return null
}
