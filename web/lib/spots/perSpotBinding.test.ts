// FF-096b item 4: what is bound for each fishing spot. Each pin is resolved at its own coordinates and keeps
// its own snapshot (NWS grid and zone, county, elevation, up to five USGS stream gauges and SNOTEL stations,
// and the nearest gauge's name and distance). When a pin becomes the strike focus, the profile gets THAT pin's
// geography, so the agents' {usgs_gauge_id} (the nearest gauge) and NWS grid follow the pin.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import { activateSpot, createSpot, spotView, updateSpot, type SpotRow } from './spotService'
import { profileGeoColumns } from './applySpot'
import { FakeDb } from './testDb'

vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn() }))
const resolveMock = vi.mocked(resolveFullGeography)

const OBJ = 'obj-1'
const USER = 'user-1'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-08T12:00:00Z')

const RIVER_A: FullGeography = {
  nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ003', state: 'UT', county: 'Daggett',
  usgs_gauge_ids: ['A1', 'A2'], snotel_station_ids: ['SA1'], elevation_ft_avg: 5600, hunt_unit_id: 'unit-a',
  usgs_gauge_nearest: { site_no: 'A1', name: 'Green River Near Jensen, UT', distance_mi: 1.4 },
}
const RIVER_B: FullGeography = {
  nws_grid_office: 'RIW', nws_grid_x: 12, nws_grid_y: 34, nws_zone_id: 'WYZ019', state: 'WY', county: 'Sublette',
  usgs_gauge_ids: ['B1'], snotel_station_ids: ['SB1', 'SB2'], elevation_ft_avg: 7400, hunt_unit_id: 'unit-b',
  usgs_gauge_nearest: { site_no: 'B1', name: 'New Fork River Near Big Piney, WY', distance_mi: 8.2 },
}
const RIVER_C: FullGeography = {
  ...RIVER_A, nws_grid_x: 55, usgs_gauge_ids: ['C1'], usgs_gauge_nearest: { site_no: 'C1', name: 'Provo River Near Hailstone, UT', distance_mi: 3 },
}

function pinDb() {
  return new FakeDb({
    objective_spots: [],
    // Fishing: no declared hunt unit.
    objective_profiles: [{ objective_id: OBJ, lat: null, lon: null, state: 'UT', hunt_unit_id: null, domain: 'fishing' }],
  })
}
const asClient = (d: FakeDb) => d as unknown as Parameters<typeof createSpot>[0]
const profile = (d: FakeDb) => d.tables.objective_profiles[0]

// Resolver answers by latitude: 40 is river A, 43 river B, 41 river C.
beforeEach(() => {
  resolveMock.mockReset()
  resolveMock.mockImplementation(async (lat: number) => (lat < 41 ? RIVER_A : lat < 42 ? RIVER_C : RIVER_B))
})

describe('each pin binds its own gauges and weather grid', () => {
  it('the first pin becomes the focus and the profile gets its grid, gauges, SNOTEL, county and elevation', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)

    expect(profile(d)).toMatchObject({
      nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ003',
      county: 'Daggett', usgs_gauge_ids: ['A1', 'A2'], snotel_station_ids: ['SA1'], elevation_ft_avg: 5600,
    })
  })

  it('a second pin is resolved at its own coordinates and stored, without touching the profile', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Lower', lat: 43.0, lon: -110.2 }, NOW)

    expect(resolveMock).toHaveBeenCalledTimes(2)
    expect(resolveMock).toHaveBeenLastCalledWith(43.0, -110.2)
    expect(profile(d).usgs_gauge_ids).toEqual(['A1', 'A2']) // still the first pin
    const lower = d.tables.objective_spots[1].geo_snapshot as FullGeography
    expect(lower.usgs_gauge_ids).toEqual(['B1'])
    expect(lower.nws_grid_office).toBe('RIW')
  })

  it('switching the focus rebinds the profile to the new pin: grid, gauges (so the nearest), SNOTEL, county', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    const { spot: lower } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Lower', lat: 43.0, lon: -110.2 }, NOW)

    await activateSpot(asClient(d), OBJ, lower.id, NOW)

    expect(profile(d)).toMatchObject({
      nws_grid_office: 'RIW', nws_grid_x: 12, nws_grid_y: 34, nws_zone_id: 'WYZ019',
      county: 'Sublette', usgs_gauge_ids: ['B1'], snotel_station_ids: ['SB1', 'SB2'], elevation_ft_avg: 7400,
    })
    // The agents read the first id as the nearest gauge: it is now this pin's.
    expect((profile(d).usgs_gauge_ids as string[])[0]).toBe('B1')
  })

  it('switching back restores the first pin from its saved snapshot, with no new external lookup', async () => {
    const d = pinDb()
    const { spot: upper } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    const { spot: lower } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Lower', lat: 43.0, lon: -110.2 }, NOW)
    await activateSpot(asClient(d), OBJ, lower.id, NOW)
    resolveMock.mockClear()

    const result = await activateSpot(asClient(d), OBJ, upper.id, NOW)

    expect(result.reused).toBe(true)
    expect(resolveMock).not.toHaveBeenCalled()
    expect(profile(d)).toMatchObject({ nws_grid_office: 'SLC', usgs_gauge_ids: ['A1', 'A2'], county: 'Daggett' })
  })

  it('a snapshot older than 30 days is re-resolved for that pin on switch', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    const { spot: lower } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Lower', lat: 43.0, lon: -110.2 }, NOW)
    d.tables.objective_spots[1].geo_resolved_at = new Date(NOW.getTime() - 31 * DAY).toISOString()
    resolveMock.mockClear()

    const result = await activateSpot(asClient(d), OBJ, lower.id, NOW)

    expect(result.reused).toBe(false)
    expect(resolveMock).toHaveBeenCalledWith(43.0, -110.2)
    expect(profile(d).usgs_gauge_ids).toEqual(['B1'])
  })

  it('moving an inactive pin clears its snapshot, so its next switch resolves the new spot, not the old one', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    const { spot: lower } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Lower', lat: 43.0, lon: -110.2 }, NOW)

    await updateSpot(asClient(d), OBJ, lower.id, { lat: 41.5, lon: -111.0 }, {}, NOW)
    expect(d.tables.objective_spots[1].geo_snapshot).toBeNull()

    await activateSpot(asClient(d), OBJ, lower.id, NOW)
    expect(profile(d).usgs_gauge_ids).toEqual(['C1'])
  })

  it('a pin with no gauge in range binds an empty list, not the previous pin\'s gauges', async () => {
    resolveMock.mockImplementation(async (lat: number) => (lat < 42 ? RIVER_A : { ...RIVER_B, usgs_gauge_ids: [], usgs_gauge_nearest: null }))
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    const { spot: remote } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Remote', lat: 43.0, lon: -110.2 }, NOW)

    await activateSpot(asClient(d), OBJ, remote.id, NOW)
    expect(profile(d).usgs_gauge_ids).toEqual([])
  })
})

describe('the nearest gauge is kept in the snapshot, not in a profile column', () => {
  it('the snapshot carries the name and distance, and the profile row never gets the key', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)

    expect((d.tables.objective_spots[0].geo_snapshot as FullGeography).usgs_gauge_nearest).toEqual(RIVER_A.usgs_gauge_nearest)
    expect('usgs_gauge_nearest' in profile(d)).toBe(false)
    expect('usgs_gauge_nearest' in profileGeoColumns(RIVER_A, null)).toBe(false)
  })

  it('the spot view shows each pin\'s own nearest gauge', async () => {
    const d = pinDb()
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Upper', lat: 40.9, lon: -109.4 }, NOW)
    await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Lower', lat: 43.0, lon: -110.2 }, NOW)

    const [upper, lower] = d.tables.objective_spots.map(r => spotView(r as unknown as SpotRow))
    expect(upper.nearest_gauge).toEqual({ name: 'Green River Near Jensen, UT', distance_mi: 1.4 })
    expect(lower.nearest_gauge).toEqual({ name: 'New Fork River Near Big Piney, WY', distance_mi: 8.2 })
  })

  it('a snapshot saved before this change has no gauge name, so no gauge line (not an error)', () => {
    const { usgs_gauge_nearest: _omit, ...old } = RIVER_A
    void _omit
    const row = { id: 's', objective_id: OBJ, name: 'Old', lat: 40, lon: -109, is_active: false, sort_order: 0, geo_snapshot: old, geo_resolved_at: null, hunt_unit_id: null, inside_boundary: null, activated_at: null, created_at: '2026-01-01' } as SpotRow
    expect(spotView(row).nearest_gauge).toBeNull()
  })
})
