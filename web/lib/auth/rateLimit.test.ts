import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, partnerRateLimitResponse, resetRateLimitsForTests } from './rateLimit'

beforeEach(() => resetRateLimitsForTests())

const partner = { partnerId: 'partner-bm', slug: 'basemaps', ownerUserId: 'svc', rateLimitPerMin: 2 }

describe('checkRateLimit', () => {
  it('allows up to the limit in one window, then refuses with Retry-After', () => {
    expect(checkRateLimit('k', 2, 0)).toEqual({ ok: true })
    expect(checkRateLimit('k', 2, 1_000)).toEqual({ ok: true })
    const third = checkRateLimit('k', 2, 2_000)
    expect(third).toEqual({ ok: false, retryAfterSec: 58 })
  })

  it('resets when the window ends', () => {
    checkRateLimit('k', 1, 0)
    expect(checkRateLimit('k', 1, 10_000).ok).toBe(false)
    expect(checkRateLimit('k', 1, 60_000)).toEqual({ ok: true })
  })

  it('counts each key separately', () => {
    checkRateLimit('a', 1, 0)
    expect(checkRateLimit('b', 1, 0)).toEqual({ ok: true })
  })
})

describe('partnerRateLimitResponse', () => {
  it('returns null under the limit', () => {
    expect(partnerRateLimitResponse(partner, 0)).toBeNull()
  })

  it('returns 429 with Retry-After over the limit, and names no key or user', async () => {
    partnerRateLimitResponse(partner, 0)
    partnerRateLimitResponse(partner, 0)
    const res = partnerRateLimitResponse(partner, 0)
    expect(res?.status).toBe(429)
    expect(res?.headers.get('Retry-After')).toBe('60')
    const body = await res!.json()
    expect(JSON.stringify(body)).not.toContain('partner-bm')
  })
})
