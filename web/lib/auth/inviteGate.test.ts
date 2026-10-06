import { describe, it, expect } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { isEmailInvited, normalizeInviteEmail } from './inviteGate'

const asDb = (d: FakeDb) => d as unknown as Parameters<typeof isEmailInvited>[0]

function invites() {
  return new FakeDb({ allowed_emails: [{ email: 'ghostnet5x5@gmail.com', invited_by: 'founder' }] })
}

describe('isEmailInvited', () => {
  it('matches an invited email regardless of case and surrounding space', async () => {
    expect(await isEmailInvited(asDb(invites()), 'GhostNet5x5@Gmail.com')).toBe(true)
    expect(await isEmailInvited(asDb(invites()), '  ghostnet5x5@gmail.com ')).toBe(true)
  })

  it('refuses an email that is not on the list', async () => {
    expect(await isEmailInvited(asDb(invites()), 'stranger@example.com')).toBe(false)
  })

  it('refuses an empty email', async () => {
    expect(await isEmailInvited(asDb(invites()), '   ')).toBe(false)
  })

  it('fails closed when the lookup errors', async () => {
    const d = invites()
    const realFrom = d.from.bind(d)
    d.from = ((table: string) => table === 'allowed_emails'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }
      : realFrom(table)) as typeof d.from
    expect(await isEmailInvited(asDb(d), 'ghostnet5x5@gmail.com')).toBe(false)
  })

  it('normalizes to lowercase', () => {
    expect(normalizeInviteEmail(' A@B.COM ')).toBe('a@b.com')
  })
})
