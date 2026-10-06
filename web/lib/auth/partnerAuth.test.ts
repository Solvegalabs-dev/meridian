import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { authenticatePartner, hashPartnerKey, isPartnerRequest } from './partnerAuth'

let db: FakeDb
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))

const KEY = 'test-partner-key-0123456789abcdef'

function req(auth: string | null) {
  const headers: Record<string, string> = {}
  if (auth !== null) headers.authorization = auth
  return new Request('http://localhost/api/mip/brief', { headers })
}

function seed(overrides: { keyRevoked?: string | null; partnerStatus?: string } = {}) {
  db = new FakeDb({
    partners: [
      { id: 'partner-bm', slug: 'basemaps', status: overrides.partnerStatus ?? 'active', owner_user_id: 'svc-bm', rate_limit_per_min: 60 },
    ],
    partner_api_keys: [
      { id: 'key-1', partner_id: 'partner-bm', key_hash: hashPartnerKey(KEY), revoked_at: overrides.keyRevoked ?? null, last_used_at: null },
    ],
  })
}

beforeEach(() => seed())
afterEach(() => vi.restoreAllMocks())

describe('authenticatePartner', () => {
  it('returns the partner for a valid key and stamps last_used_at', async () => {
    const ctx = await authenticatePartner(req(`Bearer ${KEY}`))
    expect(ctx).toEqual({ partnerId: 'partner-bm', slug: 'basemaps', ownerUserId: 'svc-bm', rateLimitPerMin: 60 })
    expect(db.tables.partner_api_keys[0].last_used_at).toBeTruthy()
  })

  it('stores only the hash: the raw key is not in any row', async () => {
    const stored = JSON.stringify(db.tables)
    expect(stored).not.toContain(KEY)
    expect(db.tables.partner_api_keys[0].key_hash).toBe(hashPartnerKey(KEY))
  })

  it('accepts a lowercase bearer scheme', async () => {
    expect(await authenticatePartner(req(`bearer ${KEY}`))).not.toBeNull()
  })

  it('rejects a missing header, a non-bearer scheme, a short key and an unknown key', async () => {
    expect(await authenticatePartner(req(null))).toBeNull()
    expect(await authenticatePartner(req(`Basic ${KEY}`))).toBeNull()
    expect(await authenticatePartner(req('Bearer short'))).toBeNull()
    expect(await authenticatePartner(req('Bearer not-a-real-key-but-long-enough-0000'))).toBeNull()
  })

  it('rejects a revoked key', async () => {
    seed({ keyRevoked: '2026-10-01T00:00:00Z' })
    expect(await authenticatePartner(req(`Bearer ${KEY}`))).toBeNull()
  })

  it('rejects a key whose partner is suspended', async () => {
    seed({ partnerStatus: 'suspended' })
    expect(await authenticatePartner(req(`Bearer ${KEY}`))).toBeNull()
  })

  it('never logs the key or its hash', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')]
    await authenticatePartner(req(`Bearer ${KEY}`))
    await authenticatePartner(req('Bearer wrong-key-wrong-key-wrong-key-00'))
    const logged = JSON.stringify(spies.flatMap(s => s.mock.calls))
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain(hashPartnerKey(KEY))
  })
})

describe('isPartnerRequest', () => {
  it('is true when an Authorization header is present, even if it is malformed', () => {
    expect(isPartnerRequest(req('Basic abc'))).toBe(true)
    expect(isPartnerRequest(req(null))).toBe(false)
  })
})
