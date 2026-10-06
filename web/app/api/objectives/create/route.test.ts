import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { hashPartnerKey } from '@/lib/auth/partnerAuth'
import { resetRateLimitsForTests } from '@/lib/auth/rateLimit'
import { POST } from './route'

let db: FakeDb
let sessionUser: { id: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/swarm/objectiveRouter', () => ({
  resolveAgentBundle: vi.fn(async () => ({ agents: ['AGENT_A'], buildStatus: 'ready' })),
}))
vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn(async () => null) }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))

const PARTNER_KEY = 'partner-key-basemaps-0123456789abcdef'
const REVOKED_KEY = 'partner-key-revoked-0123456789abcdef'

const BODY = {
  domain: 'elk',
  taxonomy_key: 'elk.bull.archery',
  geo: { state: 'ut', unit: 'EA2004', lat: 40.5, lon: -111.2 },
  priority_stack: [],
  timing: { trip_end: '2026-11-15' },
}

function req(body: unknown, auth?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest('http://localhost/api/objectives/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

function seed(partnerOverrides: Record<string, unknown> = {}) {
  db = new FakeDb({
    partners: [{ id: 'partner-bm', slug: 'basemaps', status: 'active', owner_user_id: 'svc-bm', rate_limit_per_min: 60, ...partnerOverrides }],
    partner_api_keys: [
      { id: 'k1', partner_id: 'partner-bm', key_hash: hashPartnerKey(PARTNER_KEY), revoked_at: null },
      { id: 'k2', partner_id: 'partner-bm', key_hash: hashPartnerKey(REVOKED_KEY), revoked_at: '2026-10-01T00:00:00Z' },
    ],
    objectives: [],
    objective_profiles: [],
  })
}

beforeEach(() => {
  sessionUser = null
  resetRateLimitsForTests()
  seed()
})

describe('POST /api/objectives/create: no door', () => {
  it('returns 401 with no key and no session, and writes nothing', async () => {
    const res = await POST(req(BODY))
    expect(res.status).toBe(401)
    expect(db.tables.objectives).toHaveLength(0)
    expect(db.tables.objective_profiles).toHaveLength(0)
  })

  it('an Authorization header that is not a valid key is a 401, even with a session', async () => {
    sessionUser = { id: 'user-1' }
    const res = await POST(req(BODY, 'Bearer not-a-real-partner-key-000000000'))
    expect(res.status).toBe(401)
    expect(db.tables.objective_profiles).toHaveLength(0)
  })

  it('a revoked key is a 401', async () => {
    const res = await POST(req(BODY, `Bearer ${REVOKED_KEY}`))
    expect(res.status).toBe(401)
    expect(db.tables.objective_profiles).toHaveLength(0)
  })
})

describe('POST /api/objectives/create: session door (Strike)', () => {
  it('owns the objective by the session user, ignoring user_id and org_source in the body', async () => {
    sessionUser = { id: 'user-1' }
    const res = await POST(req({ ...BODY, org_source: 'basemaps', user_id: 'someone-else' }))
    expect(res.status).toBe(201)

    const profile = db.tables.objective_profiles[0]
    expect(profile.user_id).toBe('user-1')
    expect(profile.org_source).toBe('strike')
    expect(profile.partner_id).toBeNull()
  })

  it('creates a linked objectives row that the sweep and crons can select', async () => {
    sessionUser = { id: 'user-1' }
    const res = await POST(req(BODY))
    const body = await res.json()

    const profile = db.tables.objective_profiles[0]
    const obj = db.tables.objectives[0]
    expect(profile.objective_id).toBe(obj.id)
    expect(obj.user_id).toBe('user-1')
    expect(obj.status).toBe('active')
    expect(body.objective_id).toBe(profile.id)
    expect(body.arc_objective_id).toBe(obj.id)
  })
})

describe('POST /api/objectives/create: partner door', () => {
  it('takes the partner, org_source and owner from the key, not the body', async () => {
    const res = await POST(req({ ...BODY, org_source: 'strike', user_id: 'user-1', partner_user_ref: 'cust-123' }, `Bearer ${PARTNER_KEY}`))
    expect(res.status).toBe(201)

    const profile = db.tables.objective_profiles[0]
    expect(profile.org_source).toBe('basemaps')
    expect(profile.partner_id).toBe('partner-bm')
    expect(profile.partner_user_ref).toBe('cust-123')
    expect(profile.user_id).toBe('svc-bm')
    expect(db.tables.objectives[0].user_id).toBe('svc-bm')
    expect(profile.objective_id).toBe(db.tables.objectives[0].id)
  })

  it('ignores a signed-in session when a valid key is sent', async () => {
    sessionUser = { id: 'user-1' }
    await POST(req(BODY, `Bearer ${PARTNER_KEY}`))
    expect(db.tables.objective_profiles[0].user_id).toBe('svc-bm')
  })

  it('a body org_source of basemaps without a key creates a Strike objective, not a partner one', async () => {
    sessionUser = { id: 'user-1' }
    await POST(req({ ...BODY, org_source: 'basemaps' }))
    expect(db.tables.objective_profiles[0].partner_id).toBeNull()
    expect(db.tables.objective_profiles[0].org_source).toBe('strike')
  })

  it('a partner with no service owner gets a 503 and nothing is written', async () => {
    seed({ owner_user_id: null })
    const res = await POST(req(BODY, `Bearer ${PARTNER_KEY}`))
    expect(res.status).toBe(503)
    expect(db.tables.objective_profiles).toHaveLength(0)
  })

  it('rejects an over-long partner_user_ref', async () => {
    const res = await POST(req({ ...BODY, partner_user_ref: 'x'.repeat(129) }, `Bearer ${PARTNER_KEY}`))
    expect(res.status).toBe(400)
    expect(db.tables.objective_profiles).toHaveLength(0)
  })

  it('a suspended partner is a 401', async () => {
    seed({ status: 'suspended' })
    const res = await POST(req(BODY, `Bearer ${PARTNER_KEY}`))
    expect(res.status).toBe(401)
  })

  it('rolls back the objectives row when the profile insert fails', async () => {
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => table === 'objective_profiles'
      ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) }
      : realFrom(table)) as typeof db.from

    const res = await POST(req(BODY, `Bearer ${PARTNER_KEY}`))
    expect(res.status).toBe(500)
    expect(db.tables.objectives).toHaveLength(0)
  })
})
