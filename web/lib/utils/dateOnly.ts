// Date-only strings (YYYY-MM-DD) for calendar fields such as trip_start, trip_end
// and target_date. `new Date('2026-09-12')` parses as UTC midnight, so any local-zone
// formatting shows the previous day in the Americas. These helpers keep the calendar
// date as written: the instant is pinned to noon UTC and formatted in UTC.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/

// Noon UTC on the given calendar date. Noon keeps every zone on the same day.
function utcNoon(value: string): Date | null {
  const m = DATE_ONLY.exec(value)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}

// Formats the calendar date as written, independent of the viewer's zone.
// Falls back to the raw value when it is not a date-only string.
export function formatDateOnly(value: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const d = utcNoon(value)
  if (!d) return value
  return d.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

// Adds whole days to a date-only string and returns a date-only string.
export function addDaysDateOnly(value: string, days: number): string | null {
  const d = utcNoon(value)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
