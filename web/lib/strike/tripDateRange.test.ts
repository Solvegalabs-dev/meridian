import { describe, it, expect } from 'vitest'
import { checkTripDate, tripDateBounds, tripDateRangeMessage } from './tripDateRange'

const NOW = new Date('2026-10-08T15:00:00Z')

describe('tripDateBounds', () => {
  it('runs from the start of last year to the end of the year three years out', () => {
    expect(tripDateBounds(NOW)).toEqual({ minYear: 2025, maxYear: 2029, min: '2025-01-01', max: '2029-12-31' })
  })

  it('moves with the clock', () => {
    expect(tripDateBounds(new Date('2027-01-02T00:00:00Z'))).toMatchObject({ min: '2026-01-01', max: '2030-12-31' })
  })
})

describe('checkTripDate', () => {
  it('accepts dates inside the range, including both edges', () => {
    for (const ok of ['2025-01-01', '2026-10-15', '2029-12-31']) expect(checkTripDate(ok, 'Trip start', NOW)).toBeNull()
  })

  it('rejects the year 0027 that was once saved', () => {
    const message = checkTripDate('0027-10-15', 'Trip start', NOW)
    expect(message).not.toBeNull()
  })

  it('rejects a real date that is too early or too far ahead, with the range in the message', () => {
    expect(checkTripDate('2024-12-31', 'Trip start', NOW)).toBe('Trip dates must be between 2025 and 2029.')
    expect(checkTripDate('2030-01-01', 'Trip end', NOW)).toBe('Trip dates must be between 2025 and 2029.')
    expect(checkTripDate('1999-06-01', 'Trip end', NOW)).toBe(tripDateRangeMessage(NOW))
    expect(checkTripDate('9999-12-31', 'Trip end', NOW)).toBe(tripDateRangeMessage(NOW))
  })

  it('names the field and gives an example when the value is not a real date', () => {
    expect(checkTripDate('10/15/2026', 'Trip start', NOW)).toBe('Trip start must be a date like 2026-10-15.')
    expect(checkTripDate('2026-02-30', 'Trip end', NOW)).toBe('Trip end must be a date like 2026-10-15.')
    expect(checkTripDate(20261015, 'Trip end', NOW)).toContain('must be a date like')
  })

  it('treats a missing or empty date as fine: the dates are optional', () => {
    for (const empty of [null, undefined, '']) expect(checkTripDate(empty, 'Trip start', NOW)).toBeNull()
  })
})
