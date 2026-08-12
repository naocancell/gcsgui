import {
  booleanPointInPolygon,
  buffer,
  destination,
  lineString,
  nearestPointOnLine,
  point,
  polygon,
} from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import * as Cesium from 'cesium'
import type { PlaneState } from '@/types/entityoptions'

export type ElectronicFenceStatus = 'green' | 'yellow' | 'orange' | 'red'

export type ElectronicFenceResult = {
  id: string
  label: string
  type: 'UAV' | '981C'
  inside: boolean
  distanceMeters: number
  status: ElectronicFenceStatus
  statusLabel: string
}

export type SimulatedElectronicFence = {
  entity: Cesium.Entity
  innerEntity: Cesium.Entity | null
  outerEntity: Cesium.Entity
  polygon: Feature<Polygon>
  innerPolygon: Feature<Polygon> | null
  outerPolygon: Feature<Polygon>
  radiusKm: number
  innerBufferKm: number
  outerBufferKm: number
}

// Matches the first simulated UAVInfo coordinate. The fence is deliberately
// independent from live telemetry so it can be loaded before any aircraft data.
export const SIMULATED_ELECTRONIC_FENCE_INITIAL_POSITION = {
  lon: 110.3312,
  lat: 20.0311,
} as const

const DEFAULT_RADIUS_KM = 25
export const ELECTRONIC_FENCE_INNER_BUFFER_KM = 10
export const ELECTRONIC_FENCE_OUTER_BUFFER_KM = 5

function polygonRing(feature: Feature<Polygon>) {
  return feature.geometry.coordinates[0]
}

function polygonDegrees(feature: Feature<Polygon>) {
  return polygonRing(feature).flatMap((coordinate) => [
    coordinate[0],
    coordinate[1],
  ])
}

/** Turf's negative buffer can collapse very small polygons. */
function createBufferedPolygon(
  source: Feature<Polygon>,
  distanceKm: number,
): Feature<Polygon> | null {
  const buffered = buffer(source, distanceKm, {
    units: 'kilometers',
    steps: 64,
  })

  return buffered?.type === 'Feature' && buffered.geometry.type === 'Polygon'
    ? (buffered as Feature<Polygon>)
    : null
}

function createZoneEntity(
  viewer: Cesium.Viewer,
  id: string,
  feature: Feature<Polygon>,
  fillColor: string,
  outlineColor: string,
  zIndex: number,
  label?: string,
) {
  const positions = Cesium.Cartesian3.fromDegreesArray(polygonDegrees(feature))

  return viewer.entities.add({
    id,
    polygon: {
      hierarchy: positions,
      material: Cesium.Color.fromCssColorString(fillColor),
      outline: false,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      classificationType: Cesium.ClassificationType.BOTH,
      zIndex,
    },
    polyline: {
      positions,
      width: 2,
      material: Cesium.Color.fromCssColorString(outlineColor),
      clampToGround: true,
      classificationType: Cesium.ClassificationType.BOTH,
      zIndex,
    },
    ...(label
      ? {
          label: {
            text: label,
            font: 'bold 13px sans-serif',
            fillColor: Cesium.Color.fromCssColorString(outlineColor),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }
      : {}),
  })
}

/** Creates a fixed, irregular convex fence around the aircraft's position. */
export function createSimulatedElectronicFence(
  viewer: Cesium.Viewer,
  center: Pick<PlaneState, 'lon' | 'lat'>,
  radiusKm = DEFAULT_RADIUS_KM,
  innerBufferKm = ELECTRONIC_FENCE_INNER_BUFFER_KM,
  outerBufferKm = ELECTRONIC_FENCE_OUTER_BUFFER_KM,
): SimulatedElectronicFence {
  const centerPoint = point([center.lon, center.lat])
  const vertices = [
    [12, 1.15],
    [62, 1.05],
    [112, 1.2],
    [166, 0.95],
    [218, 1.2],
    [274, 1.05],
    [326, 1.25],
  ].map(
    ([bearing, scale]) =>
      destination(centerPoint, radiusKm * scale, bearing, {
        units: 'kilometers',
      }).geometry.coordinates,
  )
  const coordinates = [...vertices, vertices[0]]
  const fencePolygon = polygon([coordinates])
  const innerPolygon = createBufferedPolygon(fencePolygon, -innerBufferKm)
  const outerPolygon = createBufferedPolygon(fencePolygon, outerBufferKm)

  if (!outerPolygon) {
    throw new Error('无法生成电子围栏外侧区域')
  }

  const outerEntity = createZoneEntity(
    viewer,
    'simulated-electronic-fence-outer',
    outerPolygon,
    Cesium.Color.fromCssColorString('#f59e0b')
      .withAlpha(0.12)
      .toCssColorString(),
    '#f59e0b',
    998,
    `外部区域 ${outerBufferKm} km`,
  )

  const innerEntity = innerPolygon
    ? createZoneEntity(
        viewer,
        'simulated-electronic-fence-inner',
        innerPolygon,
        Cesium.Color.fromCssColorString('#67c23a')
          .withAlpha(0.2)
          .toCssColorString(),
        '#67c23a',
        1001,
        `内部区域 ${innerBufferKm} km`,
      )
    : null

  const entity = viewer.entities.add({
    id: 'simulated-electronic-fence',
    position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0),
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(coordinates.flat()),
      material: Cesium.Color.fromCssColorString('#f0c419').withAlpha(0.34),
      outline: false,
      // Keep the fence on the terrain surface and classify both terrain and 3D tiles.
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      classificationType: Cesium.ClassificationType.BOTH,
      zIndex: 1000,
    },
    // 单独绘制边界
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(coordinates.flat()),
      width: 3,
      material: Cesium.Color.fromCssColorString('#14cb32'),
      clampToGround: true,
      classificationType: Cesium.ClassificationType.BOTH,
      zIndex: 1002,
    },
    label: {
      text: '电子围栏',
      font: 'bold 16px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#14cb32'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -8),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      // Reduce the label at overview scale and keep it stable beyond the far distance.
      scaleByDistance: new Cesium.NearFarScalar(50_000, 1, 300_000, 0.55),
      // Labels remain readable even when the terrain surface is between camera and label.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })

  return {
    entity,
    innerEntity,
    outerEntity,
    polygon: fencePolygon,
    innerPolygon,
    outerPolygon,
    radiusKm,
    innerBufferKm,
    outerBufferKm,
  }
}

export function removeSimulatedElectronicFence(
  viewer: Cesium.Viewer | undefined,
  fence: SimulatedElectronicFence | null,
) {
  if (!viewer || !fence) return

  if (fence.innerEntity) viewer.entities.remove(fence.innerEntity)
  viewer.entities.remove(fence.outerEntity)
  viewer.entities.remove(fence.entity)
}

/** Evaluates horizontal distance to the nearest polygon edge in meters. */
export function evaluateSimulatedElectronicFence(
  fence: SimulatedElectronicFence,
  planes: PlaneState[],
): ElectronicFenceResult[] {
  const boundary = lineString(fence.polygon.geometry.coordinates[0])
  const innerBufferMeters = fence.innerBufferKm * 1000
  const outerBufferMeters = fence.outerBufferKm * 1000

  return planes
    .filter((plane) => plane.type === 'uavInfo' || plane.type === 'fp981c')
    .filter((plane) => Number.isFinite(plane.lon) && Number.isFinite(plane.lat))
    .map((plane) => {
      const aircraftPoint = point([plane.lon, plane.lat])
      const nearest = nearestPointOnLine(boundary, aircraftPoint, {
        units: 'kilometers',
      })
      const inside = booleanPointInPolygon(aircraftPoint, fence.polygon)
      const insideInner = fence.innerPolygon
        ? booleanPointInPolygon(aircraftPoint, fence.innerPolygon)
        : false
      const insideOuter = booleanPointInPolygon(
        aircraftPoint,
        fence.outerPolygon,
      )
      const distanceMeters = Math.max(
        0,
        Number(nearest.properties?.dist ?? 0) * 1000,
      )

      let status: ElectronicFenceStatus
      let statusLabel: string
      if (insideInner || (inside && distanceMeters >= innerBufferMeters)) {
        status = 'green'
        statusLabel = '最内区域'
      } else if (inside) {
        status = 'yellow'
        statusLabel = '内侧缓冲区'
      } else if (insideOuter || distanceMeters <= outerBufferMeters) {
        status = 'orange'
        statusLabel = '外侧缓冲区'
      } else {
        status = 'red'
        statusLabel = '超出外部区域'
      }

      return {
        id: plane.id,
        label:
          plane.type === 'fp981c'
            ? `981C #${plane.id.split(':')[1]}`
            : `UAV #${plane.id.split(':')[1]}`,
        type: plane.type === 'fp981c' ? '981C' : 'UAV',
        inside,
        distanceMeters,
        status,
        statusLabel,
      }
    })
}

export function getSimulatedElectronicFenceAlerts(
  fence: SimulatedElectronicFence,
  planes: PlaneState[],
): ElectronicFenceResult[] {
  return evaluateSimulatedElectronicFence(fence, planes).filter(
    (result) => result.status !== 'green',
  )
}
