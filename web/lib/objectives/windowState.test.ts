import { describe, it, expect } from 'vitest'
import {
  evaluateWindowState,
  localDateIn,
  parseCalendarDate,
  pickSeasonWindow,
  type SeasonWindow,
  type WindowState,
} from './windowState'

const TZ = 'America/Denver'
const TRIP = { trip_start: '2026-09-12', trip_end: '2026-09-30' }
const ELK_ARCHERY_SEASON: SeasonWindow = { season_start: '2026-08-15', season_end: '2026-09-16' }
const LATER_SEASON: SeasonWindow = { season_start: '2026-10-01', season_end: '2026-11-30' }

function at(today: string, timing: unknown, seasonRows: SeasonWindow[] = []) {
  return evaluateWindowState({ timing: timing as never, seasonRows, today, tz: TZ })
}

describe('evaluateWindowState: every state', () => {
  const cases: Array<[string, unknown, SeasonWindow[], string, WindowState]> = [
    ['no timing, no season', undefined, [], '2026-09-20', 'no_dates'],
    ['empty timing object', {}, [], '2026-09-20', 'no_dates'],
    ['trip window only, inside', TRIP, [], '2026-09-15', 'active'],
    ['trip window before start', TRIP, [], '2026-09-11', 'upcoming'],
    ['trip window after end', TRIP, [], '2026-10-01', 'trip_ended'],
    ['season closed (trip still open)', TRIP, [ELK_ARCHERY_SEASON], '2026-09-17', 'season_closed'],
    ['season not open yet', { trip_start: '2026-09-01', trip_end: '2026-09-30' }, [LATER_SEASON], '2026-09-20', 'season_not_open'],
    ['season open and trip open', TRIP, [ELK_ARCHERY_SEASON], '2026-09-14', 'active'],
    ['season known, no trip dates, season open', {}, [ELK_ARCHERY_SEASON], '2026-08-20', 'active'],
  ]

  it.each(cases)('%s', (_name, timing, seasons, today, expected) => {
    expect(at(today, timing, seasons).state).toBe(expected)
  })
})

describe('evaluateWindowState: boundary days', () => {
  it('last day of the trip is still active', () => {
    expect(at('2026-09-30', TRIP).state).toBe('active')
  })

  it('first day after the trip is trip_ended', () => {
    expect(at('2026-10-01', TRIP).state).toBe('trip_ended')
  })

  it('first day of the trip is active', () => {
    expect(at('2026-09-12', TRIP).state).toBe('active')
  })

  it('day before the trip is upcoming', () => {
    expect(at('2026-09-11', TRIP).state).toBe('upcoming')
  })

  it('last day of the season is still open', () => {
    expect(at('2026-09-16', TRIP, [ELK_ARCHERY_SEASON]).state).toBe('active')
  })

  it('first day after the season is season_closed', () => {
    const r = at('2026-09-17', TRIP, [ELK_ARCHERY_SEASON])
    expect(r.state).toBe('season_closed')
    expect(r.detail.season_end).toBe('2026-09-16')
  })
})

describe('evaluateWindowState: precedence', () => {
  it('season_closed beats trip_ended', () => {
    expect(at('2026-10-02', TRIP, [ELK_ARCHERY_SEASON]).state).toBe('season_closed')
  })

  it('trip_ended beats season_not_open', () => {
    const earlyTrip = { trip_start: '2026-08-01', trip_end: '2026-08-10' }
    expect(at('2026-08-20', earlyTrip, [LATER_SEASON]).state).toBe('trip_ended')
  })

  it('season_not_open beats upcoming', () => {
    const r = at('2026-09-01', { trip_start: '2026-09-05', trip_end: '2026-09-30' }, [LATER_SEASON])
    expect(r.state).toBe('season_not_open')
  })
})

describe('evaluateWindowState: fixtures', () => {
  // The OBJ-17 case. Trip window starts inside the season and ends after it closed.
  it('trip window extends past a closed season (OBJ-17 fixture)', () => {
    const r = at('2026-09-17', TRIP, [ELK_ARCHERY_SEASON])
    expect(r.state).toBe('season_closed')
    expect(r.detail).toEqual({
      code: 'season_ended',
      season_start: '2026-08-15',
      season_end: '2026-09-16',
      trip_start: '2026-09-12',
      trip_end: '2026-09-30',
    })
  })

  it('fishing objective with no season rows is governed only by its trip window', () => {
    const fishingTrip = { trip_start: '2026-10-10', trip_end: '2026-10-20' }
    const r = at('2026-10-05', fishingTrip, [])
    expect(r.state).toBe('upcoming')
    expect(r.detail.code).toBe('trip_not_started')
  })

  it('fishing objective with a current window reads as active, season unknown', () => {
    const r = at('2026-10-12', { trip_start: '2026-10-10', trip_end: '2026-10-20' }, [])
    expect(r.state).toBe('active')
    expect(r.detail.code).toBe('in_window_season_unknown')
  })
})

describe('evaluateWindowState: bad input never throws', () => {
  it('unparseable trip_start is no_dates with unparseable_dates', () => {
    const r = at('2026-09-20', { trip_start: '2026-13-40', trip_end: '2026-09-30' })
    expect(r.state).toBe('no_dates')
    expect(r.detail.code).toBe('unparseable_dates')
  })

  it('a non-date string is no_dates', () => {
    expect(at('2026-09-20', { trip_start: 'next tuesday' }).state).toBe('no_dates')
  })

  it('trip_start after trip_end is unparseable', () => {
    const r = at('2026-09-20', { trip_start: '2026-10-05', trip_end: '2026-09-30' })
    expect(r.state).toBe('no_dates')
    expect(r.detail.code).toBe('unparseable_dates')
  })

  it('null timing is no_dates', () => {
    expect(at('2026-09-20', null).state).toBe('no_dates')
  })

  it('a bad date still lets a closed season win', () => {
    const r = at('2026-09-20', { trip_start: 'bad' }, [ELK_ARCHERY_SEASON])
    expect(r.state).toBe('season_closed')
  })

  it('open-ended trip (start only) is active once started', () => {
    expect(at('2026-12-01', { trip_start: '2026-09-12' }).state).toBe('active')
  })
})

describe('evaluateWindowState: timezone and DST', () => {
  // 2026-10-01T05:30Z is still Sep 30 at 23:30 in Denver. A UTC date would say Oct 1.
  it('uses the local calendar date, not the UTC date', () => {
    const r = evaluateWindowState({
      timing: TRIP,
      seasonRows: [],
      today: new Date('2026-10-01T05:30:00Z'),
      tz: TZ,
    })
    expect(r.state).toBe('active')
  })

  it('flips to trip_ended at local midnight, not UTC midnight', () => {
    const r = evaluateWindowState({
      timing: TRIP,
      seasonRows: [],
      today: new Date('2026-10-01T06:01:00Z'), // 00:01 MDT on Oct 1
      tz: TZ,
    })
    expect(r.state).toBe('trip_ended')
  })

  // Fall-back: MDT ends 2026-11-01 at 08:00Z.
  it('handles the fall DST transition without moving the boundary', () => {
    const fallTrip = { trip_start: '2026-10-25', trip_end: '2026-10-31' }
    const lastNight = evaluateWindowState({ timing: fallTrip, seasonRows: [], today: new Date('2026-11-01T05:59:00Z'), tz: TZ })
    const firstDay = evaluateWindowState({ timing: fallTrip, seasonRows: [], today: new Date('2026-11-01T06:00:00Z'), tz: TZ })
    expect(lastNight.state).toBe('active')
    expect(firstDay.state).toBe('trip_ended')
  })

  // Spring-forward: MST starts 2026-03-08 at 09:00Z. Before that, Denver is UTC-7.
  it('handles the spring DST transition: the trip starts on the local date', () => {
    const springTrip = { trip_start: '2026-03-08', trip_end: '2026-03-31' }
    const beforeStart = evaluateWindowState({ timing: springTrip, seasonRows: [], today: new Date('2026-03-08T06:30:00Z'), tz: TZ })
    const afterStart = evaluateWindowState({ timing: springTrip, seasonRows: [], today: new Date('2026-03-08T07:00:00Z'), tz: TZ })
    expect(beforeStart.state).toBe('upcoming') // 23:30 MST on Mar 7
    expect(afterStart.state).toBe('active') // 00:00 MST on Mar 8
  })
})

describe('season row selection', () => {
  const past: SeasonWindow = { season_start: '2025-08-15', season_end: '2025-09-16' }
  const upcoming: SeasonWindow = { season_start: '2026-10-01', season_end: '2026-11-30' }
  const later: SeasonWindow = { season_start: '2026-12-01', season_end: '2026-12-31' }

  it('prefers the row containing today', () => {
    expect(pickSeasonWindow([past, ELK_ARCHERY_SEASON, upcoming], '2026-09-01')).toBe(ELK_ARCHERY_SEASON)
  })

  it('else the nearest upcoming row', () => {
    expect(pickSeasonWindow([later, upcoming, past], '2026-09-20')).toBe(upcoming)
  })

  it('else the latest past row', () => {
    expect(pickSeasonWindow([past, { season_start: '2024-08-15', season_end: '2024-09-16' }], '2026-09-20')).toBe(past)
  })

  it('returns null for no rows', () => {
    expect(pickSeasonWindow([], '2026-09-20')).toBeNull()
  })
})

describe('calendar date helpers', () => {
  it('accepts real calendar dates only', () => {
    expect(parseCalendarDate('2026-02-28')).toBe('2026-02-28')
    expect(parseCalendarDate('2026-02-30')).toBeNull()
    expect(parseCalendarDate('2026-9-1')).toBeNull()
    expect(parseCalendarDate(20260901)).toBeNull()
  })

  it('localDateIn converts an instant to the zone date', () => {
    expect(localDateIn(new Date('2026-10-01T05:30:00Z'), TZ)).toBe('2026-09-30')
  })
})
