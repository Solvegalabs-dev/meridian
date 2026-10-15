// FF-106 Stage 1: GET /api/strike/slots. Session, invite gate, then the slot counts
// (or { unlimited: true } for a user not on the strike_friend plan).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'
import { GET } from './route'

type SessionUser = { id: string; email?: string; app_metadata?: Record<string, unknown> } | null

let db: FakeDb
let sessionUser: SessionUser = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))

const STRIKE_FRIEND = { id: 'u1', email: 'friend@example.com', app_metadata: { signup_source: 'strike' } }

function seed(profiles: Record<string, unknown>[] = []) {
  db = new FakeDb({
    allowed_emails: [{ email: 'friend@example.com' }],
    objective_profiles: profiles,
    hunt_seasons: [],
  })
}

beforeEach(() => {
  sessionUser = STRIKE_FRIEND
  seed()
})

describe('GET /api/strike/slots', () => {
  it('401 with no session', async () => {
    sessionUser = null
    expect((await GET()).status).toBe(401)
  })

  it('403 with the invite-only message for a user who is not invited', async () => {
    sessionUser = { id: 'u1', email: 'stranger@example.com' }
    const res = await GET()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(INVITE_ONLY_MESSAGE)
  })

  it('returns { unlimited: true } for an invited user who is not a strike_friend', async () => {
    sessionUser = { id: 'u1', email: 'friend@example.com' } // no app_metadata.signup_source
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ unlimited: true })
  })

  it('returns hunt, fish and total slot counts for a strike_friend with no objectives', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      hunt: { used: 0, max: 3 },
      fish: { used: 0, max: 3 },
      total: { used: 0, max: 5 },
    })
  })

  it('counts the user\'s own active hunting and fishing profiles', async () => {
    seed([
      { id: 'p1', objective_id: 'o1', user_id: 'u1', org_source: 'strike', status: 'active', taxonomy_key: 'elk.bull.archery', domain: 'elk', state: 'UT', timing: {}, lat: null, lon: null, hunt_unit_id: null, hunt_code: null, ended_at: null, ended_reason: null },
      { id: 'p2', objective_id: 'o2', user_id: 'u1', org_source: 'strike', status: 'active', taxonomy_key: 'trout.rainbow.fly_fishing', domain: 'fishing', state: 'UT', timing: {}, lat: null, lon: null, hunt_unit_id: null, hunt_code: null, ended_at: null, ended_reason: null },
      // Someone else's objective, and an archived one of the user's own: neither counts.
      { id: 'p3', objective_id: 'o3', user_id: 'u2', org_source: 'strike', status: 'active', taxonomy_key: 'elk.bull.archery', domain: 'elk', state: 'UT', timing: {}, lat: null, lon: null, hunt_unit_id: null, hunt_code: null, ended_at: null, ended_reason: null },
      { id: 'p4', objective_id: 'o4', user_id: 'u1', org_source: 'strike', status: 'archived', taxonomy_key: 'elk.bull.archery', domain: 'elk', state: 'UT', timing: {}, lat: null, lon: null, hunt_unit_id: null, hunt_code: null, ended_at: null, ended_reason: null },
    ])
    const res = await GET()
    expect(await res.json()).toEqual({
      hunt: { used: 1, max: 3 },
      fish: { used: 1, max: 3 },
      total: { used: 2, max: 5 },
    })
  })
})
