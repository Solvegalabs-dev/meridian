// FF-096b: the geography written after create must only name real profile columns. The resolver now also
// returns the nearest gauge's name and distance, which has no column and lives in the spot snapshot only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { FakeDb } from '@/lib/spots/testDb'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import { POST } from './route'

let db: FakeDb

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'owner@example.com' } } }) } }),
}))
vi.mock('@/lib/swarm/objectiveRouter', () => ({ resolveAgentBundle: vi.fn(async () => ({ agents: [], buildStatus: 'ready' })) }))
vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))

const GEO: FullGeography = {
  nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ003', state: 'UT', county: 'Daggett',
  usgs_gauge_ids: ['09261000'], snotel_station_ids: [], elevation_ft_avg: 4900, hunt_unit_id: null,
  usgs_gauge_nearest: { site_no: '09261000', name: 'Green River Near Jensen, UT', distance_mi: 1.4 },
}

beforeEach(() => {
  db = new FakeDb({ allowed_emails: [{ email: 'owner@example.com' }], objectives: [], objective_profiles: [] })
  vi.mocked(resolveFullGeography).mockResolvedValue(GEO)
  vi.mocked(waitUntil).mockClear()
})

describe('create: geography written after the objective exists', () => {
  it('writes the real columns and leaves out the snapshot-only nearest gauge', async () => {
    const year = new Date().getUTCFullYear()
    const res = await POST(new NextRequest('http://localhost/api/objectives/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'fishing',
        taxonomy_key: 'trout.rainbow.fly_fishing',
        geo: { state: 'UT', lat: 40.91, lon: -109.4 },
        priority_stack: [],
        timing: { trip_end: `${year}-11-15` },
      }),
    }))
    expect(res.status).toBe(201)

    // The geography update runs after the response, inside waitUntil. Wait for it.
    const pending = vi.mocked(waitUntil).mock.calls[0]?.[0] as Promise<unknown>
    await pending

    const row = db.tables.objective_profiles[0]
    expect(row).toMatchObject({ nws_grid_office: 'SLC', usgs_gauge_ids: ['09261000'], county: 'Daggett' })
    expect('usgs_gauge_nearest' in row).toBe(false)
  })
})
