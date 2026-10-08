// FF-096: archive, restore and PATCH routes. Session, invite gate, ownership, then the change.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'
import { POST as archive } from './archive/route'
import { POST as restore } from './restore/route'
import { PATCH as patch } from './route'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null
let touched: string[]

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))

// Trip dates must be within last year to three years ahead, so the fixtures follow the clock.
const NEXT = String(new Date().getUTCFullYear() + 1)
const OWNER = { id: 'u1', email: 'owner@example.com' }
const ABANDON_TABLES = ['objective_outcomes', 'objective_episodes', 'predictions', 'abandonment_patterns']

function seed() {
  db = new FakeDb({
    allowed_emails: [{ email: 'owner@example.com' }, { email: 'other@example.com' }],
    objective_profiles: [
      { id: 'prof-1', objective_id: 'arc-1', user_id: 'u1', org_source: 'strike', status: 'active', taxonomy_key: 'trout.rainbow.fly_fishing', state: 'UT', timing: { trip_start: `${NEXT}-10-01`, trip_end: `${NEXT}-10-31` }, ended_at: null, ended_reason: null, hunt_code: null, domain: 'fishing', lat: null, lon: null, hunt_unit_id: null },
      { id: 'prof-2', objective_id: 'arc-2', user_id: 'u2', org_source: 'strike', status: 'active', taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null, hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null },
      { id: 'prof-arc', objective_id: 'arc-arc', user_id: 'u1', org_source: 'arc', status: 'active', taxonomy_key: 'elk.bull.archery', state: 'UT', timing: {}, ended_at: null, ended_reason: null, hunt_code: null, domain: 'elk', lat: null, lon: null, hunt_unit_id: null },
    ],
    objectives: [
      { id: 'arc-1', user_id: 'u1', title: 'Rainbow trout', status: 'active', notes: null, target_date: `${NEXT}-10-31` },
      { id: 'arc-2', user_id: 'u2', title: 'Elk', status: 'active' },
      { id: 'arc-arc', user_id: 'u1', title: 'Arc goal', status: 'active' },
    ],
    campaign_units: [],
    hunt_seasons: [],
    objective_outcomes: [], objective_episodes: [], predictions: [], abandonment_patterns: [],
  })
  touched = []
  const realFrom = db.from.bind(db)
  db.from = ((t: string) => { touched.push(t); return realFrom(t) }) as typeof db.from
}

const ctx = (id: string) => ({ params: { id } })
const post = (route: typeof archive, id: string) => route(new Request('http://localhost/x', { method: 'POST' }), ctx(id))
const send = (id: string, body: unknown) =>
  patch(new Request('http://localhost/x', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx(id))

beforeEach(() => {
  sessionUser = OWNER
  seed()
})

describe.each([
  ['archive', (id: string) => post(archive, id)],
  ['restore', (id: string) => post(restore, id)],
  ['patch', (id: string) => send(id, { title: 'x' })],
])('%s: the gate', (_name, call) => {
  it('401 with no session', async () => {
    sessionUser = null
    expect((await call('prof-1')).status).toBe(401)
  })

  it('403 with the invite-only message for a user who is not invited, before any lookup of the objective', async () => {
    sessionUser = { id: 'u1', email: 'stranger@example.com' }
    const res = await call('prof-1')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(INVITE_ONLY_MESSAGE)
    expect(touched).toEqual(['allowed_emails'])
  })

  it("403 for a session with no email (fails closed)", async () => {
    sessionUser = { id: 'u1' }
    expect((await call('prof-1')).status).toBe(403)
  })

  it("404 for another user's objective, by profile id or by arc id, and nothing changes", async () => {
    const before = JSON.stringify([db.tables.objective_profiles, db.tables.objectives])
    expect((await call('prof-2')).status).toBe(404)
    expect((await call('arc-2')).status).toBe(404)
    expect(JSON.stringify([db.tables.objective_profiles, db.tables.objectives])).toBe(before)
  })

  it('404 for an id that does not exist, and for an Arc (non-Strike) objective of the caller', async () => {
    expect((await call('nope')).status).toBe(404)
    expect((await call('prof-arc')).status).toBe(404)
  })
})

describe('POST archive', () => {
  it('removes the objective: both rows archived, 200', async () => {
    const res = await post(archive, 'prof-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'archived', changed: true })
    expect(db.tables.objective_profiles[0].status).toBe('archived')
    expect(db.tables.objectives[0]).toMatchObject({ status: 'archived', archive_reason: 'Removed by owner' })
    expect(typeof db.tables.objectives[0].archive_date).toBe('string')
  })

  it('accepts the arc objective id too', async () => {
    expect((await post(archive, 'arc-1')).status).toBe(200)
    expect(db.tables.objective_profiles[0].status).toBe('archived')
  })

  it('is idempotent', async () => {
    await post(archive, 'prof-1')
    const again = await post(archive, 'prof-1')
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ status: 'archived', changed: false })
  })

  it('writes to no abandon table, and never reads one', async () => {
    await post(archive, 'prof-1')
    expect(touched.filter(t => ABANDON_TABLES.includes(t))).toEqual([])
    for (const t of ABANDON_TABLES) expect(db.tables[t]).toEqual([])
  })

  it('409 for an objective that belongs to a campaign unit, and nothing changes', async () => {
    db.tables.campaign_units.push({ id: 'cu1', objective_id: 'arc-1' })
    const res = await post(archive, 'prof-1')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('campaign_unit')
    expect(db.tables.objective_profiles[0].status).toBe('active')
  })
})

describe('POST restore', () => {
  it('restores a removed objective for the owner', async () => {
    await post(archive, 'prof-1')
    const res = await post(restore, 'prof-1')
    expect(res.status).toBe(200)
    expect(db.tables.objective_profiles[0].status).toBe('active')
    expect(db.tables.objectives[0]).toMatchObject({ status: 'active', archive_reason: null, archive_date: null })
  })

  it('409 with a clear message when the trip window has ended', async () => {
    db.tables.objective_profiles[0].timing = { trip_start: '2020-01-01', trip_end: '2020-01-10' }
    await post(archive, 'prof-1')
    const res = await post(restore, 'prof-1')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('window_ended')
    expect(body.error).toContain("can't be restored")
    expect(db.tables.objective_profiles[0].status).toBe('archived')
  })
})

describe('PATCH', () => {
  it('saves the whitelisted fields and ignores the rest', async () => {
    const res = await send('prof-1', {
      title: 'Green River opener', trip_end: `${NEXT}-11-05`, note: 'waders',
      taxonomy_key: 'elk.bull.archery', state: 'MT', hunt_code: 'EA2004', user_id: 'u2', status: 'archived', org_source: 'basemaps',
    })
    expect(res.status).toBe(200)
    expect(db.tables.objectives[0]).toMatchObject({ title: 'Green River opener', notes: 'waders', target_date: `${NEXT}-11-05`, user_id: 'u1', status: 'active' })
    expect(db.tables.objective_profiles[0]).toMatchObject({
      taxonomy_key: 'trout.rainbow.fly_fishing', state: 'UT', hunt_code: null, user_id: 'u1', status: 'active', org_source: 'strike',
      timing: { trip_start: `${NEXT}-10-01`, trip_end: `${NEXT}-11-05` },
    })
  })

  it('400 for invalid input, with nothing written', async () => {
    for (const body of [{ title: '' }, { trip_end: 'tomorrow' }, { trip_end: `${NEXT}-09-01` }, { taxonomy_key: 'x' }]) {
      expect((await send('prof-1', body)).status).toBe(400)
    }
    expect(db.tables.objectives[0].title).toBe('Rainbow trout')
    expect((await send('prof-1', 'not json')).status).toBe(400)
  })

  it('409 for a removed objective', async () => {
    await post(archive, 'prof-1')
    expect((await send('prof-1', { title: 'x' })).status).toBe(409)
  })
})

describe('PATCH: trip date range (FF-096b)', () => {
  const YEAR = new Date().getUTCFullYear()

  it('400 with a clear message for a year too far ahead, too early, or 0027, and nothing is written', async () => {
    const before = JSON.stringify([db.tables.objective_profiles, db.tables.objectives])
    for (const trip_end of [`${YEAR + 4}-01-01`, `${YEAR - 2}-12-31`, '0027-10-15']) {
      const res = await send('prof-1', { trip_end })
      expect(res.status).toBe(400)
    }
    const res = await send('prof-1', { trip_end: `${YEAR + 4}-01-01` })
    expect((await res.json()).error).toBe(`Trip dates must be between ${YEAR - 1} and ${YEAR + 3}.`)
    expect(JSON.stringify([db.tables.objective_profiles, db.tables.objectives])).toBe(before)
  })

  it('accepts the edges of the range', async () => {
    expect((await send('prof-1', { trip_start: `${YEAR - 1}-01-01`, trip_end: `${YEAR + 3}-12-31` })).status).toBe(200)
  })
})

