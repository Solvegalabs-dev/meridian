import { describe, it, expect } from 'vitest'
import { boundaryFlagForObjective, recomputeSpotBoundaryFlags } from './boundary'
import { FakeDb } from '@/lib/spots/testDb'

const SQUARE = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-111.2, 40.3], [-110.8, 40.3], [-110.8, 40.7], [-111.2, 40.7], [-111.2, 40.3]]] } }],
}
const asClient = (db: FakeDb) => db as unknown as Parameters<typeof boundaryFlagForObjective>[0]

function db(profileCode: string | null, spots: Array<Record<string, unknown>>) {
  return new FakeDb({
    objective_profiles: [{ objective_id: 'obj-1', hunt_code: profileCode }],
    udwr_hunt_cache: profileCode ? [{ hunt_code: profileCode, boundary_geojson: SQUARE, fetched_at: '2026-10-01T00:00:00Z' }] : [],
    objective_spots: spots,
  })
}

describe('boundaryFlagForObjective', () => {
  it('inside the cached boundary: true', async () => {
    expect(await boundaryFlagForObjective(asClient(db('EA2004', [])), 'obj-1', 40.5, -111.0)).toBe(true)
  })

  it('outside the cached boundary: false', async () => {
    expect(await boundaryFlagForObjective(asClient(db('EA2004', [])), 'obj-1', 41.9, -111.0)).toBe(false)
  })

  it('no hunt number: null (unknown, not outside)', async () => {
    expect(await boundaryFlagForObjective(asClient(db(null, [])), 'obj-1', 41.9, -111.0)).toBeNull()
  })

  it('a hunt number with no cached boundary: null, and no lookup is made', async () => {
    const d = new FakeDb({ objective_profiles: [{ objective_id: 'obj-1', hunt_code: 'EA2004' }], udwr_hunt_cache: [] })
    expect(await boundaryFlagForObjective(asClient(d), 'obj-1', 41.9, -111.0)).toBeNull()
  })
})

describe('recomputeSpotBoundaryFlags', () => {
  it('sets inside_boundary on every spot of the objective', async () => {
    const d = db('EA2004', [
      { id: 's1', objective_id: 'obj-1', lat: 40.5, lon: -111.0, inside_boundary: null },
      { id: 's2', objective_id: 'obj-1', lat: 41.9, lon: -111.0, inside_boundary: null },
      { id: 's3', objective_id: 'other', lat: 41.9, lon: -111.0, inside_boundary: null },
    ])
    await recomputeSpotBoundaryFlags(asClient(d), 'obj-1')
    const flags = Object.fromEntries(d.tables.objective_spots.map(s => [s.id, s.inside_boundary]))
    expect(flags).toEqual({ s1: true, s2: false, s3: null })
  })

  it('clearing the hunt number sets every flag to null', async () => {
    const d = db(null, [{ id: 's1', objective_id: 'obj-1', lat: 40.5, lon: -111.0, inside_boundary: true }])
    await recomputeSpotBoundaryFlags(asClient(d), 'obj-1')
    expect(d.tables.objective_spots[0].inside_boundary).toBeNull()
  })
})
