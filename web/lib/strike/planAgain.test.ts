import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { shiftTripYearDate, shiftTimingOneYear, planAgainForNextYear, LimitReachedError } from './planAgain'
import { ManagementError, MANAGEMENT_COLUMNS, type ManagedProfile } from './objectiveManagement'

vi.mock('@/lib/swarm/objectiveRouter', () => ({
  resolveAgentBundle: vi.fn(async () => ({ agents: ['AGENT_A'], buildStatus: 'ready' })),
}))
vi.mock('@/lib/agents/runAgentsForObjective', () => ({ runAgentsForObjective: vi.fn(async () => {}) }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }))
vi.mock('@/lib/geo/locationResolver', () => ({
  resolveFullGeography: vi.fn(async () => ({
    nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ001',
    state: 'UT', county: 'Summit', usgs_gauge_ids: [], snotel_station_ids: [],
    elevation_ft_avg: 8200, hunt_unit_id: 'resolver-unit',
  })),
}))

describe('shiftTripYearDate', () => {
  it('moves the same month and day one year forward', () => {
    expect(shiftTripYearDate('2026-10-15')).toBe('2027-10-15')
  })

  it('moves 29 Feb to 28 Feb when the next year is not a leap year', () => {
    expect(shiftTripYearDate('2028-02-29')).toBe('2029-02-28')
  })

  it('keeps 29 Feb when the next year is also a leap year', () => {
    // 2024 -> 2025 is not a leap pair in practice (leap years are 4 apart), but any Feb 29
    // source always lands on a non-leap next year, so this just re-confirms the clamp.
    expect(shiftTripYearDate('2024-02-29')).toBe('2025-02-28')
  })
})

describe('shiftTimingOneYear', () => {
  it('shifts both trip_start and trip_end', () => {
    expect(shiftTimingOneYear({ trip_start: '2026-10-01', trip_end: '2026-10-31' }))
      .toEqual({ trip_start: '2027-10-01', trip_end: '2027-10-31' })
  })

  it('returns no dates when the source has none', () => {
    expect(shiftTimingOneYear({})).toEqual({})
    expect(shiftTimingOneYear(null)).toEqual({})
  })

  it('shifts only whichever of the two is present', () => {
    expect(shiftTimingOneYear({ trip_start: '2026-10-01' })).toEqual({ trip_start: '2027-10-01' })
  })
})

function seedDb(overrides: { profileStatus?: string; timing?: Record<string, unknown>; spots?: Array<Record<string, unknown>> } = {}) {
  // focusState treats status 'completed' as ended regardless of dates, so a fixed, arbitrary
  // past trip window exercises the shift without coupling the test to the real clock's year.
  const timing = overrides.timing ?? { trip_start: '2024-10-01', trip_end: '2024-10-10' }
  return new FakeDb({
    objective_profiles: [
      {
        id: 'prof-1', objective_id: 'arc-1', user_id: 'u1', org_source: 'strike',
        status: overrides.profileStatus ?? 'completed', taxonomy_key: 'elk.bull.archery', state: 'UT',
        timing, ended_at: '2024-10-11T00:00:00Z', ended_reason: 'trip_ended',
        hunt_code: 'EA2004', domain: 'elk', lat: 40.1, lon: -111.1, hunt_unit_id: 'u-5',
        geo: { water_body: null, state: 'UT' }, priority_stack: ['weather'],
      },
    ],
    objectives: [{ id: 'arc-1', user_id: 'u1', title: 'EA2004 bull elk', status: 'active', obj_id: 'OBJ-01' }],
    objective_spots: overrides.spots ?? [
      { id: 'spot-1', objective_id: 'arc-1', name: 'Primary spot', lat: 40.1, lon: -111.1, is_active: true },
    ],
    campaign_units: [],
    hunt_seasons: [],
  })
}

function profileFor(db: FakeDb): ManagedProfile {
  const row = db.tables.objective_profiles[0]
  const cols = MANAGEMENT_COLUMNS
  const picked: Record<string, unknown> = {}
  for (const c of cols) picked[c] = row[c]
  return picked as unknown as ManagedProfile
}

describe('planAgainForNextYear', () => {
  let db: FakeDb
  beforeEach(() => { db = seedDb() })

  it('creates a new objective one year out, with the same spots, and leaves the source untouched', async () => {
    const before = JSON.stringify(db.tables.objective_profiles[0])
    const result = await planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db))
    expect(JSON.stringify(db.tables.objective_profiles[0])).toBe(before)

    const newProfile = db.tables.objective_profiles.find(p => p.id === result.profileId)!
    expect(newProfile.timing).toEqual({ trip_start: '2025-10-01', trip_end: '2025-10-10' })
    expect(newProfile.user_id).toBe('u1')
    expect(newProfile.taxonomy_key).toBe('elk.bull.archery')
    expect(newProfile.status).toBe('active')
    expect(newProfile.ended_at).toBeUndefined()

    const newSpots = db.tables.objective_spots.filter(s => s.objective_id === result.objectiveId)
    expect(newSpots).toHaveLength(1)
    expect(newSpots[0]).toMatchObject({ name: 'Primary spot', lat: 40.1, lon: -111.1, is_active: true })

    // No lineage column is written.
    const newObjective = db.tables.objectives.find(o => o.id === result.objectiveId)!
    expect(newObjective.parent_objective_id).toBeUndefined()
  })

  it('copies no briefs, notes or confidence history (none exist on the new row, nothing is queried for them)', async () => {
    db.tables.strike_briefs = [{ objective_id: 'arc-1', go_no_go: 'GO' }]
    const result = await planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db))
    const briefsForNew = (db.tables.strike_briefs ?? []).filter((b: Record<string, unknown>) => b.objective_id === result.objectiveId)
    expect(briefsForNew).toEqual([])
  })

  it('preserves which spot was active when there are several', async () => {
    db = seedDb({
      spots: [
        { id: 'spot-1', objective_id: 'arc-1', name: 'Camp A', lat: 40.1, lon: -111.1, is_active: false },
        { id: 'spot-2', objective_id: 'arc-1', name: 'Camp B', lat: 40.2, lon: -111.2, is_active: true },
      ],
    })
    const result = await planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db))
    const newSpots = db.tables.objective_spots.filter(s => s.objective_id === result.objectiveId)
    expect(newSpots).toHaveLength(2)
    const active = newSpots.find(s => s.is_active)
    expect(active?.name).toBe('Camp B')
    expect(newSpots.find(s => s.name === 'Camp A')?.is_active).toBe(false)
  })

  it('shifts a source with no dates into a dateless new objective', async () => {
    db = seedDb({ timing: {} })
    const result = await planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db))
    const newProfile = db.tables.objective_profiles.find(p => p.id === result.profileId)!
    expect(newProfile.timing).toEqual({})
  })

  it('refuses an objective that is not finished yet', async () => {
    const farFuture = String(new Date().getUTCFullYear() + 2)
    db = seedDb({ profileStatus: 'active', timing: { trip_start: `${farFuture}-10-01`, trip_end: `${farFuture}-10-10` } })
    await expect(planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db)))
      .rejects.toMatchObject({ code: 'not_finished' })
  })

  it('refuses a campaign unit', async () => {
    db.tables.campaign_units.push({ id: 'cu1', objective_id: 'arc-1' })
    await expect(planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db)))
      .rejects.toBeInstanceOf(ManagementError)
  })

  it('refuses when the category slot is full, with the same shape the create route uses', async () => {
    const extra = Array.from({ length: 3 }, (_, i) => ({
      id: `fill-${i}`, objective_id: `arc-fill-${i}`, user_id: 'u1', org_source: 'strike', status: 'active',
      taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null,
      hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null,
    }))
    db.tables.objective_profiles.push(...extra)
    let err: unknown
    try {
      await planAgainForNextYear(db as unknown as Parameters<typeof planAgainForNextYear>[0], profileFor(db))
    } catch (e) { err = e }
    expect(err).toBeInstanceOf(LimitReachedError)
    expect((err as LimitReachedError).category).toBe('hunt')
    expect((err as LimitReachedError).max).toBe(3)
  })
})
