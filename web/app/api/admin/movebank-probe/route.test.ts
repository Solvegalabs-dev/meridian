import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from './route'

describe('GET /api/admin/movebank-probe', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'super-secret-password'
  })

  it('returns 401 with no Authorization header, and never leaks the password', async () => {
    const req = new Request('https://example.com/api/admin/movebank-probe')
    const res = await GET(req)
    const bodyText = await res.text()

    expect(res.status).toBe(401)
    expect(JSON.parse(bodyText)).toEqual({ error: 'Unauthorized' })
    expect(bodyText).not.toContain('super-secret-password')
    expect(bodyText).not.toContain('testuser')
  })

  it('returns 401 with an incorrect bearer token', async () => {
    const req = new Request('https://example.com/api/admin/movebank-probe', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
