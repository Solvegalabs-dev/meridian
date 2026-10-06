import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { hashPartnerKey } from '@/lib/auth/partnerAuth'
import { resetRateLimitsForTests } from '@/lib/auth/rateLimit'
import { GET } from './route'

let db: FakeDb
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))

const BM_KEY = 'basemaps-partner-key-0123456789abcdef'
const OTHER_KEY = 'other-partner-key-0123456789abcdef0'

function get(query: string, auth?: string) {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  return GET(new NextRequest(`http://localhost/api/partner/objectives?${query}`, { headers }))
}

beforeEach(() => {
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
      { id: 'p-bm-1', objective_id: 'a-bm-1', partner_id: 'partner-bm', partner_user_ref: 'cust-1', taxonomy_key: 'elk.bull.archery', status: 'active', lat: 40.5, lon: -111.2, geo: { lat: 40.5 }, created_at: '2026-10-01' },
      { id: 'p-other-1', objective_id: 'a-other-1', partner_id: 'partner-other', partner_user_ref: 'cust-1', taxonomy_key: 'deer.mule.archery', status: 'active', created_at: '2026-10-02' },
    ],
  })
})

describe('GET /api/partner/objectives', () => {
  it('requires a key', async () => {
    expect((await get('partner_user_ref=cust-1')).status).toBe(401)
  })

  it('requires partner_user_ref', async () => {
    expect((await get('', `Bearer ${BM_KEY}`)).status).toBe(400)
  })

  it('lists only the calling partner\'s objectives for that customer, with no geo or coordinates', async () => {
    const res = await get('partner_user_ref=cust-1', `Bearer ${BM_KEY}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.objectives).toHaveLength(1)
    expect(body.objectives[0]).toMatchObject({ objective_profile_id: 'p-bm-1', objective_id: 'a-bm-1', taxonomy_key: 'elk.bull.archery' })
    expect(JSON.stringify(body)).not.toMatch(/lat|lon|geo/)
  })

  it('the other partner sees only its own objectives for the same customer ref', async () => {
    const body = await (await get('partner_user_ref=cust-1', `Bearer ${OTHER_KEY}`)).json()
    expect(body.objectives.map((o: { objective_profile_id: string }) => o.objective_profile_id)).toEqual(['p-other-1'])
  })

  it('a revoked key is a 401', async () => {
    db.tables.partner_api_keys[0].revoked_at = '2026-10-01T00:00:00Z'
    expect((await get('partner_user_ref=cust-1', `Bearer ${BM_KEY}`)).status).toBe(401)
  })
})
