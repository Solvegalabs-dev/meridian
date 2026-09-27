import { describe, it, expect, vi, beforeEach } from 'vitest'

const rows: { unit_id: string; hunt_type: string; boundary_geojson: unknown }[] = []
let queryError: unknown = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          not: async () => ({ data: queryError ? null : rows, error: queryError }),
        }),
      }),
    }),
  }),
}))

import { findHuntUnit } from './unitResolver'

const square = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

describe('findHuntUnit', () => {
  beforeEach(() => {
    rows.length = 0
    queryError = null
  })

  it('matches a point inside a Polygon', async () => {
    rows.push({ unit_id: 'a', hunt_type: 'general_bull', boundary_geojson: { type: 'Polygon', coordinates: [square(-111, 40, -110, 41)] } })
    expect(await findHuntUnit(40.5, -110.5, 'UT')).toBe('a')
    expect(await findHuntUnit(41.5, -110.5, 'UT')).toBeNull()
  })

  it('excludes points inside a polygon hole', async () => {
    rows.push({ unit_id: 'a', hunt_type: 'general_bull', boundary_geojson: { type: 'Polygon', coordinates: [square(-111, 40, -110, 41), square(-110.6, 40.4, -110.4, 40.6)] } })
    expect(await findHuntUnit(40.5, -110.5, 'UT')).toBeNull()
    expect(await findHuntUnit(40.9, -110.9, 'UT')).toBe('a')
  })

  it('matches any part of a MultiPolygon', async () => {
    rows.push({ unit_id: 'm', hunt_type: 'limited_entry', boundary_geojson: { type: 'MultiPolygon', coordinates: [[square(-113, 38, -112, 39)], [square(-111, 40, -110, 41)]] } })
    expect(await findHuntUnit(40.5, -110.5, 'UT')).toBe('m')
    expect(await findHuntUnit(38.5, -112.5, 'UT')).toBe('m')
    expect(await findHuntUnit(39.5, -111.5, 'UT')).toBeNull()
  })

  it('prefers general_bull when units overlap', async () => {
    rows.push({ unit_id: 'le', hunt_type: 'limited_entry', boundary_geojson: { type: 'Polygon', coordinates: [square(-111, 40, -110, 41)] } })
    rows.push({ unit_id: 'gb', hunt_type: 'general_bull', boundary_geojson: { type: 'Polygon', coordinates: [square(-111, 40, -110, 41)] } })
    expect(await findHuntUnit(40.5, -110.5, 'UT')).toBe('gb')
  })

  it('returns null on query error or malformed geometry', async () => {
    queryError = { message: 'boom' }
    expect(await findHuntUnit(40.5, -110.5, 'UT')).toBeNull()
    queryError = null
    rows.push({ unit_id: 'bad', hunt_type: 'general_bull', boundary_geojson: { type: 'Polygon', coordinates: 'nope' } })
    expect(await findHuntUnit(40.5, -110.5, 'UT')).toBeNull()
  })
})
