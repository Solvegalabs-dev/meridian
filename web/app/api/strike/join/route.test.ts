import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { POST } from './route'

let db: FakeDb
let createUserMock: ReturnType<typeof vi.fn>
let createUserResult: { data: { user: { id: string } | null }; error: { message: string; code?: string } | null }

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => Object.assign(db, { auth: { admin: { createUser: createUserMock } } }),
}))

const CODE = 'STRIKE-ABC123'
const NEW_USER_ID = 'user-new-1'

function seed(overrides: Record<string, unknown> = {}) {
  db = new FakeDb({
    invite_codes: [
      {
        id: 'code-1',
        code: CODE,
        cohort: 'strike',
        status: 'unused',
        use_count: 0,
        expires_at: null,
        redeemed_by: null,
        ...overrides,
      },
    ],
    allowed_emails: [],
  })
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    displayName: 'Friend Tester',
    email: 'Friend@Example.com',
    password: 'password123',
    website: '',
    ...overrides,
  }
}

function req(b: unknown) {
  return new NextRequest('http://localhost/api/strike/join', {
    method: 'POST',
    body: JSON.stringify(b),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  seed()
  createUserResult = { data: { user: { id: NEW_USER_ID } }, error: null }
  createUserMock = vi.fn(async () => createUserResult)
})

describe('POST /api/strike/join: happy path', () => {
  it('creates the user, grants access, and claims the code', async () => {
    const res = await POST(req(body()))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)

    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({
      email: 'friend@example.com',
      password: 'password123',
      email_confirm: true,
      user_metadata: { display_name: 'Friend Tester' },
      app_metadata: { signup_source: 'strike' },
    }))

    const code = db.tables.invite_codes[0]
    expect(code.status).toBe('redeemed')
    expect(code.use_count).toBe(1)
    expect(code.redeemed_by).toBe(NEW_USER_ID)
    expect(code.redeemed_at).toBeTruthy()

    const allowed = db.tables.allowed_emails[0]
    expect(allowed.email).toBe('friend@example.com')
    expect(allowed.invited_by).toBe(`code:${CODE}`)
  })

  it('stores and matches the email lowercase regardless of input casing', async () => {
    await POST(req(body({ email: 'WEIRD.Case@Example.COM' })))
    expect(db.tables.allowed_emails[0].email).toBe('weird.case@example.com')
  })

  it('normalizes a lowercase or whitespace-padded code', async () => {
    const res = await POST(req(body({ code: `  ${CODE.toLowerCase()}  ` })))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/strike/join: bad codes all look the same', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['unknown code', { code: 'NOPE-DOES-NOT-EXIST' }],
  ]

  it.each(cases)('%s returns the generic invalid_code 400', async (_label, overrides) => {
    const res = await POST(req(body(overrides)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('an already-used code returns invalid_code', async () => {
    seed({ status: 'redeemed' })
    const res = await POST(req(body()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
  })

  it('an expired code returns invalid_code', async () => {
    seed({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const res = await POST(req(body()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
  })

  it('a code from the wrong cohort returns invalid_code', async () => {
    seed({ cohort: 'arc' })
    const res = await POST(req(body()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
  })

  it('none of these write anything', async () => {
    seed({ status: 'redeemed' })
    await POST(req(body()))
    expect(db.tables.allowed_emails).toHaveLength(0)
  })
})

describe('POST /api/strike/join: duplicate email', () => {
  it('returns 409 and releases the code', async () => {
    createUserResult = { data: { user: null }, error: { message: 'A user with this email address has already been registered' } }
    const res = await POST(req(body()))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('account_exists')

    const code = db.tables.invite_codes[0]
    expect(code.status).toBe('unused')
    expect(code.use_count).toBe(0)
    expect(code.redeemed_at).toBeNull()
    expect(db.tables.allowed_emails).toHaveLength(0)
  })
})

describe('POST /api/strike/join: other createUser failure', () => {
  it('returns 500 and releases the code', async () => {
    createUserResult = { data: { user: null }, error: { message: 'service unavailable' } }
    const res = await POST(req(body()))
    expect(res.status).toBe(500)

    const code = db.tables.invite_codes[0]
    expect(code.status).toBe('unused')
    expect(code.use_count).toBe(0)
  })
})

describe('POST /api/strike/join: honeypot', () => {
  it('a filled honeypot is a quiet success with no side effects', async () => {
    const res = await POST(req(body({ website: 'http://spam.example' })))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(createUserMock).not.toHaveBeenCalled()
    expect(db.tables.invite_codes[0].status).toBe('unused')
    expect(db.tables.allowed_emails).toHaveLength(0)
  })
})

describe('POST /api/strike/join: validation', () => {
  it('rejects a password under 8 characters', async () => {
    const res = await POST(req(body({ password: 'short' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_password')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('rejects a password over 72 characters', async () => {
    const res = await POST(req(body({ password: 'x'.repeat(73) })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_password')
  })

  it('rejects a missing or blank display name', async () => {
    const res = await POST(req(body({ displayName: '   ' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_display_name')
  })

  it('rejects a display name over 60 characters', async () => {
    const res = await POST(req(body({ displayName: 'x'.repeat(61) })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_display_name')
  })

  it('rejects a malformed email', async () => {
    const res = await POST(req(body({ email: 'not-an-email' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_email')
  })

  it('rejects a missing code', async () => {
    const res = await POST(req(body({ code: '' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
  })
})
