import { describe, it, expect } from 'vitest'
import { resolveTimezone } from './timezone'

describe('resolveTimezone', () => {
  it('resolves Utah to America/Denver', () => {
    expect(resolveTimezone('UT', 40.7, -111.9)).toBe('America/Denver')
  })

  it('resolves Colorado to America/Denver', () => {
    expect(resolveTimezone('CO', 39.7, -104.9)).toBe('America/Denver')
  })

  it('resolves Arizona to America/Phoenix (no DST)', () => {
    expect(resolveTimezone('AZ', 33.4, -112.1)).toBe('America/Phoenix')
  })

  it('splits Idaho by the panhandle latitude threshold', () => {
    expect(resolveTimezone('ID', 48.2, -116.5)).toBe('America/Los_Angeles') // Bonners Ferry area
    expect(resolveTimezone('ID', 43.6, -116.2)).toBe('America/Denver') // Boise area
  })

  it('falls back to a longitude estimate when state is unknown', () => {
    expect(resolveTimezone(null, 40, -105)).toBe('America/Denver')
    expect(resolveTimezone(undefined, 40, -122)).toBe('America/Los_Angeles')
    expect(resolveTimezone('', 40, -90)).toBe('America/Chicago')
  })
})
