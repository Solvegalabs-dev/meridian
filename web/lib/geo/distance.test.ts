import { describe, it, expect } from 'vitest'
import { haversineKm } from './distance'

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(40.76, -111.89, 40.76, -111.89)).toBeCloseTo(0, 5)
  })

  it('matches a known distance (Salt Lake City to Denver, ~ 600 km)', () => {
    const d = haversineKm(40.7608, -111.8910, 39.7392, -104.9903)
    expect(d).toBeGreaterThan(590)
    expect(d).toBeLessThan(610)
  })

  it('supports a 150km radius filter', () => {
    const centerLat = 40.5
    const centerLon = -110.0
    const nearby = haversineKm(centerLat, centerLon, 40.6, -110.1) // a few km away
    const farAway = haversineKm(centerLat, centerLon, 42.0, -108.0) // >150km away
    expect(nearby).toBeLessThan(150)
    expect(farAway).toBeGreaterThan(150)
  })
})
