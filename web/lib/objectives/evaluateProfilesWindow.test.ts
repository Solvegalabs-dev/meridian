import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeCall } from '@/lib/testing/fakeSupabase'
import { evaluateProfilesWindow, type ObjectiveWindowProfile } from './objectiveWindow'

const NOW = new Date('2026-10-03T15:00:00Z') // 09:00 MDT, Oct 3

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

function profile(objectiveId: string, overrides: Partial<ObjectiveWindowProfile> = {}): ObjectiveWindowProfile {
  return {
    id: `prof-${objectiveId}`,
    objective_id: objectiveId,
    user_id: 'user-1',
    status: 'active',
    timing: { trip_start: '2026-09-12', trip_end: '2026-09-30' },
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

describe('evaluateProfilesWindow', () => {
  it('reads season rows in one batched query, not one per profile', async () => {
    const sb = fakeSupabase(() => ({ data: [] }))
    const out = await evaluateProfilesWindow(sb as never, [profile('obj-1'), profile('obj-2'), profile('obj-3')], NOW)

    const seasonCalls = sb.calls.filter((c: FakeCall) => c.table === 'hunt_seasons')
    expect(seasonCalls).toHaveLength(1)
    expect(out.size).toBe(3)
  })

  it('evaluates a trip that ended yesterday as trip_ended when no season matches', async () => {
    const sb = fakeSupabase(() => ({ data: [] }))
    const out = await evaluateProfilesWindow(sb as never, [profile('obj-17')], NOW)
    expect(out.get('obj-17')?.state).toBe('trip_ended')
    expect(out.get('obj-17')?.detail.trip_end).toBe('2026-09-30')
  })

  it('evaluates season_closed when the matched season has ended', async () => {
    const sb = fakeSupabase(() => ({ data: [SEASON_ROW] }))
    const out = await evaluateProfilesWindow(sb as never, [profile('obj-17')], NOW)
    expect(out.get('obj-17')?.state).toBe('season_closed')
    expect(out.get('obj-17')?.detail.season_end).toBe('2026-09-16')
  })

  it('fails open to the trip window when the season read errors', async () => {
    const sb = fakeSupabase(() => ({ error: { message: 'relation "hunt_seasons" does not exist' } }))
    const out = await evaluateProfilesWindow(sb as never, [profile('obj-17', { timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' } })], NOW)
    expect(out.get('obj-17')?.state).toBe('active')
  })

  it('returns an empty map without querying when there are no profiles', async () => {
    const sb = fakeSupabase(() => ({ data: [] }))
    const out = await evaluateProfilesWindow(sb as never, [], NOW)
    expect(out.size).toBe(0)
    expect(sb.calls).toHaveLength(0)
  })

  // FF-095: fishing has no hunt season. The evaluator must give a sensible state from the trip window alone.
  describe('fishing objectives (trip window only)', () => {
    const fishing = (id: string, timing: ObjectiveWindowProfile['timing']) =>
      profile(id, { taxonomy_key: 'salmon.sockeye.river_migration', state: 'AK', domain: 'fishing', timing })

    it('is active inside the trip window, upcoming before it, and trip_ended after it', async () => {
      const sb = fakeSupabase(() => ({ data: [] }))
      const out = await evaluateProfilesWindow(sb as never, [
        fishing('inside', { trip_start: '2026-10-01', trip_end: '2026-10-31' }),
        fishing('before', { trip_start: '2026-11-05', trip_end: '2026-11-09' }),
        fishing('after', { trip_start: '2026-09-05', trip_end: '2026-09-09' }),
      ], NOW)
      expect(out.get('inside')?.state).toBe('active')
      expect(out.get('before')?.state).toBe('upcoming')
      expect(out.get('before')?.detail.trip_start).toBe('2026-11-05')
      expect(out.get('after')?.state).toBe('trip_ended')
    })

    it('never matches a hunting season row, even when the table returns one for the same state', async () => {
      const sb = fakeSupabase(() => ({ data: [{ ...SEASON_ROW, state: 'AK' }] }))
      const out = await evaluateProfilesWindow(sb as never, [fishing('inside', { trip_start: '2026-10-01', trip_end: '2026-10-31' })], NOW)
      expect(out.get('inside')?.state).toBe('active') // the elk season_closed row is not applied to a salmon trip
      expect(out.get('inside')?.detail.season_end).toBeUndefined()
    })

    it('with no trip dates the state is no_dates, so the list shows no status chip', async () => {
      const sb = fakeSupabase(() => ({ data: [] }))
      const out = await evaluateProfilesWindow(sb as never, [fishing('bare', null)], NOW)
      expect(out.get('bare')?.state).toBe('no_dates')
    })
  })
})
