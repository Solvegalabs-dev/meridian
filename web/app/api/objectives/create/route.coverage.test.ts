// FF-096 Part 3: COVERAGE_MODE 'block' refuses an uncovered Strike objective on the server too. Partner keys are exempt.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { hashPartnerKey } from '@/lib/auth/partnerAuth'
import { resetRateLimitsForTests } from '@/lib/auth/rateLimit'
import { POST } from './route'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/strike/coverage', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/strike/coverage')>()), COVERAGE_MODE: 'block' }))
vi.mock('@/lib/swarm/objectiveRouter', () => ({ resolveAgentBundle: vi.fn(async () => ({ agents: [], buildStatus: 'ready' })) }))
vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn(async () => null) }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))

const KEY = 'partner-key-basemaps-0123456789abcdef'
const body = (taxonomy_key: string, state: string) => ({
  domain: taxonomy_key.split('.')[0], taxonomy_key, geo: { state }, priority_stack: [], timing: { trip_end: '2099-11-15' },
})
const req = (b: unknown, auth?: string) => new NextRequest('http://localhost/api/objectives/create', {
  method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json', ...(auth ? { authorization: auth } : {}) },
})

beforeEach(() => {
  sessionUser = { id: 'u1', email: 'owner@example.com' }
  resetRateLimitsForTests()
  db = new FakeDb({
    allowed_emails: [{ email: 'owner@example.com' }],
    hunt_seasons: [{ state: 'UT', species: 'elk', season_year: new Date().getUTCFullYear() }],
    partners: [{ id: 'p1', slug: 'basemaps', status: 'active', owner_user_id: 'svc', rate_limit_per_min: 60 }],
    partner_api_keys: [{ id: 'k1', partner_id: 'p1', key_hash: hashPartnerKey(KEY), revoked_at: null }],
    objectives: [], objective_profiles: [],
  })
})

describe("create with COVERAGE_MODE 'block'", () => {
  it('refuses KS turkey for a session user with 422 and writes nothing', async () => {
    const res = await POST(req(body('turkey.eastern.archery', 'KS')))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('not_covered')
    expect(json.error).toContain("We don't have turkey data for Kansas yet")
    expect(db.tables.objective_profiles).toHaveLength(0)
  })

  it('allows UT elk', async () => {
    expect((await POST(req(body('elk.bull.archery', 'UT')))).status).toBe(201)
  })

  it('does not apply to a partner key', async () => {
    expect((await POST(req(body('turkey.eastern.archery', 'KS'), `Bearer ${KEY}`))).status).toBe(201)
  })

  it('stores a typed state name as its code, so the season matcher finds it', async () => {
    await POST(req(body('elk.bull.archery', 'Utah')))
    expect(db.tables.objective_profiles[0].state).toBe('UT')
  })
})
