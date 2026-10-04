import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import {
  NO_GRID_MESSAGE,
  SpotError,
  isSnapshotFresh,
  profileGeoColumns,
  resolveSpotGeo,
  writeSpotToProfile,
} from './applySpot'
import { FakeDb } from './testDb'

vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn() }))
const resolveMock = vi.mocked(resolveFullGeography)

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-04T12:00:00Z')

function geo(over: Partial<FullGeography> = {}): FullGeography {
  return {
    nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ001',
    state: 'UT', county: 'Summit', usgs_gauge_ids: ['10128500'], snotel_station_ids: ['1000'],
    elevation_ft_avg: 8200, hunt_unit_id: 'resolver-unit', ...over,
  }
}

beforeEach(() => {
  resolveMock.mockReset()
})

describe('isSnapshotFresh', () => {
  it('is fresh under 30 days with a grid', () => {
    expect(isSnapshotFresh(geo(), new Date(NOW.getTime() - 29 * DAY).toISOString(), NOW)).toBe(true)
  })

  it('is stale at 30 days or more, or when the age is unknown', () => {
    expect(isSnapshotFresh(geo(), new Date(NOW.getTime() - 31 * DAY).toISOString(), NOW)).toBe(false)
    expect(isSnapshotFresh(geo(), null, NOW)).toBe(false)
  })

  it('needs an NWS grid', () => {
    expect(isSnapshotFresh(geo({ nws_grid_office: null }), new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe(false)
  })
})

describe('profileGeoColumns: the declared hunt unit is never overwritten', () => {
  it('leaves the profile hunt unit alone when it already has one', () => {
    const cols = profileGeoColumns(geo({ hunt_unit_id: 'resolver-unit' }), 'declared-unit')
    expect(cols).not.toHaveProperty('hunt_unit_id')
    expect(cols.nws_grid_office).toBe('SLC')
  })

  it('takes the resolver unit only when the profile has none', () => {
    expect(profileGeoColumns(geo({ hunt_unit_id: 'resolver-unit' }), null).hunt_unit_id).toBe('resolver-unit')
    expect(profileGeoColumns(geo({ hunt_unit_id: undefined }), null).hunt_unit_id).toBeNull()
  })
})

describe('resolveSpotGeo', () => {
  it('a fresh snapshot is copied with no external calls', async () => {
    const snapshot = geo()
    const out = await resolveSpotGeo(40.5, -111, {
      geo_snapshot: snapshot,
      geo_resolved_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    }, NOW)
    expect(out.reused).toBe(true)
    expect(out.geo).toEqual(snapshot)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('a stale or missing snapshot is re-resolved', async () => {
    resolveMock.mockResolvedValue(geo())
    const out = await resolveSpotGeo(40.5, -111, { geo_snapshot: geo(), geo_resolved_at: null }, NOW)
    expect(out.reused).toBe(false)
    expect(resolveMock).toHaveBeenCalledWith(40.5, -111)
  })

  it('a point with no NWS grid is a 422 and nothing is returned', async () => {
    resolveMock.mockResolvedValue(geo({ nws_grid_office: null }))
    const err = await resolveSpotGeo(0, 0, {}, NOW).catch(e => e)
    expect(err).toBeInstanceOf(SpotError)
    expect(err.status).toBe(422)
    expect(err.message).toBe(NO_GRID_MESSAGE)
  })
})

describe('writeSpotToProfile regression', () => {
  it('a location save keeps the declared hunt unit (EA2004 case)', async () => {
    const db = new FakeDb({
      objective_profiles: [{ objective_id: 'obj-1', hunt_unit_id: 'chalk-creek', lat: 40, lon: -111 }],
    })
    const location = await writeSpotToProfile(db as never, 'obj-1', {
      lat: 40.9, lon: -110.6, geo: geo({ hunt_unit_id: 'some-other-unit' }),
    })
    expect(location?.hunt_unit_id).toBe('chalk-creek')
    expect(location?.lat).toBe(40.9)
    expect(db.tables.objective_profiles[0].hunt_unit_id).toBe('chalk-creek')
  })

  it('returns null when the objective has no profile', async () => {
    const db = new FakeDb({ objective_profiles: [] })
    expect(await writeSpotToProfile(db as never, 'obj-x', { lat: 1, lon: 1, geo: geo() })).toBeNull()
  })
})
