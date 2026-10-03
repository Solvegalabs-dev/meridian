// Window evaluator for objectives with a trip window and (optionally) a season.
//
// Pure: no DB, no LLM, no network. Domain-agnostic — nothing here knows about
// hunting. Species / hunt-type mapping lives in seasonMatcher.ts, and season
// rows are passed in already matched.
//
// Dates are calendar dates (YYYY-MM-DD) compared as strings in the objective's
// local timezone, so DST shifts never move a boundary.

export type WindowState =
  | 'upcoming'        // trip_start in the future
  | 'active'          // inside trip window and (season open OR season unknown)
  | 'season_closed'   // a matching season row exists and today is after its end
  | 'season_not_open' // matching season row exists and today is before its start
  | 'trip_ended'      // today is after trip_end
  | 'no_dates'        // timing has no usable dates; season unknown

// The hunt is over for good: the season or the trip window has passed.
export function isEndedWindowState(state: WindowState): boolean {
  return state === 'season_closed' || state === 'trip_ended'
}

export type SeasonWindow = {
  season_start: string // YYYY-MM-DD
  season_end: string   // YYYY-MM-DD
}

export type TripTiming = {
  trip_start?: unknown
  trip_end?: unknown
  [key: string]: unknown
} | null | undefined

export type WindowDetail = {
  code: string
  trip_start?: string
  trip_end?: string
  season_start?: string
  season_end?: string
}

export type WindowEvaluation = {
  state: WindowState
  detail: WindowDetail
}

export type EvaluateWindowInput = {
  timing: TripTiming
  seasonRows: SeasonWindow[]
  today: Date | string // Date = instant (converted via tz); string = YYYY-MM-DD already local
  tz: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Calendar date (YYYY-MM-DD) of an instant, as seen in the given IANA zone.
export function localDateIn(instant: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

// Returns the YYYY-MM-DD string if it is a real calendar date, else null.
export function parseCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return value
}

// Pick the season row that governs today: the one containing today, else the
// nearest upcoming, else the latest past one.
export function pickSeasonWindow(rows: SeasonWindow[], today: string): SeasonWindow | null {
  if (rows.length === 0) return null
  const containing = rows.find(r => r.season_start <= today && today <= r.season_end)
  if (containing) return containing
  const upcoming = rows
    .filter(r => r.season_start > today)
    .sort((a, b) => a.season_start.localeCompare(b.season_start))
  if (upcoming.length > 0) return upcoming[0]
  return [...rows].sort((a, b) => b.season_end.localeCompare(a.season_end))[0]
}

export function evaluateWindowState({ timing, seasonRows, today, tz }: EvaluateWindowInput): WindowEvaluation {
  const todayStr = typeof today === 'string' ? today : localDateIn(today, tz)

  const season = pickSeasonWindow(
    seasonRows.filter(r => parseCalendarDate(r.season_start) && parseCalendarDate(r.season_end)),
    todayStr
  )
  const seasonDetail = season
    ? { season_start: season.season_start, season_end: season.season_end }
    : {}

  // Trip dates. Missing keys are fine; present-but-unparseable keys are not.
  const rawStart = timing?.trip_start
  const rawEnd = timing?.trip_end
  const hasRawStart = rawStart !== undefined && rawStart !== null && rawStart !== ''
  const hasRawEnd = rawEnd !== undefined && rawEnd !== null && rawEnd !== ''
  const tripStart = parseCalendarDate(rawStart)
  const tripEnd = parseCalendarDate(rawEnd)
  const tripUnparseable = (hasRawStart && !tripStart) || (hasRawEnd && !tripEnd)
    || (tripStart !== null && tripEnd !== null && tripStart > tripEnd)
  const tripDetail = {
    ...(tripStart ? { trip_start: tripStart } : {}),
    ...(tripEnd ? { trip_end: tripEnd } : {}),
  }

  // Precedence: season_closed > trip_ended > season_not_open > upcoming > active > no_dates
  if (season && todayStr > season.season_end) {
    return { state: 'season_closed', detail: { code: 'season_ended', ...seasonDetail, ...tripDetail } }
  }
  if (!tripUnparseable && tripEnd && todayStr > tripEnd) {
    return { state: 'trip_ended', detail: { code: 'trip_ended', ...seasonDetail, ...tripDetail } }
  }
  if (season && todayStr < season.season_start) {
    return { state: 'season_not_open', detail: { code: 'season_not_started', ...seasonDetail, ...tripDetail } }
  }
  if (!tripUnparseable && tripStart && todayStr < tripStart) {
    return { state: 'upcoming', detail: { code: 'trip_not_started', ...seasonDetail, ...tripDetail } }
  }

  if (tripUnparseable) {
    return { state: 'no_dates', detail: { code: 'unparseable_dates', ...seasonDetail } }
  }

  // Inside (or without) a trip window from here on.
  if (tripStart || tripEnd) {
    return {
      state: 'active',
      detail: { code: season ? 'in_window_season_open' : 'in_window_season_unknown', ...seasonDetail, ...tripDetail },
    }
  }

  // No trip dates at all: only a known, open season can make the objective active.
  if (season) {
    return { state: 'active', detail: { code: 'season_open_no_trip_dates', ...seasonDetail } }
  }

  return { state: 'no_dates', detail: { code: 'no_timing' } }
}
