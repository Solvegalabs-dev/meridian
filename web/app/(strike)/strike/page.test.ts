// FF-092 Part 2.3: the /strike campaign list reads the user's campaigns, so it repeats the invite check itself.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import StrikePage from './page'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'

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
vi.mock('@/lib/objectives/objectiveWindow', () => ({
  PROFILE_WINDOW_COLUMNS: 'objective_id',
  evaluateProfilesWindow: vi.fn(async () => new Map()),
}))

beforeEach(() => {
  sessionUser = null
  db = new FakeDb({
    allowed_emails: [{ email: 'invited@example.com', invited_by: 'founder' }],
    hunt_campaigns: [{ id: 'c1', user_id: 'u1', name: 'Fall elk', status: 'active', taxonomy_key: 'elk.bull.archery', season_year: 2026, campaign_units: [] }],
  })
})

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
