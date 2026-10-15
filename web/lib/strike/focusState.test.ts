import { describe, it, expect } from 'vitest'
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import { focusState, FOCUS_NOW_DAYS, FOCUS_PREP_DAYS, FOCUS_RADAR_DAYS } from './focusState'

const TODAY = '2026-10-01'

function daysOut(days: number): string {
  const d = new Date(Date.UTC(2026, 9, 1))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function upcoming(days: number): WindowEvaluation {
  return { state: 'upcoming', detail: { code: 'trip_not_started', trip_start: daysOut(days) } }
}

function seasonNotOpen(days: number): WindowEvaluation {
  return { state: 'season_not_open', detail: { code: 'season_not_started', season_start: daysOut(days) } }
}

describe('focusState', () => {
  it('constants match the spec', () => {
    expect(FOCUS_NOW_DAYS).toBe(14)
    expect(FOCUS_PREP_DAYS).toBe(90)
    expect(FOCUS_RADAR_DAYS).toBe(180)
  })

  it('is "now" for an active window', () => {
    const ev: WindowEvaluation = { state: 'active', detail: { code: 'in_window_season_open' } }
    expect(focusState(ev, 'active', TODAY)).toBe('now')
  })

  it('is "ended" for season_closed or trip_ended regardless of profile status', () => {
    const closed: WindowEvaluation = { state: 'season_closed', detail: { code: 'season_ended' } }
    const tripEnded: WindowEvaluation = { state: 'trip_ended', detail: { code: 'trip_ended' } }
    expect(focusState(closed, 'active', TODAY)).toBe('ended')
    expect(focusState(tripEnded, 'active', TODAY)).toBe('ended')
  })

  it('is "ended" when the profile status is completed, even if the window looks active', () => {
    const active: WindowEvaluation = { state: 'active', detail: { code: 'in_window_season_open' } }
    expect(focusState(active, 'completed', TODAY)).toBe('ended')
    expect(focusState(null, 'completed', TODAY)).toBe('ended')
  })

  it('is "radar" for no_dates, a null evaluation, or anything uncovered', () => {
    const noDates: WindowEvaluation = { state: 'no_dates', detail: { code: 'unparseable_dates' } }
    expect(focusState(noDates, 'active', TODAY)).toBe('radar')
    expect(focusState(null, 'active', TODAY)).toBe('radar')
  })

  describe('upcoming / season_not_open day-threshold boundaries', () => {
    const cases: Array<[number, 'now' | 'prep' | 'radar' | 'next_year']> = [
      [0, 'now'],
      [14, 'now'],
      [15, 'prep'],
      [90, 'prep'],
      [91, 'radar'],
      [180, 'radar'],
      [181, 'next_year'],
    ]

    for (const [days, expected] of cases) {
      it(`upcoming at ${days} days -> ${expected}`, () => {
        expect(focusState(upcoming(days), 'active', TODAY)).toBe(expected)
      })

      it(`season_not_open at ${days} days -> ${expected}`, () => {
        expect(focusState(seasonNotOpen(days), 'active', TODAY)).toBe(expected)
      })
    }
  })

  it('prefers detail.trip_start over season_start when both are present', () => {
    const ev: WindowEvaluation = {
      state: 'upcoming',
      detail: { code: 'trip_not_started', trip_start: daysOut(5), season_start: daysOut(200) },
    }
    expect(focusState(ev, 'active', TODAY)).toBe('now')
  })

  it('falls back to season_start when trip_start is absent', () => {
    const ev: WindowEvaluation = {
      state: 'season_not_open',
      detail: { code: 'season_not_started', season_start: daysOut(200) },
    }
    expect(focusState(ev, 'active', TODAY)).toBe('next_year')
  })

  it('is "radar" when upcoming/season_not_open has neither trip_start nor season_start', () => {
    const ev: WindowEvaluation = { state: 'upcoming', detail: { code: 'trip_not_started' } }
    expect(focusState(ev, 'active', TODAY)).toBe('radar')
  })
})
