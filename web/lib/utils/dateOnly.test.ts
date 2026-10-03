import { describe, it, expect, afterEach } from 'vitest'
import { formatDateOnly, addDaysDateOnly } from './dateOnly'

const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

describe('formatDateOnly', () => {
  // A date-only string must keep its calendar day whatever zone the viewer is in.
  for (const tz of ['America/New_York', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
    it(`renders 2026-09-12 as Sep 12 under TZ=${tz}`, () => {
      process.env.TZ = tz
      expect(formatDateOnly('2026-09-12')).toBe('Sep 12')
    })
  }

  it('honours caller options such as the year', () => {
    expect(formatDateOnly('2026-06-23', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Jun 23, 2026')
  })

  it('returns the raw value when it is not a date-only string', () => {
    expect(formatDateOnly('not-a-date')).toBe('not-a-date')
  })
})

describe('addDaysDateOnly', () => {
  it('adds and subtracts whole days across a month boundary', () => {
    expect(addDaysDateOnly('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDaysDateOnly('2026-10-01', -1)).toBe('2026-09-30')
  })

  it('returns null for an unparseable value', () => {
    expect(addDaysDateOnly('', 3)).toBeNull()
  })
})
