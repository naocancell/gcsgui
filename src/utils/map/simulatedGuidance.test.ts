import { describe, expect, it } from 'vitest'
import {
  createLineGuidance,
  createOrbitGuidance,
  guidancePosition,
  type SimulatedGuidance,
} from './simulatedGuidance'

const aircraft = {
  lon: 110.3312,
  lat: 20.0311,
  heading: 75,
  speed: 25,
  altitude: 500,
}

describe('simulated guidance', () => {
  it('creates a line route with a flyable transition and exact target', () => {
    const target = { lon: 110.36, lat: 20.05 }
    const guidance = createLineGuidance(
      aircraft,
      { lon: 110.34, lat: 20.04 },
      target,
      650,
    )

    expect(guidance.mode).toBe('line')
    expect(guidance.points.length).toBeGreaterThan(2)
    expect(guidance.points.at(-1)?.lon).toBeCloseTo(target.lon, 6)
    expect(guidance.points.at(-1)?.lat).toBeCloseTo(target.lat, 6)
    expect(guidance.currentAltitude).toBe(aircraft.altitude)
    expect(guidance.altitude).toBe(650)
  })

  it('creates an orbit route after a same-direction Dubins transition', () => {
    const center = { lon: 110.35, lat: 20.04 }
    const guidance = createOrbitGuidance(aircraft, center, 500, 2, 700)

    expect(guidance.mode).toBe('orbit')
    expect(guidance.center).toEqual(center)
    expect(guidance.radiusMeters).toBe(500)
    expect(guidance.laps).toBe(2)
    expect(guidance.points.length).toBeGreaterThan(100)
    expect(
      guidance.points.every(
        (point) =>
          Number.isFinite(point.lon) &&
          Number.isFinite(point.lat) &&
          Number.isFinite(point.heading),
      ),
    ).toBe(true)
  })

  it('moves along the route and limits vertical speed to five metres per second', () => {
    const guidance: SimulatedGuidance = {
      mode: 'line',
      points: [
        { lon: 110, lat: 20, heading: 90 },
        { lon: 111, lat: 20, heading: 90 },
      ],
      progress: 0,
      speed: 100,
      lastUpdate: 1_000,
      altitude: 600,
      currentAltitude: 500,
    }

    const position = guidancePosition(guidance, 2_000)

    expect(position.lon).toBeGreaterThan(110)
    expect(position.lon).toBeLessThan(111)
    expect(position.heading).toBe(90)
    expect(position.altitude).toBe(505)
    expect(position.verticalSpeed).toBe(5)
  })
})
