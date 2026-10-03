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
})
