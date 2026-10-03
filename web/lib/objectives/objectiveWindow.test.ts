import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeCall } from '@/lib/testing/fakeSupabase'
import {
  applyWindowLifecycle,
  applyWindowLifecycleForUser,
  type ObjectiveWindowProfile,
} from './objectiveWindow'
import type { WindowEvaluation } from './windowState'

const NOW = new Date('2026-10-03T15:00:00Z') // 09:00 MDT, Oct 3
const TRIP = { trip_start: '2026-09-12', trip_end: '2026-09-30' }

const SEASON_ROW = {
  id: 'season-1',
  state: 'UT',
  species: 'elk',
  hunt_type: 'archery',
  sex_class: 'bull',
  hunt_unit_id: null,
  hunt_code: null,
  season_year: 2026,
  season_start: '2026-08-15',
  season_end: '2026-09-16',
  source_url: 'https://example.invalid/proclamation',
  source_checked_at: '2026-10-02',
  notes: null,
}

function profile(overrides: Partial<ObjectiveWindowProfile> = {}): ObjectiveWindowProfile {
  return {
    id: 'prof-1',
    objective_id: 'obj-17',
    user_id: 'user-1',
    status: 'active',
    timing: TRIP,
    taxonomy_key: 'elk.bull.archery',
    state: 'UT',
    lat: 40.7,
    lon: -111.9,
    hunt_unit_id: null,
    domain: 'elk_hunt',
    ended_at: null,
    ended_reason: null,
    ...overrides,
  }
}

const SEASON_CLOSED: WindowEvaluation = {
  state: 'season_closed',
  detail: { code: 'season_ended', season_start: '2026-08-15', season_end: '2026-09-16' },
}
const ACTIVE: WindowEvaluation = { state: 'active', detail: { code: 'in_window_season_open' } }

// Responder for the writes the lifecycle makes. activeUnitsLeft drives campaign closure.
function responder(activeUnitsLeft = 0) {
  return (call: FakeCall) => {
    if (call.table === 'campaign_units' && call.op === 'update') return { data: [{ campaign_id: 'camp-1' }] }
    if (call.table === 'campaign_units' && call.head) return { count: activeUnitsLeft }
    return { data: null }
  }
}

function writesTo(calls: FakeCall[], table: string, op: FakeCall['op']) {
  return calls.filter(c => c.table === table && c.op === op)
}

describe('applyWindowLifecycle: ending a hunt', () => {
  it('completes the profile, expires active units and closes the campaign', async () => {
    const db = fakeSupabase(responder(0))
    const result = await applyWindowLifecycle(db as never, profile(), SEASON_CLOSED, NOW)

    expect(result).toBe('ended')

    const [profWrite] = writesTo(db.calls, 'objective_profiles', 'update')
    expect(profWrite.payload).toMatchObject({ status: 'completed', ended_reason: 'season_closed' })
    expect(profWrite.filters).toContainEqual(['id', 'eq', 'prof-1'])
    expect((profWrite.payload as { ended_at: string }).ended_at).toBe(NOW.toISOString())

    const [expire] = writesTo(db.calls, 'campaign_units', 'update')
    expect(expire.payload).toMatchObject({ status: 'expired' })
    expect(expire.filters).toContainEqual(['objective_id', 'eq', 'obj-17'])
    // Only active units expire. A unit the user marked 'missed' stays as it is.
    expect(expire.filters).toContainEqual(['status', 'eq', 'active'])

    const [close] = writesTo(db.calls, 'hunt_campaigns', 'update')
    expect(close.payload).toMatchObject({ status: 'closed' })
    expect(close.filters).toContainEqual(['id', 'eq', 'camp-1'])
  })

  it('keeps the campaign open while another unit is still active', async () => {
    const db = fakeSupabase(responder(1))
    await applyWindowLifecycle(db as never, profile(), SEASON_CLOSED, NOW)
    expect(writesTo(db.calls, 'hunt_campaigns', 'update')).toHaveLength(0)
  })

  it('is idempotent: an already-ended profile is not rewritten', async () => {
    const db = fakeSupabase(responder(0))
    const ended = profile({ status: 'completed', ended_at: '2026-09-17T06:00:00Z', ended_reason: 'season_closed' })
    const result = await applyWindowLifecycle(db as never, ended, SEASON_CLOSED, NOW)

    expect(result).toBeNull()
    expect(writesTo(db.calls, 'objective_profiles', 'update')).toHaveLength(0)
    // The ended_at from the first transition is kept, not reset.
  })

  it('a trip that ended records trip_ended', async () => {
    const db = fakeSupabase(responder(0))
    const tripEnded: WindowEvaluation = { state: 'trip_ended', detail: { code: 'trip_ended', trip_end: '2026-09-30' } }
    await applyWindowLifecycle(db as never, profile(), tripEnded, NOW)
    const [profWrite] = writesTo(db.calls, 'objective_profiles', 'update')
    expect(profWrite.payload).toMatchObject({ status: 'completed', ended_reason: 'trip_ended' })
  })
})

describe('applyWindowLifecycle: reactivation', () => {
  it('a window edit that makes the hunt current again restores it and reopens the campaign', async () => {
    const db = fakeSupabase(responder(0))
    const ended = profile({ status: 'completed', ended_at: '2026-09-17T06:00:00Z', ended_reason: 'season_closed' })
    const result = await applyWindowLifecycle(db as never, ended, ACTIVE, NOW)

    expect(result).toBe('reactivated')

    const [profWrite] = writesTo(db.calls, 'objective_profiles', 'update')
    expect(profWrite.payload).toEqual({ status: 'active', ended_at: null, ended_reason: null })

    const [restore] = writesTo(db.calls, 'campaign_units', 'update')
    expect(restore.payload).toMatchObject({ status: 'active' })
    expect(restore.filters).toContainEqual(['status', 'eq', 'expired'])

    const [reopen] = writesTo(db.calls, 'hunt_campaigns', 'update')
    expect(reopen.payload).toMatchObject({ status: 'active' })
    expect(reopen.filters).toContainEqual(['status', 'eq', 'closed'])
  })

  it('never reactivates a profile that a person completed by hand (ended_at null)', async () => {
    const db = fakeSupabase(responder(0))
    const manual = profile({ status: 'completed', ended_at: null, ended_reason: null })
    const result = await applyWindowLifecycle(db as never, manual, ACTIVE, NOW)

    expect(result).toBeNull()
    expect(db.writes()).toHaveLength(0)
  })

  it('an active profile with an active window is left alone', async () => {
    const db = fakeSupabase(responder(0))
    const result = await applyWindowLifecycle(db as never, profile(), ACTIVE, NOW)
    expect(result).toBeNull()
    expect(db.writes()).toHaveLength(0)
  })
})

describe('applyWindowLifecycleForUser', () => {
  it('evaluates each Strike profile and returns the ended objective ids', async () => {
    const db = fakeSupabase((call) => {
      if (call.table === 'objective_profiles' && call.op === 'select' && !call.single) {
        return {
          data: [
            profile({ id: 'prof-17', objective_id: 'obj-17' }), // trip ended Sep 30, season closed Sep 16
            profile({ id: 'prof-2', objective_id: 'obj-2', timing: { trip_start: '2026-10-10', trip_end: '2026-10-20' }, state: 'ID' }),
          ],
        }
      }
      if (call.table === 'hunt_seasons') return { data: [SEASON_ROW] }
      if (call.table === 'campaign_units' && call.op === 'update') return { data: [] }
      return { data: null }
    })

    const ended = await applyWindowLifecycleForUser(db as never, 'user-1', NOW)

    expect(Array.from(ended)).toEqual(['obj-17'])
    expect(writesTo(db.calls, 'objective_profiles', 'update')).toHaveLength(1)
  })

  it('a failing profile is logged and does not stop the others', async () => {
    const db = fakeSupabase((call) => {
      if (call.table === 'objective_profiles' && call.op === 'select' && !call.single) {
        return { data: [profile({ id: 'prof-17', objective_id: 'obj-17' }), profile({ id: 'prof-b', objective_id: 'obj-b' })] }
      }
      if (call.table === 'objective_profiles' && call.op === 'update') return { error: { message: 'boom' } }
      if (call.table === 'hunt_seasons') return { data: [SEASON_ROW] }
      return { data: null }
    })

    const ended = await applyWindowLifecycleForUser(db as never, 'user-1', NOW)
    expect(ended.has('obj-17')).toBe(true)
    expect(ended.has('obj-b')).toBe(true)
  })
})
