import { describe, it, expect } from 'vitest'
import { resolveEndedNotice, endedNoticeLabel } from './closedBrief'
import type { WindowEvaluation } from '@/lib/objectives/windowState'

const TRIP_ENDED_YESTERDAY: WindowEvaluation = {
  state: 'trip_ended',
  detail: { code: 'trip_ended', trip_start: '2026-09-12', trip_end: '2026-10-02' },
}
const SEASON_CLOSED: WindowEvaluation = {
  state: 'season_closed',
  detail: { code: 'season_ended', season_start: '2026-08-15', season_end: '2026-09-16' },
}
const ACTIVE: WindowEvaluation = { state: 'active', detail: { code: 'in_window_season_open' } }

describe('resolveEndedNotice', () => {
  it('ends a unit whose trip ended yesterday, even when its stored status is still active', () => {
    const notice = resolveEndedNotice({ evaluation: TRIP_ENDED_YESTERDAY, unitStatus: 'active', profileStatus: 'active' })
    expect(notice).toEqual({ reason: 'trip_ended', date: '2026-10-02' })
    expect(endedNoticeLabel(notice!)).toBe('Trip ended on Oct 2')
  })

  it('reports a season close with the season end date', () => {
    const notice = resolveEndedNotice({ evaluation: SEASON_CLOSED, unitStatus: 'active', profileStatus: 'active' })
    expect(endedNoticeLabel(notice!)).toBe('Season closed on Sep 16')
  })

  it('leaves a unit inside its window live', () => {
    expect(resolveEndedNotice({ evaluation: ACTIVE, unitStatus: 'active', profileStatus: 'active' })).toBeNull()
  })

  it('treats a stored expired unit as ended when the evaluation is unavailable, with no date', () => {
    const notice = resolveEndedNotice({ evaluation: null, unitStatus: 'expired', profileStatus: 'completed', endedReason: 'season_closed' })
    expect(notice).toEqual({ reason: 'season_closed', date: null })
    expect(endedNoticeLabel(notice!)).toBe('Season closed')
  })

  it('does not let a stored active status override a live evaluation', () => {
    expect(resolveEndedNotice({ evaluation: ACTIVE, unitStatus: 'active', profileStatus: 'active', endedReason: 'trip_ended' })).toBeNull()
  })
})
