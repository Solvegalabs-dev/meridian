import { describe, it, expect } from 'vitest'
import { encodeGeohash, decodeGeohash, geohashPrecisionSteps } from './geohash'

describe('decodeGeohash (Phase 2 — job runner geo guard)', () => {
  it('round-trips an encoded point back to within the precision-5 cell size (~5km)', () => {
    const lat = 40.948
    const lon = -110.668
    const hash = encodeGeohash(lat, lon, 5)
    const { lat: decodedLat, lon: decodedLon } = decodeGeohash(hash)

    // ~0.02 degrees is comfortably inside a precision-5 cell (~0.044 x 0.022 deg).
    expect(Math.abs(decodedLat - lat)).toBeLessThan(0.05)
    expect(Math.abs(decodedLon - lon)).toBeLessThan(0.05)
  })

  it('decodes a shorter (lower-precision) hash to a less precise but still reasonable point', () => {
    const hash = encodeGeohash(40.5, -110.0, 3)
    const { lat, lon } = decodeGeohash(hash)
    expect(Math.abs(lat - 40.5)).toBeLessThan(2)
    expect(Math.abs(lon - -110.0)).toBeLessThan(2)
  })
})

describe('geohashPrecisionSteps', () => {
  it('still steps down precision by slicing (unchanged)', () => {
    expect(geohashPrecisionSteps('9vgm0', 5, 3)).toEqual(['9vgm0', '9vgm', '9vg'])
  })
})
