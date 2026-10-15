// FF-105B Fix 1: a pin typed on /strike/new becomes the objective's first spot.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { FakeDb } from '@/lib/spots/testDb'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import { PRIMARY_SPOT_NAME } from '@/lib/spots/spotService'
import { POST } from './route'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/swarm/objectiveRouter', () => ({ resolveAgentBundle: vi.fn(async () => ({ agents: [], buildStatus: 'ready' })) }))
vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))

const GEO: FullGeography = {
  nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ003', state: 'UT', county: 'Daggett',
  usgs_gauge_ids: [], snotel_station_ids: [], elevation_ft_avg: 4900, hunt_unit_id: null,
}

const BODY = {
  domain: 'fishing',
  taxonomy_key: 'trout.rainbow.fly_fishing',
  geo: { state: 'UT', lat: 40.91, lon: -109.4 },
  priority_stack: [],
  timing: { trip_end: `${new Date().getUTCFullYear()}-11-15` },
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/objectives/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  sessionUser = { id: 'u1', email: 'owner@example.com' }
  db = new FakeDb({ allowed_emails: [{ email: 'owner@example.com' }], objectives: [], objective_profiles: [], objective_spots: [] })
  vi.mocked(resolveFullGeography).mockResolvedValue(GEO)
  vi.mocked(waitUntil).mockClear()
})

describe('create: primary spot from the /strike/new pin', () => {
  it('creates an active spot with the resolved geography when a pin is supplied', async () => {
    const res = await POST(req(BODY))
    expect(res.status).toBe(201)

    expect(db.tables.objective_spots).toHaveLength(1)
    const spot = db.tables.objective_spots[0]
    expect(spot.name).toBe(PRIMARY_SPOT_NAME)
    expect(spot.is_active).toBe(true)
    expect(spot.lat).toBe(40.91)
    expect(spot.lon).toBe(-109.4)
    expect(spot.geo_snapshot).toMatchObject({ nws_grid_office: 'SLC', county: 'Daggett' })

    const profile = db.tables.objective_profiles[0]
    expect(profile.nws_grid_office).toBe('SLC')
    expect(profile.county).toBe('Daggett')
  })

  it('does not call the plain geography waitUntil fallback once the spot has written the profile', async () => {
    await POST(req(BODY))
    expect(waitUntil).toHaveBeenCalledTimes(1) // only the first-collection-run waitUntil (Fix 2), not the geography one
  })

  it('creates nothing when no lat/lon was supplied', async () => {
    const res = await POST(req({ ...BODY, geo: { state: 'UT' } }))
    expect(res.status).toBe(201)
    expect(db.tables.objective_spots).toHaveLength(0)
  })

  it('still returns success for the objective when spot creation throws', async () => {
    vi.mocked(resolveFullGeography).mockResolvedValue(null) // no NWS grid -> createSpot throws
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(req(BODY))
    expect(res.status).toBe(201)
    expect(db.tables.objective_spots).toHaveLength(0)
    expect(db.tables.objectives).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalledWith('[objectives/create] primary spot failed', expect.any(String))

    // No pin coordinates leaked into the log.
    const logged = errorSpy.mock.calls.map(c => c.join(' ')).join(' ')
    expect(logged).not.toContain('40.91')
    expect(logged).not.toContain('-109.4')
    errorSpy.mockRestore()
  })

  it('never creates a spot for a partner-created objective, even with a pin', async () => {
    db.tables.partners = [{ id: 'p1', slug: 'basemaps', status: 'active', owner_user_id: 'svc-bm', rate_limit_per_min: 60 }]
    const { hashPartnerKey } = await import('@/lib/auth/partnerAuth')
    db.tables.partner_api_keys = [{ id: 'k1', partner_id: 'p1', key_hash: hashPartnerKey('partner-key-basemaps-0123456789abcdef'), revoked_at: null }]

    const res = await POST(new NextRequest('http://localhost/api/objectives/create', {
      method: 'POST',
      body: JSON.stringify(BODY),
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer partner-key-basemaps-0123456789abcdef' },
    }))
    expect(res.status).toBe(201)
    expect(db.tables.objective_spots).toHaveLength(0)
    // The old geography waitUntil fallback still runs for partner objectives.
    expect(waitUntil).toHaveBeenCalled()
  })
})
