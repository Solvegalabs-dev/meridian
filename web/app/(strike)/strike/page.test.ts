// The /strike home is server-rendered. These tests call it directly: the invite gate (FF-092 Part 2.3)
// and the campaign list plus "Other objectives" (FF-095 Part 1).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import StrikePage from './page'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'
import type { OtherObjective } from '@/lib/strike/otherObjectives'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) },
}))
vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))
vi.mock('@/components/strike/CampaignView', () => ({ default: () => null }))

const NOW = new Date('2026-10-03T15:00:00Z')

function profile(id: string, over: Record<string, unknown> = {}) {
  return {
    id, objective_id: `arc-${id}`, user_id: 'u1', org_source: 'strike', status: 'active',
    taxonomy_key: 'trout.rainbow.fly_fishing', state: 'UT', domain: 'fishing',
    timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' },
    geo: { water_body: 'Green River' }, lat: null, lon: null, hunt_unit_id: null, hunt_code: null,
    ended_at: null, ended_reason: null, created_at: '2026-10-02T00:00:00Z', ...over,
  }
}

const campaignRow = {
  id: 'c1', user_id: 'u1', name: 'Unit 5A elk', status: 'active', taxonomy_key: 'elk.bull.archery', season_year: 2026,
  campaign_units: [{ id: 'cu1', objective_id: 'arc-prof-elk', role: 'primary', rank: 1, status: 'active', missed_reason: null, confidence_trajectory: null, pivot_recommended: false, pivot_reason: null }],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  sessionUser = null
  db = new FakeDb({
    allowed_emails: [{ email: 'invited@example.com', invited_by: 'founder' }],
    hunt_campaigns: [campaignRow],
    objective_profiles: [profile('prof-elk', { taxonomy_key: 'elk.bull.archery', domain: 'elk', geo: { unit: '5A' } })],
    objectives: [],
    strike_briefs: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

async function render() {
  const result = await StrikePage() as { type: unknown; props: { campaigns: Array<{ id: string }>; others: OtherObjective[] } }
  return result
}

describe('/strike campaign list invite gate', () => {
  it('a signed-out user is sent to login, as before', async () => {
    await expect(StrikePage()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('a user who is not invited gets the screen and no campaign data is read', async () => {
    sessionUser = { id: 'u1', email: 'stranger@example.com' }
    const tables: string[] = []
    const realFrom = db.from.bind(db)
    db.from = ((t: string) => { tables.push(t); return realFrom(t) }) as typeof db.from

    const result = await StrikePage()
    expect((result as { type: unknown }).type).toBe(InviteOnlyScreen)
    expect(tables).toEqual(['allowed_emails'])
  })

  it('fails closed when the invite lookup errors', async () => {
    sessionUser = { id: 'u1', email: 'invited@example.com' }
    const realFrom = db.from.bind(db)
    db.from = ((t: string) => t === 'allowed_emails'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }
      : realFrom(t)) as typeof db.from

    const result = await StrikePage()
    expect((result as { type: unknown }).type).toBe(InviteOnlyScreen)
  })

  it('an invited user gets the campaign list', async () => {
    sessionUser = { id: 'u1', email: 'invited@example.com' }
    const result = await StrikePage()
    expect((result as { type: unknown }).type).not.toBe(InviteOnlyScreen)
  })
})

describe('/strike Other objectives (FF-095 Part 1)', () => {
  beforeEach(() => {
    sessionUser = { id: 'u1', email: 'invited@example.com' }
  })

  it('a user with one campaign and two standalone objectives gets both lists, and the campaign profile is not repeated', async () => {
    db.tables.objective_profiles.push(
      profile('prof-trout'),
      profile('prof-salmon', { taxonomy_key: 'salmon.sockeye.river_migration', state: 'AK', geo: {} }),
    )
    const { props } = await render()

    expect(props.campaigns.map(c => c.id)).toEqual(['c1'])
    expect(props.others.map(o => o.id).sort()).toEqual(['prof-salmon', 'prof-trout'])
    expect(props.others.some(o => o.id === 'prof-elk')).toBe(false)
  })

  it('a user with only standalone objectives gets no campaigns and the objectives', async () => {
    db.tables.hunt_campaigns = []
    db.tables.objective_profiles = [profile('prof-trout')]
    const { props } = await render()
    expect(props.campaigns).toEqual([])
    expect(props.others.map(o => o.id)).toEqual(['prof-trout'])
  })

  it("another user's objectives and campaigns never appear", async () => {
    db.tables.hunt_campaigns.push({ ...campaignRow, id: 'c-other', user_id: 'u2' })
    db.tables.objective_profiles.push(
      profile('prof-mine'),
      profile('prof-theirs', { user_id: 'u2' }),
      profile('prof-theirs-too', { user_id: 'u2', objective_id: 'arc-theirs-too' }),
    )
    const { props } = await render()
    expect(props.campaigns.map(c => c.id)).toEqual(['c1'])
    expect(props.others.map(o => o.id)).toEqual(['prof-mine'])
  })

  it('lists only Strike objectives that are active or completed', async () => {
    db.tables.objective_profiles.push(
      profile('prof-ok'),
      profile('prof-partner', { org_source: 'basemaps' }),
      profile('prof-abandoned', { status: 'abandoned' }),
    )
    const { props } = await render()
    expect(props.others.map(o => o.id)).toEqual(['prof-ok'])
  })

  it('sorts ended objectives last, labels them, and sorts active first', async () => {
    db.tables.objective_profiles.push(
      profile('prof-ended', { timing: { trip_start: '2026-09-01', trip_end: '2026-09-15' }, created_at: '2026-10-02T12:00:00Z' }),
      profile('prof-upcoming', { timing: { trip_start: '2026-11-10', trip_end: '2026-11-20' }, created_at: '2026-10-01T00:00:00Z' }),
      profile('prof-active', { created_at: '2026-09-20T00:00:00Z' }),
    )
    const { props } = await render()
    expect(props.others.map(o => o.id)).toEqual(['prof-active', 'prof-upcoming', 'prof-ended'])
    expect(props.others.map(o => o.chip?.label)).toEqual(['Active', 'Opens Nov 10', 'Trip ended on Sep 15'])
  })

  it('shows the verdict of a live brief and none for an ended hunt', async () => {
    db.tables.objective_profiles.push(
      profile('prof-live'),
      profile('prof-over', { timing: { trip_start: '2026-09-01', trip_end: '2026-09-15' } }),
    )
    db.tables.strike_briefs = [
      { id: 'b1', objective_id: 'arc-prof-live', go_no_go: 'GO', confidence_tier: 'T2', created_at: '2026-10-03T06:00:00Z' },
      { id: 'b2', objective_id: 'arc-prof-over', go_no_go: 'GO', confidence_tier: 'T2', created_at: '2026-09-14T06:00:00Z' },
    ]
    const { props } = await render()
    expect(props.others.find(o => o.id === 'prof-live')!.verdict).toBe('GO')
    expect(props.others.find(o => o.id === 'prof-over')!.verdict).toBeNull()
  })

  it('titles a raw-key objective readably, and keeps a written title', async () => {
    db.tables.objective_profiles.push(
      profile('prof-raw'),
      profile('prof-named', { objective_id: 'arc-named' }),
    )
    db.tables.objectives = [
      { id: 'arc-prof-raw', user_id: 'u1', title: 'trout · rainbow · fly_fishing' },
      { id: 'arc-named', user_id: 'u1', title: 'Opening day on the Green' },
    ]
    const { props } = await render()
    expect(props.others.find(o => o.id === 'prof-raw')!.title).toBe('Rainbow trout, fly fishing, Green River (Utah)')
    expect(props.others.find(o => o.id === 'prof-named')!.title).toBe('Opening day on the Green')
  })

  it('does not read another user\'s objectives titles', async () => {
    db.tables.objective_profiles.push(profile('prof-raw'))
    db.tables.objectives = [{ id: 'arc-prof-raw', user_id: 'u2', title: 'Someone else\'s title' }]
    const { props } = await render()
    expect(props.others[0].title).toBe('Rainbow trout, fly fishing, Green River (Utah)')
  })

  it('a user with nothing gets no campaigns and no other objectives', async () => {
    db.tables.hunt_campaigns = []
    db.tables.objective_profiles = []
    const { props } = await render()
    expect(props.campaigns).toEqual([])
    expect(props.others).toEqual([])
  })

  it('never selects *, and puts no coordinates in what it passes to the view', async () => {
    db.tables.objective_profiles.push(profile('prof-trout', { lat: 40.5123, lon: -111.2456 }))
    const selects: Array<[string, unknown]> = []
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => {
      const q = realFrom(table) as unknown as { select: (...a: unknown[]) => unknown }
      const original = q.select.bind(q)
      q.select = (...args: unknown[]) => { selects.push([table, args[0]]); return original(...args) }
      return q
    }) as typeof db.from

    const { props } = await render()
    expect(selects.map(([t]) => t)).toEqual(expect.arrayContaining(['objective_profiles', 'hunt_campaigns', 'strike_briefs']))
    expect(selects.filter(([, cols]) => cols === '*' || cols === undefined).map(([t]) => t)).toEqual(
      expect.not.arrayContaining(['objective_profiles', 'objectives', 'strike_briefs', 'hunt_campaigns']),
    )
    expect(JSON.stringify(props.others)).not.toMatch(/40\.5123|111\.2456/)
  })
})
