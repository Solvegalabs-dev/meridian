// FF-092 Part 2: the Strike page is server-rendered. These tests call it directly and check the access gate.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import StrikePage from './page'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'

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
