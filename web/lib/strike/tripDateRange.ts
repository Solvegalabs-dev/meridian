// Allowed range for trip dates (FF-096b): from the start of last year to the end of the year three years out.
// One objective was saved with the year 0027, which no season or window logic can read. Pure and client-safe,
// so the intake form, the details card and the server routes all apply the same rule and the same words.
import { parseCalendarDate } from '@/lib/objectives/windowState'

export const YEARS_BACK = 1
export const YEARS_AHEAD = 3

export type TripDateBounds = { minYear: number; maxYear: number; min: string; max: string }

export function tripDateBounds(now: Date = new Date()): TripDateBounds {
  const year = now.getUTCFullYear()
  const minYear = year - YEARS_BACK
  const maxYear = year + YEARS_AHEAD
  return { minYear, maxYear, min: `${minYear}-01-01`, max: `${maxYear}-12-31` }
}

export function tripDateRangeMessage(now: Date = new Date()): string {
  const { minYear, maxYear } = tripDateBounds(now)
  return `Trip dates must be between ${minYear} and ${maxYear}.`
}

// Null when the value is fine. `label` names the field in the message ("Trip start"). An empty value is fine:
// the dates are optional. A value that is not a real YYYY-MM-DD date gets the format message; one that is a
// real date but outside the range gets the range message.
export function checkTripDate(value: unknown, label: string, now: Date = new Date()): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = parseCalendarDate(value)
  if (!date) return `${label} must be a date like ${now.getUTCFullYear()}-10-15.`
  const { min, max } = tripDateBounds(now)
  return date < min || date > max ? tripDateRangeMessage(now) : null
}
