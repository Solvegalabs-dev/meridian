import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { hashPartnerKey } from '@/lib/auth/partnerAuth'
import { resetRateLimitsForTests } from '@/lib/auth/rateLimit'
import { GET } from './route'

// FF-092 Part 3.4: the two doors of /api/mip/brief. The brief builder is mocked; these tests cover who may read.
let db: FakeDb
let sessionUser: { id: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/mip/briefPayload', () => ({
  getMipBriefPayload: vi.fn(async (_db: unknown, id: string) => ({ payload: { objective_id: id, summary: 'ok' }, notFound: false })),
}))

const BM_KEY = 'basemaps-partner-key-0123456789abcdef'
const OTHER_KEY = 'other-partner-key-0123456789abcdef0'

function get(query: string, auth?: string) {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  return GET(new Request(`http://localhost/api/mip/brief?${query}`, { headers }))
}

beforeEach(() => {
  sessionUser = null
  resetRateLimitsForTests()
  db = new FakeDb({
    partners: [
      { id: 'partner-bm', slug: 'basemaps', status: 'active', owner_user_id: 'svc-bm', rate_limit_per_min: 60 },
      { id: 'partner-other', slug: 'other', status: 'active', owner_user_id: 'svc-other', rate_limit_per_min: 60 },
    ],
    partner_api_keys: [
      { id: 'k1', partner_id: 'partner-bm', key_hash: hashPartnerKey(BM_KEY), revoked_at: null },
      { id: 'k2', partner_id: 'partner-other', key_hash: hashPartnerKey(OTHER_KEY), revoked_at: null },
    ],
    objective_profiles: [
      { id: 'prof-bm', objective_id: 'arc-bm', user_id: 'svc-bm', partner_id: 'partner-bm', partner_user_ref: 'cust-1' },
      { id: 'prof-strike', objective_id: 'arc-s', user_id: 'user-1', partner_id: null },
    ],
  })
})

describe('GET /api/mip/brief: no door', () => {
  it('no key and no session is a 401', async () => {
    expect((await get('objective_id=prof-strike')).status).toBe(401)
  })

  it('partner_key=basemaps without a key is a 401', async () => {
    sessionUser = { id: 'user-1' }
    expect((await get('objective_id=prof-strike&partner_key=basemaps')).status).toBe(401)
  })
})

describe('GET /api/mip/brief: session door', () => {
  it('the owner reads their objective', async () => {
    sessionUser = { id: 'user-1' }
    expect((await get('objective_id=prof-strike')).status).toBe(200)
  })

  it('another signed-in user gets a 404 for the same id, by PK or arc id', async () => {
    sessionUser = { id: 'user-2' }
    expect((await get('objective_id=prof-strike')).status).toBe(404)
    expect((await get('objective_id=arc-s&partner_key=arc')).status).toBe(404)
  })
})

describe('GET /api/mip/brief: partner door', () => {
  it('the key\'s own partner reads its objective, with the partner header', async () => {
    const res = await get('objective_id=prof-bm', `Bearer ${BM_KEY}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-MIP-Partner')).toBe('basemaps')
  })

  it('a different partner gets a 404 for another partner\'s objective', async () => {
    expect((await get('objective_id=prof-bm', `Bearer ${OTHER_KEY}`)).status).toBe(404)
  })

  it('a key cannot read a Strike (session) objective', async () => {
    expect((await get('objective_id=prof-strike', `Bearer ${BM_KEY}`)).status).toBe(404)
  })

  it('partner_key that does not match the key\'s slug is a 403', async () => {
    expect((await get('objective_id=prof-bm&partner_key=other', `Bearer ${BM_KEY}`)).status).toBe(403)
  })

  it('a revoked key is a 401', async () => {
    db.tables.partner_api_keys[0].revoked_at = '2026-10-01T00:00:00Z'
    expect((await get('objective_id=prof-bm', `Bearer ${BM_KEY}`)).status).toBe(401)
  })
})
