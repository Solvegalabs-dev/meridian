// FF-105B Fix 2: a Strike session objective kicks off its first agent collection run after the
// response is sent. Partner/MIP objectives never do, and a failure never affects creation.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { FakeDb } from '@/lib/spots/testDb'
import { hashPartnerKey } from '@/lib/auth/partnerAuth'
import { runAgentsForObjective } from '@/lib/agents/runAgentsForObjective'
import { POST } from './route'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/swarm/objectiveRouter', () => ({ resolveAgentBundle: vi.fn(async () => ({ agents: ['AGENT_A'], buildStatus: 'ready' })) }))
vi.mock('@/lib/geo/locationResolver', () => ({ resolveFullGeography: vi.fn(async () => null) }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))
vi.mock('@/lib/agents/runAgentsForObjective', () => ({ runAgentsForObjective: vi.fn(async () => undefined) }))

const PARTNER_KEY = 'partner-key-basemaps-0123456789abcdef'
const BODY = {
  domain: 'elk',
  taxonomy_key: 'elk.bull.archery',
  geo: { state: 'ut', unit: 'EA2004' },
  priority_stack: [],
  timing: { trip_end: `${new Date().getUTCFullYear()}-11-15` },
}

function req(body: unknown, auth?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest('http://localhost/api/objectives/create', { method: 'POST', body: JSON.stringify(body), headers })
}

beforeEach(() => {
  sessionUser = { id: 'u1', email: 'owner@example.com' }
  vi.mocked(runAgentsForObjective).mockClear().mockResolvedValue(undefined)
  vi.mocked(waitUntil).mockClear()
  db = new FakeDb({
    allowed_emails: [{ email: 'owner@example.com' }],
    partners: [{ id: 'p1', slug: 'basemaps', status: 'active', owner_user_id: 'svc-bm', rate_limit_per_min: 60 }],
    partner_api_keys: [{ id: 'k1', partner_id: 'p1', key_hash: hashPartnerKey(PARTNER_KEY), revoked_at: null }],
    objectives: [], objective_profiles: [],
  })
})

describe('create: first collection run (FF-105B Fix 2)', () => {
  it('runs after the response is sent, scoped to the new objective', async () => {
    const res = await POST(req(BODY))
    expect(res.status).toBe(201)
    const body = await res.json()

    // waitUntil's callback is passed in, not awaited by the handler itself.
    expect(waitUntil).toHaveBeenCalled()
    expect(runAgentsForObjective).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runAgentsForObjective).mock.calls[0][1]).toBe(body.arc_objective_id)
  })

  it('never runs for a partner-created objective', async () => {
    const res = await POST(req(BODY, `Bearer ${PARTNER_KEY}`))
    expect(res.status).toBe(201)
    expect(runAgentsForObjective).not.toHaveBeenCalled()
  })

  it('does not affect objective creation when the collection run rejects', async () => {
    vi.mocked(runAgentsForObjective).mockRejectedValue(new Error('boom'))
    const res = await POST(req(BODY))
    expect(res.status).toBe(201)

    // Let the swallowed rejection settle before the test ends.
    await vi.mocked(waitUntil).mock.calls[0][0]
  })
})
