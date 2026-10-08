// FF-097: empty or zero coordinates are refused with the coordinate message before any weather or NWS lookup.
// Before, an empty box became 0 and reached the NWS step, which failed with a misleading message.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { COORDINATE_MESSAGE } from '@/lib/spots/coordinates'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import { POST as createSpotRoute } from './route'
import { PATCH as patchSpotRoute } from './[spotId]/route'
import { PATCH as locationRoute } from '../location/route'

let db: FakeDb

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => db.from(table),
  }),
}))
vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn() }))
const resolveMock = vi.mocked(resolveFullGeography)

const GEO: FullGeography = {
  nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ003', state: 'UT', county: 'Daggett',
  usgs_gauge_ids: [], snotel_station_ids: [], elevation_ft_avg: 5600, hunt_unit_id: null,
}

const OBJ = 'obj-1'
const params = { id: OBJ }

const post = (body: unknown) => createSpotRoute(
  new NextRequest(`http://localhost/api/objectives/${OBJ}/spots`, { method: 'POST', body: JSON.stringify(body) }), { params })
const patchSpot = (body: unknown) => patchSpotRoute(
  new NextRequest(`http://localhost/api/objectives/${OBJ}/spots/s1`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: OBJ, spotId: 's1' } })
const patchLocation = (body: unknown) => locationRoute(
  new NextRequest(`http://localhost/api/objectives/${OBJ}/location`, { method: 'PATCH', body: JSON.stringify(body) }), { params })

beforeEach(() => {
  resolveMock.mockReset()
  resolveMock.mockResolvedValue(GEO)
  db = new FakeDb({
    objectives: [{ id: OBJ, user_id: 'u1' }],
    objective_profiles: [{ objective_id: OBJ, state: 'UT', hunt_unit_id: null }],
    objective_spots: [{
      id: 's1', objective_id: OBJ, user_id: 'u1', name: 'Upper', lat: 40.5, lon: -111, is_active: true, sort_order: 0,
      geo_snapshot: GEO, geo_resolved_at: new Date().toISOString(), hunt_unit_id: null, inside_boundary: null, activated_at: null, created_at: '2026-10-01',
    }],
  })
})

const EMPTY_PAIRS: Array<[unknown, unknown]> = [
  ['', ''], [' ', ' '], ['', '-111.02'], ['40.12', ''], ['0', '0'], [0, 0], [null, null], ['abc', '-111'],
]

describe('POST /spots', () => {
  for (const [lat, lon] of EMPTY_PAIRS) {
    it(`refuses lat ${JSON.stringify(lat)} / lon ${JSON.stringify(lon)} with the coordinate message and no lookup`, async () => {
      const res = await post({ name: 'New', lat, lon })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(COORDINATE_MESSAGE)
      expect(resolveMock).not.toHaveBeenCalled()
      expect(db.tables.objective_spots).toHaveLength(1)
    })
  }

  it('refuses a body with no coordinates at all', async () => {
    const res = await post({ name: 'New' })
    expect(res.status).toBe(400)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('accepts coordinates sent as typed strings and saves them as numbers', async () => {
    const res = await post({ name: 'New', lat: '40.127361', lon: '-111.020472' })
    expect(res.status).toBe(201)
    expect(resolveMock).toHaveBeenCalledWith(40.127361, -111.020472)
    expect(db.tables.objective_spots[1].lat).toBe(40.127361)
  })
})

describe('PATCH /spots/[spotId]', () => {
  // null or a missing key means "leave the coordinates as they are" here, so it never reaches the lookup empty.
  for (const [lat, lon] of EMPTY_PAIRS.filter(([la]) => la !== null)) {
    it(`refuses lat ${JSON.stringify(lat)} / lon ${JSON.stringify(lon)} and leaves the spot alone`, async () => {
      const res = await patchSpot({ name: 'Upper', lat, lon })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(COORDINATE_MESSAGE)
      expect(resolveMock).not.toHaveBeenCalled()
      expect(db.tables.objective_spots[0]).toMatchObject({ lat: 40.5, lon: -111 })
    })
  }

  it('null coordinates leave the spot where it is, with no lookup', async () => {
    const res = await patchSpot({ name: 'Upper', lat: null, lon: null })
    expect(res.status).toBe(200)
    expect(resolveMock).not.toHaveBeenCalled()
    expect(db.tables.objective_spots[0]).toMatchObject({ lat: 40.5, lon: -111 })
  })

  it('a rename that sends no coordinates still works', async () => {
    const res = await patchSpot({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(db.tables.objective_spots[0].name).toBe('Renamed')
  })

  it('moving the spot with typed strings re-resolves at the new point', async () => {
    const res = await patchSpot({ name: 'Upper', lat: '40.7', lon: '-111.2' })
    expect(res.status).toBe(200)
    expect(resolveMock).toHaveBeenCalledWith(40.7, -111.2)
  })
})

describe('PATCH /location', () => {
  for (const [lat, lon] of EMPTY_PAIRS) {
    it(`refuses lat ${JSON.stringify(lat)} / lon ${JSON.stringify(lon)} before reaching the weather step`, async () => {
      const res = await patchLocation({ lat, lon })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(COORDINATE_MESSAGE)
      expect(resolveMock).not.toHaveBeenCalled()
    })
  }

  it('accepts real coordinates', async () => {
    const res = await patchLocation({ lat: 40.7, lon: -111.2 })
    expect(res.status).toBe(200)
    expect(resolveMock).toHaveBeenCalledTimes(1)
  })
})
