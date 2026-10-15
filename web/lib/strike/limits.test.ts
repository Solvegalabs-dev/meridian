import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeCall } from '@/lib/testing/fakeSupabase'
import { strikeSlots, categoryFor, STRIKE_LIMITS } from './limits'
import type { ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'

const NOW = new Date('2026-10-03T12:00:00Z')

function profile(id: string, over: Partial<ObjectiveWindowProfile> = {}): ObjectiveWindowProfile {
  return {
    id,
    objective_id: `obj-${id}`,
    user_id: 'user-1',
    status: 'active',
    timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' },
    taxonomy_key: 'elk.bull.archery',
    state: 'UT',
    lat: null,
    lon: null,
    hunt_unit_id: null,
    hunt_code: null,
    domain: 'elk_hunt',
    ended_at: null,
    ended_reason: null,
    ...over,
  }
}

function sbWith(profiles: ObjectiveWindowProfile[], seasonRows: unknown[] = []) {
  return fakeSupabase((call: FakeCall) => {
    if (call.table === 'objective_profiles') return { data: profiles }
    if (call.table === 'hunt_seasons') return { data: seasonRows }
    return { data: [] }
  })
}

describe('strikeSlots', () => {
  it('counts active hunting and fishing profiles into their own buckets, with the configured max', async () => {
    const sb = sbWith([
      profile('h1'),
      profile('h2', { taxonomy_key: 'turkey.eastern.archery', domain: 'turkey_hunt' }),
      profile('f1', { taxonomy_key: 'trout.rainbow.fly_fishing', domain: 'fishing' }),
    ])
    const out = await strikeSlots(sb as never, 'user-1', NOW)
    expect(out).toEqual({
      hunt: { used: 2, max: STRIKE_LIMITS.hunt },
      fish: { used: 1, max: STRIKE_LIMITS.fish },
      total: { used: 3, max: STRIKE_LIMITS.total },
    })
  })

  it('only reads the signed-in user\'s own active Strike profiles', async () => {
    const sb = sbWith([profile('h1')])
    await strikeSlots(sb as never, 'user-1', NOW)
    const read = sb.calls.find(c => c.table === 'objective_profiles')!
    expect(read.filters).toEqual(expect.arrayContaining([
      ['user_id', 'eq', 'user-1'],
      ['org_source', 'eq', 'strike'],
      ['status', 'eq', 'active'],
    ]))
  })

  it('frees a slot for a hunt whose window has already ended, even though the sweep has not flipped its status yet', async () => {
    // Still objective_profiles.status = 'active' (the sweep has not run), but the trip window
    // closed in September — the home page would show this as "Trip ended".
    const endedButStillActive = profile('e1', { timing: { trip_start: '2026-09-01', trip_end: '2026-09-15' } })
    const live = profile('h1')
    const sb = sbWith([endedButStillActive, live])
    const out = await strikeSlots(sb as never, 'user-1', NOW)
    expect(out.hunt.used).toBe(1)
    expect(out.total.used).toBe(1)
  })

  it('returns zero used slots when the user has no Strike profiles', async () => {
    const sb = sbWith([])
    const out = await strikeSlots(sb as never, 'user-1', NOW)
    expect(out).toEqual({
      hunt: { used: 0, max: STRIKE_LIMITS.hunt },
      fish: { used: 0, max: STRIKE_LIMITS.fish },
      total: { used: 0, max: STRIKE_LIMITS.total },
    })
  })

  it('counts an unlinked profile (no objective_id) just like any other', async () => {
    const sb = sbWith([profile('orphan', { objective_id: null as unknown as string })])
    const out = await strikeSlots(sb as never, 'user-1', NOW)
    expect(out.hunt.used).toBe(1)
  })
})

describe('categoryFor', () => {
  it('is "fish" for a fishing domain or taxonomy key, "hunt" otherwise', () => {
    expect(categoryFor({ domain: 'fishing', taxonomy_key: 'trout.rainbow.fly_fishing' })).toBe('fish')
    expect(categoryFor({ domain: 'elk_hunt', taxonomy_key: 'elk.bull.archery' })).toBe('hunt')
    expect(categoryFor({ taxonomy_key: 'salmon.sockeye.river_migration' })).toBe('fish')
  })
})
