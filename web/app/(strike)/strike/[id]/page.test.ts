// FF-092 Part 2: the Strike page is server-rendered. These tests call it directly and check the access gate.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import StrikePage from './page'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'
import RemovedObjectiveNotice from '@/components/strike/RemovedObjectiveNotice'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/components/strike/StrikeBriefClient', () => ({ default: () => null }))
vi.mock('@/components/strike/LastHuntBrief', () => ({ default: () => null }))
vi.mock('@/lib/swarm/agents/outdoor/collarCalibration', () => ({
  getCollarBriefAugmentation: vi.fn(async () => ({ windows: [] })),
}))
vi.mock('@/lib/objectives/objectiveWindow', () => ({ loadObjectiveWindow: vi.fn(async () => null) }))

beforeEach(() => {
  sessionUser = null
  db = new FakeDb({
    objective_profiles: [
      { id: 'prof-1', objective_id: 'arc-1', user_id: 'user-1', taxonomy_key: 'elk.bull.archery', status: 'active', lat: 40.5, lon: -111.2 },
    ],
    objectives: [{ id: 'arc-1', user_id: 'user-1', title: 'Elk hunt' }],
    strike_briefs: [],
    allowed_emails: [{ email: 'owner@example.com', invited_by: 'founder' }, { email: 'other@example.com', invited_by: 'founder' }],
  })
})

describe('Strike page access', () => {
  it('the owner renders the page', async () => {
    sessionUser = { id: 'user-1', email: 'owner@example.com' }
    await expect(StrikePage({ params: { id: 'prof-1' } })).resolves.toBeTruthy()
  })

  it('the owner can open it by arc objective_id too', async () => {
    sessionUser = { id: 'user-1', email: 'owner@example.com' }
    await expect(StrikePage({ params: { id: 'arc-1' } })).resolves.toBeTruthy()
  })

  it('another signed-in user gets notFound for the same id', async () => {
    sessionUser = { id: 'user-2', email: 'other@example.com' }
    await expect(StrikePage({ params: { id: 'prof-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(StrikePage({ params: { id: 'arc-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('no session gets notFound, not the objective', async () => {
    await expect(StrikePage({ params: { id: 'prof-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('Strike page invite gate (FF-092 Part 2.3)', () => {
  it('a signed-in user who is not invited gets the invite-only screen, even for their own objective', async () => {
    sessionUser = { id: 'user-1', email: 'stranger@example.com' }
    const result = await StrikePage({ params: { id: 'prof-1' } })
    expect((result as { type: unknown }).type).toBe(InviteOnlyScreen)
  })

  it('reads no objective data for a user who is not invited', async () => {
    sessionUser = { id: 'user-1', email: 'stranger@example.com' }
    const tables: string[] = []
    const realFrom = db.from.bind(db)
    db.from = ((t: string) => { tables.push(t); return realFrom(t) }) as typeof db.from

    await StrikePage({ params: { id: 'prof-1' } })
    expect(tables).toEqual(['allowed_emails'])
  })

  it('a session with no email gets the screen', async () => {
    sessionUser = { id: 'user-1' }
    const result = await StrikePage({ params: { id: 'prof-1' } })
    expect((result as { type: unknown }).type).toBe(InviteOnlyScreen)
  })

  it('fails closed when the invite lookup errors', async () => {
    sessionUser = { id: 'user-1', email: 'owner@example.com' }
    const realFrom = db.from.bind(db)
    db.from = ((t: string) => t === 'allowed_emails'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }
      : realFrom(t)) as typeof db.from

    const result = await StrikePage({ params: { id: 'prof-1' } })
    expect((result as { type: unknown }).type).toBe(InviteOnlyScreen)
  })

  it('an invited owner still renders the page, not the screen', async () => {
    sessionUser = { id: 'user-1', email: 'owner@example.com' }
    const result = await StrikePage({ params: { id: 'prof-1' } })
    expect((result as { type: unknown }).type).not.toBe(InviteOnlyScreen)
  })
})

// Finds the StrikeBriefClient element in what the page returns and gives back its props.
function clientProps(tree: unknown): Record<string, unknown> | null {
  if (!tree || typeof tree !== 'object') return null
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = clientProps(child); if (found) return found }
    return null
  }
  const el = tree as { props?: Record<string, unknown> }
  if (el.props && 'canRemove' in el.props) return el.props
  return clientProps(el.props?.children)
}

describe('Strike page: removed objectives (FF-096)', () => {
  const owner = () => { sessionUser = { id: 'user-1', email: 'owner@example.com' } }

  it('a removed objective shows the removed page with Restore, not the brief', async () => {
    owner()
    db.tables.objective_profiles[0].status = 'archived'
    const result = await StrikePage({ params: { id: 'prof-1' } }) as { type: unknown; props: { objectiveId: string; title: string } }

    expect(result.type).toBe(RemovedObjectiveNotice)
    expect(result.props.objectiveId).toBe('prof-1')
    expect(result.props.title).toBe('Elk hunt')
  })

  it('reads no brief data for a removed objective', async () => {
    owner()
    db.tables.objective_profiles[0].status = 'archived'
    const tables: string[] = []
    const realFrom = db.from.bind(db)
    db.from = ((t: string) => { tables.push(t); return realFrom(t) }) as typeof db.from

    await StrikePage({ params: { id: 'prof-1' } })
    expect(tables).not.toContain('strike_briefs')
    expect(tables).not.toContain('agent_objective_context')
  })

  it('computes a readable title for a removed objective whose stored title is the raw key', async () => {
    owner()
    db.tables.objective_profiles[0].status = 'archived'
    db.tables.objectives[0].title = 'elk · bull · archery'
    const result = await StrikePage({ params: { id: 'arc-1' } }) as { props: { title: string } }
    expect(result.props.title).toBe('Bull elk, archery')
  })

  it("another user still gets notFound for a removed objective, so the page cannot be used to probe ids", async () => {
    sessionUser = { id: 'user-2', email: 'other@example.com' }
    db.tables.objective_profiles[0].status = 'archived'
    await expect(StrikePage({ params: { id: 'prof-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a user who is not invited gets the invite screen, not the removed page', async () => {
    sessionUser = { id: 'user-1', email: 'stranger@example.com' }
    db.tables.objective_profiles[0].status = 'archived'
    const result = await StrikePage({ params: { id: 'prof-1' } })
    expect((result as { type: unknown }).type).toBe(InviteOnlyScreen)
  })
})

describe('Strike page: remove action and note (FF-096)', () => {
  const owner = () => { sessionUser = { id: 'user-1', email: 'owner@example.com' } }

  it('a standalone objective can be removed, and its note is passed to the page', async () => {
    owner()
    db.tables.objectives[0].notes = 'bring waders'
    const props = clientProps(await StrikePage({ params: { id: 'prof-1' } }))
    expect(props?.canRemove).toBe(true)
    expect(props?.note).toBe('bring waders')
  })

  it('an objective that belongs to a campaign unit cannot be removed from here', async () => {
    owner()
    db.tables.campaign_units = [{ id: 'cu1', objective_id: 'arc-1' }]
    const props = clientProps(await StrikePage({ params: { id: 'prof-1' } }))
    expect(props?.canRemove).toBe(false)
  })

  it('shows a readable title when the stored one is the raw key', async () => {
    owner()
    db.tables.objectives[0].title = 'elk · bull · archery'
    const props = clientProps(await StrikePage({ params: { id: 'prof-1' } }))
    expect(props?.title).toBe('Bull elk, archery')
  })
})

describe('Strike page: sweep info for Run Sweep (FF-098)', () => {
  const owner = () => { sessionUser = { id: 'user-1', email: 'owner@example.com' } }
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
  const sweepOf = (tree: unknown) => clientProps(tree)?.sweep as { lastSweepAt: string | null; nextSweepAt: string | null; latestDataAt: string | null }

  it('passes nothing when the user has never swept and nothing is tagged', async () => {
    owner()
    const sweep = sweepOf(await StrikePage({ params: { id: 'prof-1' } }))
    expect(sweep).toEqual({ lastSweepAt: null, nextSweepAt: null, latestDataAt: null })
  })

  it('passes the last sweep, the 23-hour limit and the sweep as the latest data', async () => {
    owner()
    const last = hoursAgo(2)
    db.tables.profiles = [{ id: 'user-1', account_type: 'beta', last_sweep_at: last }]
    const sweep = sweepOf(await StrikePage({ params: { id: 'prof-1' } }))
    expect(sweep.lastSweepAt).toBe(last)
    expect(sweep.latestDataAt).toBe(last)
    expect(new Date(sweep.nextSweepAt as string).getTime()).toBe(new Date(last).getTime() + 23 * 3600_000)
  })

  it('has no limit once 23 hours have passed', async () => {
    owner()
    db.tables.profiles = [{ id: 'user-1', account_type: 'beta', last_sweep_at: hoursAgo(30) }]
    expect(sweepOf(await StrikePage({ params: { id: 'prof-1' } })).nextSweepAt).toBeNull()
  })

  it('a signal tagged to this objective is sweep data', async () => {
    owner()
    const tagged = hoursAgo(10)
    db.tables.signals = [{ id: 's1', user_id: 'user-1', objective_ids: ['arc-1'], created_at: tagged }]
    expect(sweepOf(await StrikePage({ params: { id: 'prof-1' } })).latestDataAt).toBe(tagged)
  })

  it("another objective's signal and another user's signal are not", async () => {
    owner()
    db.tables.signals = [
      { id: 's1', user_id: 'user-1', objective_ids: ['some-other-objective'], created_at: hoursAgo(1) },
      { id: 's2', user_id: 'user-2', objective_ids: ['arc-1'], created_at: hoursAgo(1) },
    ]
    expect(sweepOf(await StrikePage({ params: { id: 'prof-1' } })).latestDataAt).toBeNull()
  })

  it('a sweep from before this objective was created did not cover it', async () => {
    owner()
    db.tables.objective_profiles[0].created_at = hoursAgo(1)
    db.tables.profiles = [{ id: 'user-1', account_type: 'beta', last_sweep_at: hoursAgo(48) }]
    const sweep = sweepOf(await StrikePage({ params: { id: 'prof-1' } }))
    expect(sweep.latestDataAt).toBeNull()
    expect(sweep.lastSweepAt).not.toBeNull()
  })
})
