// FF-106 Stage 2 Part B: POST /api/strike/objectives/[id]/plan-again.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'
import { POST } from './route'

let db: FakeDb
let sessionUser: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/swarm/objectiveRouter', () => ({
  resolveAgentBundle: vi.fn(async () => ({ agents: ['AGENT_A'], buildStatus: 'ready' })),
}))
vi.mock('@/lib/agents/runAgentsForObjective', () => ({ runAgentsForObjective: vi.fn(async () => {}) }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }))
vi.mock('@/lib/geo/locationResolver', () => ({
  resolveFullGeography: vi.fn(async () => ({
    nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, nws_zone_id: 'UTZ001',
    state: 'UT', county: 'Summit', usgs_gauge_ids: [], snotel_station_ids: [],
    elevation_ft_avg: 8200, hunt_unit_id: 'resolver-unit',
  })),
}))

// Strike-friend by default: most tests here exercise the limited path, same as /join users.
const OWNER = { id: 'u1', email: 'owner@example.com', app_metadata: { signup_source: 'strike' } }

function seed(overrides: Record<string, unknown> = {}) {
  db = new FakeDb({
    allowed_emails: [{ email: 'owner@example.com' }, { email: 'other@example.com' }],
    objective_profiles: [
      {
        id: 'prof-1', objective_id: 'arc-1', user_id: 'u1', org_source: 'strike', status: 'completed',
        taxonomy_key: 'elk.bull.archery', state: 'UT', timing: { trip_start: '2024-10-01', trip_end: '2024-10-10' },
        ended_at: '2024-10-11T00:00:00Z', ended_reason: 'trip_ended', hunt_code: 'EA2004', domain: 'elk',
        lat: 40.1, lon: -111.1, hunt_unit_id: 'u-5', geo: {}, priority_stack: [], ...overrides,
      },
      { id: 'prof-2', objective_id: 'arc-2', user_id: 'u2', org_source: 'strike', status: 'completed', taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null, hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null, geo: {}, priority_stack: [] },
      { id: 'prof-arc', objective_id: 'arc-arc', user_id: 'u1', org_source: 'arc', status: 'completed', taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null, hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null, geo: {}, priority_stack: [] },
    ],
    objectives: [
      { id: 'arc-1', user_id: 'u1', title: 'EA2004 bull elk', status: 'active', obj_id: 'OBJ-01' },
      { id: 'arc-2', user_id: 'u2', title: 'Elk', status: 'active' },
      { id: 'arc-arc', user_id: 'u1', title: 'Arc goal', status: 'active' },
    ],
    objective_spots: [
      { id: 'spot-1', objective_id: 'arc-1', name: 'Primary spot', lat: 40.1, lon: -111.1, is_active: true },
    ],
    campaign_units: [],
    hunt_seasons: [],
  })
}

const post = (id: string) => POST(new Request('http://localhost/x', { method: 'POST' }), { params: { id } })

beforeEach(() => {
  sessionUser = OWNER
  seed()
})

describe('the gate', () => {
  it('401 with no session', async () => {
    sessionUser = null
    expect((await post('prof-1')).status).toBe(401)
  })

  it('403 with the invite-only message for a user who is not invited', async () => {
    sessionUser = { id: 'u1', email: 'stranger@example.com' }
    const res = await post('prof-1')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(INVITE_ONLY_MESSAGE)
  })

  it("404 for another user's objective, and nothing is created", async () => {
    const before = db.tables.objective_profiles.length
    expect((await post('prof-2')).status).toBe(404)
    expect(db.tables.objective_profiles.length).toBe(before)
  })

  it('404 for an Arc (non-Strike) objective of the caller', async () => {
    expect((await post('prof-arc')).status).toBe(404)
  })

  it('404 for an id that does not exist', async () => {
    expect((await post('nope')).status).toBe(404)
  })
})

describe('POST plan-again', () => {
  it('creates a new objective and returns 201 with both ids', async () => {
    const res = await post('prof-1')
    expect(res.status).toBe(201)
    const body = await res.json() as { objective_id: string; arc_objective_id: string }
    expect(db.tables.objective_profiles.find(p => p.id === body.objective_id)).toBeTruthy()
    expect(db.tables.objectives.find(o => o.id === body.arc_objective_id)).toBeTruthy()
  })

  it('409 for an objective that is not finished', async () => {
    const farFuture = String(new Date().getUTCFullYear() + 2)
    seed({ status: 'active', timing: { trip_start: `${farFuture}-10-01`, trip_end: `${farFuture}-10-10` } })
    const res = await post('prof-1')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_finished')
  })

  it('409 for a campaign unit', async () => {
    db.tables.campaign_units.push({ id: 'cu1', objective_id: 'arc-1' })
    const res = await post('prof-1')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('campaign_unit')
  })

  it('403 objective_limit_reached when the category is full, same shape as the create route', async () => {
    const extra = Array.from({ length: 3 }, (_, i) => ({
      id: `fill-${i}`, objective_id: `arc-fill-${i}`, user_id: 'u1', org_source: 'strike', status: 'active',
      taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null,
      hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null, geo: {}, priority_stack: [],
    }))
    db.tables.objective_profiles.push(...extra)
    const res = await post('prof-1')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'objective_limit_reached', category: 'hunt', max: 3 })
  })

  it('a friend at the cap is still refused with objective_limit_reached', async () => {
    sessionUser = { id: 'u1', email: 'owner@example.com', app_metadata: { signup_source: 'strike' } }
    const extra = Array.from({ length: 3 }, (_, i) => ({
      id: `fill-${i}`, objective_id: `arc-fill-${i}`, user_id: 'u1', org_source: 'strike', status: 'active',
      taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null,
      hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null, geo: {}, priority_stack: [],
    }))
    db.tables.objective_profiles.push(...extra)
    const res = await post('prof-1')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('objective_limit_reached')
  })

  // Not on the strike_friend plan (no app_metadata.signup_source === 'strike'): same as the
  // create route and /api/strike/slots, this user is not limited at all.
  it('a non-friend with 5 active objectives can still plan again', async () => {
    sessionUser = { id: 'u1', email: 'owner@example.com' }
    const extra = Array.from({ length: 5 }, (_, i) => ({
      id: `fill-${i}`, objective_id: `arc-fill-${i}`, user_id: 'u1', org_source: 'strike', status: 'active',
      taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null,
      hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null, geo: {}, priority_stack: [],
    }))
    db.tables.objective_profiles.push(...extra)
    const res = await post('prof-1')
    expect(res.status).toBe(201)
    const body = await res.json() as { objective_id: string }
    expect(db.tables.objective_profiles.find(p => p.id === body.objective_id)).toBeTruthy()
  })
})
