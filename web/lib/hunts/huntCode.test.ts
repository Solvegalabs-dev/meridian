import { describe, it, expect } from 'vitest'
import { normalizeHuntCode, udwrLookupEnabled, isCacheFresh, insideBoundary, CACHE_TTL_DAYS } from './huntCode'

describe('normalizeHuntCode', () => {
  it('accepts a hunt number and upper-cases it', () => {
    expect(normalizeHuntCode('ea2004')).toBe('EA2004')
    expect(normalizeHuntCode('  EB1005 ')).toBe('EB1005')
  })

  it('rejects anything that is not two letters and four digits', () => {
    for (const bad of ['EA200', 'EA20045', 'E12345', '1234AB', 'EA-2004', '', 'EA2004; DROP', null, 2004]) {
      expect(normalizeHuntCode(bad as unknown)).toBeNull()
    }
  })
})

describe('udwrLookupEnabled (kill switch)', () => {
  it('is on by default', () => {
    expect(udwrLookupEnabled({})).toBe(true)
  })

  it('is off for false, 0 and off', () => {
    expect(udwrLookupEnabled({ UDWR_LOOKUP_ENABLED: 'false' })).toBe(false)
    expect(udwrLookupEnabled({ UDWR_LOOKUP_ENABLED: '0' })).toBe(false)
    expect(udwrLookupEnabled({ UDWR_LOOKUP_ENABLED: ' OFF ' })).toBe(false)
  })

  it('any other value leaves it on', () => {
    expect(udwrLookupEnabled({ UDWR_LOOKUP_ENABLED: 'true' })).toBe(true)
  })
})

describe('isCacheFresh (30-day TTL)', () => {
  const NOW = new Date('2026-10-04T12:00:00Z')
  const DAY = 24 * 60 * 60 * 1000

  it('fresh inside the TTL', () => {
    expect(isCacheFresh(new Date(NOW.getTime() - (CACHE_TTL_DAYS - 1) * DAY).toISOString(), NOW)).toBe(true)
  })

  it('expired at and after the TTL', () => {
    expect(isCacheFresh(new Date(NOW.getTime() - (CACHE_TTL_DAYS + 1) * DAY).toISOString(), NOW)).toBe(false)
  })

  it('missing or unreadable times are not fresh', () => {
    expect(isCacheFresh(null, NOW)).toBe(false)
    expect(isCacheFresh('not a date', NOW)).toBe(false)
  })
})

// A square around (40.5, -111.0), roughly the size of a hunt unit.
const SQUARE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[-111.2, 40.3], [-110.8, 40.3], [-110.8, 40.7], [-111.2, 40.7], [-111.2, 40.3]]],
    },
  }],
}

describe('insideBoundary', () => {
  it('true for a point inside the polygon', () => {
    expect(insideBoundary(SQUARE, 40.5, -111.0)).toBe(true)
  })

  it('false for a point well outside (Chalk Creek vs. a point in another county)', () => {
    expect(insideBoundary(SQUARE, 41.9, -111.0)).toBe(false)
  })

  it('null when there is no boundary: unknown, not outside', () => {
    expect(insideBoundary(null, 40.5, -111.0)).toBeNull()
    expect(insideBoundary({ type: 'FeatureCollection', features: [] }, 40.5, -111.0)).toBeNull()
  })

  it('works with a MultiPolygon', () => {
    const multi = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [SQUARE.features[0].geometry.coordinates] } }],
    }
    expect(insideBoundary(multi, 40.5, -111.0)).toBe(true)
    expect(insideBoundary(multi, 41.9, -111.0)).toBe(false)
  })
})
