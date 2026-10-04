import { describe, it, expect, vi } from 'vitest'
import { lookupHuntNumberCached } from './udwrCache'
import { FakeDb } from '@/lib/spots/testDb'

const NOW = new Date('2026-10-04T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const BOUNDARY = { type: 'FeatureCollection', features: [] }

const TABLE_HIT = {
  features: [{ attributes: { HUNT_NUMBER: 'EA2004', BOUNDARYID: '69', SEASON: 'Aug 1, 2026 - Jan 31, 2027' } }],
}

function upstream() {
  return vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/1/query') ? TABLE_HIT : BOUNDARY), { status: 200 }))
}

const asClient = (db: FakeDb) => db as unknown as Parameters<typeof lookupHuntNumberCached>[0]

describe('lookupHuntNumberCached', () => {
  it('cache miss: calls UDWR once and stores the result', async () => {
    const db = new FakeDb({ udwr_hunt_cache: [] })
    const fetchFn = upstream()
    const out = await lookupHuntNumberCached(asClient(db), 'EA2004', { env: {}, fetchFn: fetchFn as unknown as typeof fetch, now: NOW })
    expect(out.status).toBe('found')
    expect(out.status === 'found' && out.cached).toBe(false)
    expect(db.tables.udwr_hunt_cache).toHaveLength(1)
    expect(db.tables.udwr_hunt_cache[0].season_text).toBe('Aug 1, 2026 - Jan 31, 2027')
  })

  it('cache hit: a fresh row is served with no network call', async () => {
    const db = new FakeDb({
      udwr_hunt_cache: [{
        hunt_code: 'EA2004', boundary_id: '69', season_text: 'cached text',
        boundary_geojson: BOUNDARY, fetched_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      }],
    })
    const fetchFn = upstream()
    const out = await lookupHuntNumberCached(asClient(db), 'EA2004', { env: {}, fetchFn: fetchFn as unknown as typeof fetch, now: NOW })
    expect(out.status === 'found' && out.cached).toBe(true)
    expect(out.status === 'found' && out.record.season_text).toBe('cached text')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('expired row: fetches again and refreshes the row', async () => {
    const db = new FakeDb({
      udwr_hunt_cache: [{
        hunt_code: 'EA2004', boundary_id: '69', season_text: 'old text',
        boundary_geojson: BOUNDARY, fetched_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
      }],
    })
    const fetchFn = upstream()
    const out = await lookupHuntNumberCached(asClient(db), 'EA2004', { env: {}, fetchFn: fetchFn as unknown as typeof fetch, now: NOW })
    expect(fetchFn).toHaveBeenCalled()
    expect(out.status === 'found' && out.record.season_text).toBe('Aug 1, 2026 - Jan 31, 2027')
    expect(db.tables.udwr_hunt_cache[0].season_text).toBe('Aug 1, 2026 - Jan 31, 2027')
  })

  it('flag off: manual entry only, no network and no cache read', async () => {
    const db = new FakeDb({ udwr_hunt_cache: [] })
    const fetchFn = upstream()
    const out = await lookupHuntNumberCached(asClient(db), 'EA2004', { env: { UDWR_LOOKUP_ENABLED: 'false' }, fetchFn: fetchFn as unknown as typeof fetch, now: NOW })
    expect(out).toEqual({ status: 'disabled' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(db.tables.udwr_hunt_cache).toHaveLength(0)
  })

  it('a failed lookup is reported as error and nothing is cached', async () => {
    const db = new FakeDb({ udwr_hunt_cache: [] })
    const fetchFn = vi.fn(async () => { throw new TypeError('down') })
    const out = await lookupHuntNumberCached(asClient(db), 'EA2004', { env: {}, fetchFn: fetchFn as unknown as typeof fetch, now: NOW })
    expect(out).toEqual({ status: 'error' })
    expect(db.tables.udwr_hunt_cache).toHaveLength(0)
  })

  it('a not-found number is not cached, so a typo is never stored', async () => {
    const db = new FakeDb({ udwr_hunt_cache: [] })
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 }))
    const out = await lookupHuntNumberCached(asClient(db), 'ZZ9999', { env: {}, fetchFn: fetchFn as unknown as typeof fetch, now: NOW })
    expect(out).toEqual({ status: 'not_found' })
    expect(db.tables.udwr_hunt_cache).toHaveLength(0)
  })
})
