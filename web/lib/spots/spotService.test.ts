import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import { activateSpot, createSpot, deleteSpot, setActiveLocation, updateSpot } from './spotService'
import { SpotError } from './applySpot'
import { FakeDb } from './testDb'

vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn() }))
const resolveMock = vi.mocked(resolveFullGeography)

const OBJ = 'obj-1'
const USER = 'user-1'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-04T12:00:00Z')

function geo(over: Partial<FullGeography> = {}): FullGeography {
  return {
    nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ001',
    state: 'UT', county: 'Summit', usgs_gauge_ids: [], snotel_station_ids: [],
    elevation_ft_avg: 8200, hunt_unit_id: 'resolver-unit', ...over,
  }
}

function spot(id: string, over: Record<string, unknown> = {}) {
  return {
    id, objective_id: OBJ, user_id: USER, name: `Spot ${id}`, lat: 40.5, lon: -111,
    is_active: false, sort_order: 0, geo_snapshot: geo(), geo_resolved_at: new Date(NOW.getTime() - DAY).toISOString(),
    hunt_unit_id: 'resolver-unit', activated_at: null, created_at: '2026-09-01T00:00:00Z', ...over,
  }
}

function db(spots: Record<string, unknown>[] = [], profile: Record<string, unknown> | null = {
  objective_id: OBJ, lat: 40.5, lon: -111, state: 'UT', hunt_unit_id: 'declared-unit',
}) {
  return new FakeDb({
    objective_spots: spots,
    objective_profiles: profile ? [profile] : [],
  })
}

const asClient = (d: FakeDb) => d as unknown as Parameters<typeof createSpot>[0]

beforeEach(() => {
  resolveMock.mockReset()
  resolveMock.mockResolvedValue(geo())
})

describe('limit enforcement', () => {
  it('refuses a fourth spot with spot_limit_reached and the limit', async () => {
    const d = db([spot('a'), spot('b'), spot('c')])
    const err = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'D', lat: 41, lon: -111 }, NOW)
      .catch(e => e)
    expect(err).toBeInstanceOf(SpotError)
    expect(err.status).toBe(403)
    expect(err.body).toEqual({ code: 'spot_limit_reached', limit: 3 })
    expect(d.tables.objective_spots).toHaveLength(3)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('an uncapped account can add beyond three', async () => {
    process.env.SPOT_LIMIT_UNCAPPED_USER_IDS = USER
    try {
      const d = db([spot('a'), spot('b'), spot('c')])
      await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'D', lat: 41, lon: -111 }, NOW)
      expect(d.tables.objective_spots).toHaveLength(4)
    } finally {
      delete process.env.SPOT_LIMIT_UNCAPPED_USER_IDS
    }
  })
})

describe('validation', () => {
  it('rejects out-of-range coordinates before any work', async () => {
    const d = db()
    const err = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'x', lat: 95, lon: 0 }, NOW).catch(e => e)
    expect(err.status).toBe(400)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('rejects an empty or over-long name', async () => {
    const d = db()
    const empty = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: '   ', lat: 41, lon: -111 }, NOW).catch(e => e)
    const long = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'x'.repeat(41), lat: 41, lon: -111 }, NOW).catch(e => e)
    expect(empty.status).toBe(400)
    expect(long.status).toBe(400)
  })
})

describe('one active spot at a time', () => {
  it('the first spot becomes active and sets the profile', async () => {
    const d = db([])
    const { spot: created, location } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'First', lat: 40.9, lon: -110.6 }, NOW)
    expect(created.is_active).toBe(true)
    expect(location?.lat).toBe(40.9)
    expect(d.rpcCalls[0].fn).toBe('activate_objective_spot')
  })

  it('switching leaves exactly one active spot', async () => {
    const d = db([spot('a', { is_active: true }), spot('b')])
    await activateSpot(asClient(d), OBJ, 'b', NOW)
    const active = d.tables.objective_spots.filter(s => s.is_active)
    expect(active.map(s => s.id)).toEqual(['b'])
  })

  it('overlapping activates still end with one active spot', async () => {
    const d = db([spot('a', { is_active: true }), spot('b'), spot('c')])
    await Promise.all([activateSpot(asClient(d), OBJ, 'b', NOW), activateSpot(asClient(d), OBJ, 'c', NOW)])
    expect(d.tables.objective_spots.filter(s => s.is_active)).toHaveLength(1)
  })
})

describe('activate: snapshot versus re-resolve', () => {
  it('a fresh snapshot is copied to the profile with no external calls', async () => {
    const d = db([spot('a', { is_active: true }), spot('b', { lat: 40.95, lon: -110.65, geo_snapshot: geo({ county: 'Wasatch' }) })])
    await activateSpot(asClient(d), OBJ, 'b', NOW)
    expect(resolveMock).not.toHaveBeenCalled()
    expect(d.tables.objective_profiles[0].county).toBe('Wasatch')
    expect(d.tables.objective_profiles[0].lat).toBe(40.95)
  })

  it('a stale snapshot is re-resolved and the new snapshot is stored', async () => {
    resolveMock.mockResolvedValue(geo({ county: 'Fresh' }))
    const d = db([spot('a', { is_active: true }), spot('b', { geo_resolved_at: new Date(NOW.getTime() - 40 * DAY).toISOString() })])
    await activateSpot(asClient(d), OBJ, 'b', NOW)
    expect(resolveMock).toHaveBeenCalledTimes(1)
    expect(d.tables.objective_profiles[0].county).toBe('Fresh')
    const b = d.tables.objective_spots.find(s => s.id === 'b')
    expect(b?.geo_resolved_at).toBe(NOW.toISOString())
  })

  it('a re-resolve with no NWS grid throws 422 and the active spot does not change', async () => {
    resolveMock.mockResolvedValue(geo({ nws_grid_office: null }))
    const d = db([spot('a', { is_active: true }), spot('b', { geo_snapshot: null, geo_resolved_at: null })])
    const err = await activateSpot(asClient(d), OBJ, 'b', NOW).catch(e => e)
    expect(err.status).toBe(422)
    expect(d.tables.objective_spots.find(s => s.id === 'a')?.is_active).toBe(true)
    expect(d.rpcCalls).toHaveLength(0)
  })
})

describe('hunt unit is not overwritten by a switch', () => {
  it('switching to a spot whose resolver reports another unit keeps the declared unit', async () => {
    const d = db([spot('a', { is_active: true }), spot('b', { geo_snapshot: geo({ hunt_unit_id: 'other-unit' }) })])
    await activateSpot(asClient(d), OBJ, 'b', NOW)
    expect(d.tables.objective_profiles[0].hunt_unit_id).toBe('declared-unit')
  })
})

describe('edit and delete', () => {
  it('moving the active spot re-resolves and rewrites the profile', async () => {
    resolveMock.mockResolvedValue(geo({ county: 'Moved' }))
    const d = db([spot('a', { is_active: true })])
    const { location } = await updateSpot(asClient(d), OBJ, 'a', { lat: 40.7, lon: -110.9 }, {}, NOW)
    expect(resolveMock).toHaveBeenCalledWith(40.7, -110.9)
    expect(location?.lat).toBe(40.7)
  })

  it('moving an inactive spot only clears its snapshot', async () => {
    const d = db([spot('a', { is_active: true }), spot('b')])
    await updateSpot(asClient(d), OBJ, 'b', { lat: 40.7 }, {}, NOW)
    expect(resolveMock).not.toHaveBeenCalled()
    expect(d.tables.objective_spots.find(s => s.id === 'b')?.geo_snapshot).toBeNull()
  })

  it('the active spot cannot be deleted while another spot exists (409)', async () => {
    const d = db([spot('a', { is_active: true }), spot('b')])
    const err = await deleteSpot(asClient(d), OBJ, 'a').catch(e => e)
    expect(err.status).toBe(409)
    expect(err.body).toEqual({ code: 'active_spot' })
    expect(d.tables.objective_spots).toHaveLength(2)
  })

  it('deleting the only spot returns the objective to location not set, keeping state and declared unit', async () => {
    const d = db([spot('a', { is_active: true })])
    await deleteSpot(asClient(d), OBJ, 'a')
    const profile = d.tables.objective_profiles[0]
    expect(profile.lat).toBeNull()
    expect(profile.lon).toBeNull()
    expect(profile.nws_grid_office).toBeNull()
    expect(profile.state).toBe('UT')
    expect(profile.hunt_unit_id).toBe('declared-unit')
  })

  it('an inactive spot can be deleted freely', async () => {
    const d = db([spot('a', { is_active: true }), spot('b')])
    await deleteSpot(asClient(d), OBJ, 'b')
    expect(d.tables.objective_spots.map(s => s.id)).toEqual(['a'])
  })
})

describe('location route behaviour', () => {
  it('creates the Primary spot when an objective has none', async () => {
    const d = db([])
    const location = await setActiveLocation(asClient(d), { objectiveId: OBJ, userId: USER, lat: 40.9, lon: -110.6 }, NOW)
    expect(d.tables.objective_spots[0].name).toBe('Primary spot')
    expect(d.tables.objective_spots[0].is_active).toBe(true)
    expect(location?.lat).toBe(40.9)
  })

  it('edits the active spot and always re-resolves', async () => {
    const d = db([spot('a', { is_active: true })])
    await setActiveLocation(asClient(d), { objectiveId: OBJ, userId: USER, lat: 40.5, lon: -111 }, NOW)
    expect(resolveMock).toHaveBeenCalledTimes(1)
    expect(d.tables.objective_spots).toHaveLength(1)
  })
})

describe('privacy: coordinates stay out of error messages', () => {
  it('a 422 message carries no coordinates', async () => {
    resolveMock.mockResolvedValue(geo({ nws_grid_office: null }))
    const d = db()
    const err = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'x', lat: 12.345678, lon: -98.765432 }, NOW)
      .catch(e => e)
    expect(err.status).toBe(422)
    expect(err.message).not.toMatch(/12\.34|98\.76/)
  })
})

describe('boundary flag on spot writes', () => {
  const SQUARE = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-111.2, 40.3], [-110.8, 40.3], [-110.8, 40.7], [-111.2, 40.7], [-111.2, 40.3]]] } }],
  }

  it('a new spot outside the hunt boundary is stored with inside_boundary false', async () => {
    const d = new FakeDb({
      objective_spots: [],
      objective_profiles: [{ objective_id: OBJ, hunt_unit_id: 'chalk-creek', hunt_code: 'EA2004', state: 'UT', lat: 40.5, lon: -111 }],
      udwr_hunt_cache: [{ hunt_code: 'EA2004', boundary_geojson: SQUARE, fetched_at: NOW.toISOString() }],
    })
    const { spot: created } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Far', lat: 41.9, lon: -111 }, NOW)
    expect(created.inside_boundary).toBe(false)
    expect(d.tables.objective_spots[0].inside_boundary).toBe(false)
  })

  it('no hunt number: inside_boundary is null (unknown), never false', async () => {
    const d = db([])
    const { spot: created } = await createSpot(asClient(d), { objectiveId: OBJ, userId: USER, name: 'Any', lat: 41.9, lon: -111 }, NOW)
    expect(created.inside_boundary).toBeNull()
  })
})

