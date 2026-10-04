import { describe, it, expect } from 'vitest'
import { spotRunFilter } from './activeSpot'

describe('spotRunFilter', () => {
  it('accepts runs tagged with the active spot and untagged same-day legacy runs', () => {
    expect(spotRunFilter('spot-1')).toBe('geo_context->>spotId.eq.spot-1,geo_context->>spotId.is.null')
  })

  it('never accepts a run tagged with a different spot', () => {
    const expr = spotRunFilter('spot-1')
    expect(expr).not.toContain('spot-2')
    expect(expr.split(',').filter(p => p.includes('.eq.'))).toHaveLength(1)
  })
})
