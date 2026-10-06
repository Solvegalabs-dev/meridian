// FF-092 Part 2.3: the Strike layout gates on the invite list. Signed-out users fall through to each page's own login redirect.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import StrikeLayout from './layout'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'

let db: FakeDb
let sessionUser: { id: string; email?: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))

const CHILD = 'child-page'

beforeEach(() => {
  sessionUser = null
  db = new FakeDb({ allowed_emails: [{ email: 'invited@example.com', invited_by: 'founder' }] })
})

async function render() {
  return (await StrikeLayout({ children: CHILD as unknown as React.ReactNode })) as { type: unknown; props: { children?: unknown } }
}

describe('Strike layout invite gate', () => {
  it('an invited user gets the page', async () => {
    sessionUser = { id: 'u1', email: 'Invited@example.com' }
    const result = await render()
    expect(result.type).not.toBe(InviteOnlyScreen)
    expect(result.props.children).toBe(CHILD)
  })

  it('a user who is not invited gets the invite-only screen and not the page', async () => {
    sessionUser = { id: 'u2', email: 'stranger@example.com' }
    const result = await render()
    expect(result.type).toBe(InviteOnlyScreen)
    expect(JSON.stringify(result)).not.toContain(CHILD)
  })

  it('a session with no email is not invited', async () => {
    sessionUser = { id: 'u3' }
    expect((await render()).type).toBe(InviteOnlyScreen)
  })

  it('fails closed when the invite lookup errors', async () => {
    sessionUser = { id: 'u1', email: 'invited@example.com' }
    const realFrom = db.from.bind(db)
    db.from = ((t: string) => t === 'allowed_emails'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }
      : realFrom(t)) as typeof db.from
    expect((await render()).type).toBe(InviteOnlyScreen)
  })

  it('a signed-out user passes through, so the page can send them to login', async () => {
    const result = await render()
    expect(result.type).not.toBe(InviteOnlyScreen)
    expect(result.props.children).toBe(CHILD)
  })
})
