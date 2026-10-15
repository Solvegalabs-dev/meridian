// FF-106 Stage 2 Part C: GET /api/strike/objectives, for the objective-page switcher.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'
import { GET } from './route'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))

const OWNER = { id: 'u1', email: 'owner@example.com' }
const NEXT = String(new Date().getUTCFullYear() + 1)

function profile(over: Record<string, unknown>) {
  return {
    id: over.id, objective_id: over.objective_id, user_id: 'u1', org_source: 'strike', status: 'active',
    taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null,
    hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null, geo: {}, created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function seed(profiles: Array<Record<string, unknown>> = [], objectives: Array<Record<string, unknown>> = [], campaignUnits: Array<Record<string, unknown>> = []) {
  db = new FakeDb({
    allowed_emails: [{ email: 'owner@example.com' }],
    objective_profiles: profiles,
    objectives,
    campaign_units: campaignUnits,
    hunt_seasons: [],
  })
}

beforeEach(() => {
  sessionUser = OWNER
  seed()
})

describe('the gate', () => {
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
})

describe('GET /api/strike/objectives', () => {
  it('lists only this user\'s non-removed Strike objectives, each with a title, chip and group', async () => {
    seed(
      [
        profile({ id: 'p1', objective_id: 'a1', timing: { trip_start: `${NEXT}-01-01` } }),
        profile({ id: 'p2', objective_id: 'a2', user_id: 'u2' }), // another user
        profile({ id: 'p3', objective_id: 'a3', org_source: 'arc' }), // non-Strike
        profile({ id: 'p4', objective_id: 'a4', status: 'archived' }), // removed
      ],
      [
        { id: 'a1', user_id: 'u1', title: null },
      ],
    )
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as { objectives: Array<{ id: string; title: string; group: string }> }
    expect(body.objectives).toHaveLength(1)
    expect(body.objectives[0]).toMatchObject({ id: 'p1' })
    expect(body.objectives[0].title).toContain('elk')
    expect(body.objectives[0].group).toBeTruthy()
  })

  it('includes a campaign unit', async () => {
    seed(
      [profile({ id: 'p1', objective_id: 'a1' })],
      [{ id: 'a1', user_id: 'u1', title: 'Camp unit' }],
      [{ id: 'cu1', objective_id: 'a1' }],
    )
    const res = await GET()
    const body = await res.json() as { objectives: Array<{ id: string; title: string }> }
    expect(body.objectives.map(o => o.id)).toContain('p1')
    expect(body.objectives[0].title).toBe('Camp unit')
  })

  it('orders by focus group then soonest trip start, finished last', async () => {
    seed(
      [
        profile({ id: 'finished', objective_id: 'a-fin', status: 'completed' }),
        profile({ id: 'soon', objective_id: 'a-soon', timing: { trip_start: `${NEXT}-01-01` } }),
        profile({ id: 'later', objective_id: 'a-later', timing: { trip_start: `${NEXT}-06-01` } }),
      ],
      [],
    )
    const res = await GET()
    const body = await res.json() as { objectives: Array<{ id: string }> }
    expect(body.objectives.map(o => o.id)).toEqual(['soon', 'later', 'finished'])
  })

  it('returns an empty list for a user with no Strike objectives', async () => {
    const res = await GET()
    expect((await res.json())).toEqual({ objectives: [] })
  })
})
