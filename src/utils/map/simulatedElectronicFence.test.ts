import { destination, point, polygon } from '@turf/turf'
import { describe, expect, it } from 'vitest'
import type { PlaneState } from '@/types/entityoptions'
import {
  ELECTRONIC_FENCE_INNER_BUFFER_KM,
  ELECTRONIC_FENCE_OUTER_BUFFER_KM,
  evaluateSimulatedElectronicFence,
  getSimulatedElectronicFenceAlerts,
  type SimulatedElectronicFence,
} from './simulatedElectronicFence'

const boundaryLongitude = 0.2

function longitudeFromBoundary(distanceKm: number, bearing: number) {
  return destination(point([boundaryLongitude, 0]), distanceKm, bearing, {
    units: 'kilometers',
  }).geometry.coordinates[0]
}

function createPlane(id: string, lon: number): PlaneState {
  return {
    id: `uavInfo:${id}`,
    type: 'uavInfo',
    lon,
    lat: 0,
  } as PlaneState
}

function createFence(): SimulatedElectronicFence {
  const fencePolygon = polygon([
    [
      [-boundaryLongitude, -boundaryLongitude],
      [boundaryLongitude, -boundaryLongitude],
      [boundaryLongitude, boundaryLongitude],
      [-boundaryLongitude, boundaryLongitude],
      [-boundaryLongitude, -boundaryLongitude],
    ],
  ])
  const outerLongitude = longitudeFromBoundary(
    ELECTRONIC_FENCE_OUTER_BUFFER_KM,
    90,
  )

  return {
    entity: null as unknown as SimulatedElectronicFence['entity'],
    innerEntity: null,
    outerEntity: null as unknown as SimulatedElectronicFence['outerEntity'],
    polygon: fencePolygon,
    // The evaluator's distance fallback must enforce the same 10 km rule if
    // Turf cannot create an inner polygon.
    innerPolygon: null,
    outerPolygon: polygon([
      [
        [-outerLongitude, -outerLongitude],
        [outerLongitude, -outerLongitude],
        [outerLongitude, outerLongitude],
        [-outerLongitude, outerLongitude],
        [-outerLongitude, -outerLongitude],
      ],
    ]),
    radiusKm: 25,
    innerBufferKm: ELECTRONIC_FENCE_INNER_BUFFER_KM,
    outerBufferKm: ELECTRONIC_FENCE_OUTER_BUFFER_KM,
  }
}

describe('simulated electronic fence alerts', () => {
  it('treats aircraft at least 10 km inside the fence as safe', () => {
    const fence = createFence()
    const nearInnerEdge = createPlane(
      'near-inner-edge',
      longitudeFromBoundary(9.5, -90),
    )
    const safePlane = createPlane('safe', longitudeFromBoundary(10.5, -90))

    const results = evaluateSimulatedElectronicFence(fence, [
      nearInnerEdge,
      safePlane,
    ])

    expect(results.map((result) => result.status)).toEqual(['yellow', 'green'])
  })

  it('omits safe aircraft and returns no alerts when every aircraft is safe', () => {
    const fence = createFence()
    const safePlane = createPlane('safe', longitudeFromBoundary(10.5, -90))

    expect(getSimulatedElectronicFenceAlerts(fence, [safePlane])).toEqual([])
  })

  it('keeps only unsafe aircraft when safe and unsafe aircraft are mixed', () => {
    const fence = createFence()
    const warningPlane = createPlane('warning', longitudeFromBoundary(9.5, -90))
    const safePlane = createPlane('safe', longitudeFromBoundary(10.5, -90))

    const alerts = getSimulatedElectronicFenceAlerts(fence, [
      safePlane,
      warningPlane,
    ])

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ id: warningPlane.id, status: 'yellow' })
  })
})
