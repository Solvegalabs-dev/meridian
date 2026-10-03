import { describe, it, expect } from 'vitest'
import {
  buildClosedBriefFields,
  closedSynthesis,
  formatBriefDate,
  windowOpensBanner,
  CLOSED_BRIEF_TIME_WINDOW,
  STRIKE_BRIEF_GO_NO_GO_VALUES,
  STRIKE_BRIEF_TIME_WINDOWS,
} from './closedBrief'
import type { WindowEvaluation } from '@/lib/objectives/windowState'

const SEASON_CLOSED: WindowEvaluation = {
  state: 'season_closed',
  detail: { code: 'season_ended', season_start: '2026-08-15', season_end: '2026-09-16', trip_start: '2026-09-12', trip_end: '2026-09-30' },
}

const TRIP_ENDED: WindowEvaluation = {
  state: 'trip_ended',
  detail: { code: 'trip_ended', trip_start: '2026-09-12', trip_end: '2026-09-30' },
}

describe('closed brief row satisfies the strike_briefs constraints', () => {
  // Mirrors supabase/migrations/20261002_ff089_p0_season_lifecycle.sql.
  it('go_no_go CLOSED is an allowed value', () => {
    expect(STRIKE_BRIEF_GO_NO_GO_VALUES).toContain('CLOSED')
    expect(buildClosedBriefFields(SEASON_CLOSED).go_no_go).toBe('CLOSED')
  })

  it('time_window is NOT NULL and one of the three allowed values', () => {
    const { time_window } = buildClosedBriefFields(SEASON_CLOSED)
    expect(time_window).toBe('0600')
    expect(STRIKE_BRIEF_TIME_WINDOWS).toContain(time_window)
    expect(CLOSED_BRIEF_TIME_WINDOW).toBe('0600')
  })

  it('confidence_tier is NULL (the column stays nullable, the tier check is untouched)', () => {
    expect(buildClosedBriefFields(SEASON_CLOSED).confidence_tier).toBeNull()
    expect(buildClosedBriefFields(TRIP_ENDED).confidence_tier).toBeNull()
  })

  it('carries no model output and no movement windows', () => {
    const f = buildClosedBriefFields(SEASON_CLOSED)
    expect(f.movement_windows).toEqual([])
    expect(f.lead_signal).toBeNull()
    expect(f.condition_delta).toBeNull()
    expect(f.terrain_intel).toBeNull()
  })
})

describe('closed synthesis text', () => {
  it('season closed: uses the season end date', () => {
    expect(closedSynthesis(SEASON_CLOSED)).toBe(
      'Season closed on Sep 16. This hunt is over; Meridian has paused daily briefs for it. Reactivate or start a new objective whenever you are ready.'
    )
  })

  it('trip ended: uses the trip end date', () => {
    expect(closedSynthesis(TRIP_ENDED)).toBe(
      'Your trip window ended on Sep 30. This hunt is over; Meridian has paused daily briefs for it. Reactivate or start a new objective whenever you are ready.'
    )
  })

  it('formats dates without a timezone shift', () => {
    expect(formatBriefDate('2026-10-01')).toBe('Oct 1')
  })
})

describe('window opens banner', () => {
  it('season not open', () => {
    expect(windowOpensBanner({
      state: 'season_not_open',
      detail: { code: 'season_not_started', season_start: '2026-10-15', season_end: '2026-11-30' },
    })).toBe('Season opens Oct 15')
  })

  it('trip upcoming', () => {
    expect(windowOpensBanner({
      state: 'upcoming',
      detail: { code: 'trip_not_started', trip_start: '2026-09-12', trip_end: '2026-09-30' },
    })).toBe('Trip opens Sep 12')
  })

  it('no banner for active, closed, or no-date objectives', () => {
    expect(windowOpensBanner({ state: 'active', detail: { code: 'in_window_season_unknown' } })).toBeNull()
    expect(windowOpensBanner(SEASON_CLOSED)).toBeNull()
    expect(windowOpensBanner({ state: 'no_dates', detail: { code: 'no_timing' } })).toBeNull()
    expect(windowOpensBanner(null)).toBeNull()
  })
})
