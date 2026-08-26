import * as Cesium from 'cesium'
import type { AdministrativeLevel } from '@/store/viewSettingsStore'

type BoundaryConfig = {
  url: string
  name: string
  color: Cesium.Color
  width: number
}

type BoundarySource = Cesium.GeoJsonDataSource | { show: boolean }
type PackedBoundaryRings = {
  coordinates: Float64Array
  offsets: Uint32Array
}

// 分批数量保持较小，避免一次几何创建占满整帧；调大前先在目标设备上实测。
const BOUNDARY_CHUNK_SIZE = 25
const COUNTY_BOUNDARY_URL = `${import.meta.env.BASE_URL}json/%E4%B8%AD%E5%9B%BD_%E5%8E%BF.geojson`

// 文件名保持 URL 编码，Tauri 资源地址下也能正常访问。
const boundaryConfigs: Record<AdministrativeLevel, BoundaryConfig> = {
  province: {
    url: `${import.meta.env.BASE_URL}json/%E4%B8%AD%E5%9B%BD_%E7%9C%81.geojson`,
    name: '\u7701\u7ea7\u884c\u653f\u533a',
    color: Cesium.Color.fromCssColorString('#ffcf33'),
    width: 2.5,
  },
  city: {
    url: `${import.meta.env.BASE_URL}json/%E4%B8%AD%E5%9B%BD_%E5%B8%82.geojson`,
    name: '\u5e02\u7ea7\u884c\u653f\u533a',
    color: Cesium.Color.fromCssColorString('#45d9ff'),
    width: 2.2,
  },
  county: {
    url: COUNTY_BOUNDARY_URL,
    name: '\u53bf\u7ea7\u884c\u653f\u533a',
    color: Cesium.Color.fromCssColorString('#ff8f70'),
    width: 2,
  },
}

const sourcesByViewer = new WeakMap<
  object,
  Map<AdministrativeLevel, BoundarySource>
>()
const primitivesByViewer = new WeakMap<
  object,
  Map<AdministrativeLevel, Cesium.GroundPolylinePrimitive[]>
>()

function getSources(viewer: Cesium.Viewer) {
  let sources = sourcesByViewer.get(viewer)
  if (!sources) {
    sources = new Map()
    sourcesByViewer.set(viewer, sources)
  }
  return sources
}

function getPrimitives(viewer: Cesium.Viewer) {
  let primitives = primitivesByViewer.get(viewer)
  if (!primitives) {
    primitives = new Map()
    primitivesByViewer.set(viewer, primitives)
  }
  return primitives
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    // 跨过一次绘制后再继续；单次 RAF 可能在绘制前连续执行，慢 WebView 中仍会连成长任务。
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function loadBoundaryRingsInWorker(url: string) {
  return new Promise<PackedBoundaryRings>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/administrativeBoundaryWorker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (
      event: MessageEvent<{
        ok: boolean
        coordinates?: ArrayBuffer
        offsets?: ArrayBuffer
        error?: string
      }>,
    ) => {
      worker.terminate()
      if (event.data.ok && event.data.coordinates && event.data.offsets) {
        resolve({
          coordinates: new Float64Array(event.data.coordinates),
          offsets: new Uint32Array(event.data.offsets),
        })
      } else reject(new Error(event.data.error || '行政区边界解析失败'))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(event.error || new Error(event.message))
    }
    // 相对页面地址解析，不使用打包后位于 assets 目录的 Worker chunk 地址。
    worker.postMessage({ url: new URL(url, window.location.href).href })
  })
}

async function createBoundaryPrimitives(
  viewer: Cesium.Viewer,
  packed: PackedBoundaryRings,
  config: BoundaryConfig,
) {
  const primitives: Cesium.GroundPolylinePrimitive[] = []
  const ringCount = packed.offsets.length - 1
  for (let offset = 0; offset < ringCount; offset += BOUNDARY_CHUNK_SIZE) {
    const end = Math.min(offset + BOUNDARY_CHUNK_SIZE, ringCount)
    const geometryInstances = []
    for (let index = offset; index < end; index += 1) {
      const startCoordinate = packed.offsets[index]
      const endCoordinate = packed.offsets[index + 1]
      const ring = Array.from(
        packed.coordinates.subarray(startCoordinate, endCoordinate),
      )
      geometryInstances.push(
        new Cesium.GeometryInstance({
          id: `${config.name}-boundary-${index}`,
          geometry: new Cesium.GroundPolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArray(ring),
            width: config.width,
            loop: true,
            arcType: Cesium.ArcType.GEODESIC,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              config.color,
            ),
          },
        }),
      )
    }
    if (geometryInstances.length > 0) {
      primitives.push(
        viewer.scene.groundPrimitives.add(
          new Cesium.GroundPolylinePrimitive({
            geometryInstances,
            appearance: new Cesium.PolylineColorAppearance({
              translucent: config.color.alpha < 1,
            }),
            allowPicking: false,
            asynchronous: true,
            interleave: true,
          }),
        ),
      )
    }
    await yieldToBrowser()
  }
  return primitives
}

function styleBoundaryEntities(
  source: Cesium.GeoJsonDataSource,
  config: BoundaryConfig,
  hidePolygons = true,
) {
  const entities = source.entities.values
  entities.forEach((entity) => {
    const polygon = entity.polygon as any
    if (polygon) {
      polygon.material = Cesium.Color.TRANSPARENT
      // 边界环由批量地面图元统一绘制，继续显示成千上万个多边形实体会重复开销。
      polygon.show = !hidePolygons
      if (!hidePolygons) {
        polygon.outline = true
        polygon.outlineColor = config.color
        polygon.outlineWidth = config.width
        polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND
        polygon.classificationType = Cesium.ClassificationType.BOTH
      }
    }

    const polyline = entity.polyline as any
    if (polyline) {
      polyline.material = config.color
      polyline.width = config.width
      polyline.clampToGround = true
      polyline.depthFailMaterial = config.color
    }
  })
}

export async function toggleAdministrativeBoundary(
  viewer: Cesium.Viewer,
  level: AdministrativeLevel,
) {
  if (!viewer || viewer.isDestroyed())
    throw new Error('Viewer is not initialized')

  const sources = getSources(viewer)
  const primitives = getPrimitives(viewer)
  const existing = sources.get(level)
  if (existing) {
    existing.show = !existing.show
    primitives.get(level)?.forEach((primitive) => {
      primitive.show = existing.show
    })
    viewer.scene.requestRender()
    return existing.show
  }

  const config = boundaryConfigs[level]
  if (Cesium.GroundPolylinePrimitive.isSupported(viewer.scene)) {
    try {
      const rings = await loadBoundaryRingsInWorker(config.url)
      const loadedPrimitives = await createBoundaryPrimitives(
        viewer,
        rings,
        config,
      )
      if (viewer.isDestroyed()) return false
      const source: BoundarySource = { show: true }
      sources.set(level, source)
      primitives.set(level, loadedPrimitives)
      viewer.scene.requestRender()
      return true
    } catch (error) {
      console.warn('批量加载行政区边界失败，回退到 GeoJSON:', error)
    }
  }

  const source = await Cesium.GeoJsonDataSource.load(config.url, {
    stroke: config.color,
    strokeWidth: config.width,
    fill: Cesium.Color.TRANSPARENT,
    clampToGround: true,
  })

  if (viewer.isDestroyed()) return false
  source.name = config.name
  styleBoundaryEntities(source, config, false)
  source.show = true
  await viewer.dataSources.add(source)
  viewer.dataSources.raiseToTop(source)
  sources.set(level, source)
  viewer.scene.requestRender()
  return true
}

export function clearAdministrativeBoundaries(viewer?: Cesium.Viewer) {
  if (!viewer) return
  const sources = sourcesByViewer.get(viewer)
  if (!sources) return
  const primitives = primitivesByViewer.get(viewer)
  sources.forEach((source) => {
    if (
      source instanceof Cesium.GeoJsonDataSource &&
      !viewer.isDestroyed() &&
      viewer.dataSources.contains(source)
    )
      viewer.dataSources.remove(source, true)
  })
  primitives?.forEach((loadedPrimitives) => {
    loadedPrimitives.forEach((primitive) => {
      if (
        !viewer.isDestroyed() &&
        viewer.scene.groundPrimitives.contains(primitive)
      ) {
        viewer.scene.groundPrimitives.remove(primitive)
      }
    })
  })
  sources.clear()
  primitives?.clear()
  sourcesByViewer.delete(viewer)
  primitivesByViewer.delete(viewer)
}
