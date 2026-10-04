import { describe, it, expect, vi } from 'vitest'
import { fetchHuntFromUdwr } from './udwrLookup'

const TABLE_HIT = {
  features: [{ attributes: { HUNT_NUMBER: 'EA2004', BOUNDARYID: '69', SEASON: 'August 01, 2026 - Jan 31, 2027', BOUNDARY_NAME: 'Chalk Creek' } }],
}
const BOUNDARY = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { BoundaryID: 69 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Routes the two ArcGIS calls: table 1 (HUNT_NUMBER) and layer 0 (BoundaryID).
function udwr(table: unknown, layer: unknown) {
  return vi.fn(async (url: string) => (url.includes('/1/query') ? json(table) : json(layer)))
}

describe('fetchHuntFromUdwr', () => {
  it('found: returns the season text verbatim and the boundary', async () => {
    const fetchFn = udwr(TABLE_HIT, BOUNDARY)
    const out = await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)
    expect(out.status).toBe('found')
    if (out.status !== 'found') throw new Error()
    expect(out.record.season_text).toBe('August 01, 2026 - Jan 31, 2027')
    expect(out.record.boundary_id).toBe('69')
    expect(out.record.boundary_geojson).toEqual(BOUNDARY)
  })

  it('queries by the hunt number and the boundary id, in WGS84 GeoJSON', async () => {
    const fetchFn = udwr(TABLE_HIT, BOUNDARY)
    await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)
    const urls = fetchFn.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.includes('where=HUNT_NUMBER%3D%27EA2004%27'))).toBe(true)
    expect(urls.some(u => u.includes('where=BoundaryID%3D69') && u.includes('outSR=4326') && u.includes('f=geojson'))).toBe(true)
  })

  it('not found: an empty table is not an error', async () => {
    const fetchFn = udwr({ features: [] }, BOUNDARY)
    const out = await fetchHuntFromUdwr('ZZ9999', fetchFn as unknown as typeof fetch)
    expect(out).toEqual({ status: 'not_found' })
  })

  it('found without a boundary: boundary_geojson is null', async () => {
    const fetchFn = udwr(TABLE_HIT, { features: [] })
    const out = await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)
    if (out.status !== 'found') throw new Error('expected found')
    expect(out.record.boundary_geojson).toBeNull()
  })

  it('retries once after a failure, then succeeds', async () => {
    let calls = 0
    const fetchFn = vi.fn(async (url: string) => {
      calls++
      if (calls === 1) throw new TypeError('socket reset')
      return url.includes('/1/query') ? json(TABLE_HIT) : json(BOUNDARY)
    })
    const out = await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)
    expect(out.status).toBe('found')
    expect(calls).toBe(3) // one failed table call, then table + boundary
  })

  it('timeout on both attempts: error, never throws', async () => {
    const fetchFn = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })
    const out = await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)
    expect(out).toEqual({ status: 'error' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('an HTTP 500 is an error after the retry', async () => {
    const fetchFn = vi.fn(async () => json({}, 500))
    expect(await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)).toEqual({ status: 'error' })
  })

  it('an ArcGIS error object inside a 200 is an error, not a not-found', async () => {
    const fetchFn = vi.fn(async () => json({ error: { code: 400, message: 'Invalid query' } }))
    expect(await fetchHuntFromUdwr('EA2004', fetchFn as unknown as typeof fetch)).toEqual({ status: 'error' })
  })
})
