// Per-partner fixed-window rate limit (FF-092 Part 3.6).
// LIMITATION: the counters live in this process's memory. On serverless each instance counts on
// its own, so the real ceiling is the limit times the number of warm instances. This stops a runaway
// client. It is not a billing-grade limiter. Move the counter to a shared store before relying on it.
import { NextResponse } from 'next/server'
import type { PartnerContext } from '@/lib/auth/partnerAuth'

const WINDOW_MS = 60_000
const MAX_TRACKED_KEYS = 10_000

type Bucket = { windowStart: number; count: number }
const buckets = new Map<string, Bucket>()

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number }

export function checkRateLimit(key: string, limitPerMin: number, now: number = Date.now()): RateLimitResult {
  if (buckets.size > MAX_TRACKED_KEYS) pruneExpired(now)

  let bucket = buckets.get(key)
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { windowStart: now, count: 0 }
    buckets.set(key, bucket)
  }

  bucket.count += 1
  if (bucket.count <= limitPerMin) return { ok: true }

  const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000))
  return { ok: false, retryAfterSec }
}

// Returns a 429 with Retry-After when the partner is over its limit, otherwise null.
// The response names no key and no partner user. It says only which limit applies.
export function partnerRateLimitResponse(partner: PartnerContext, now?: number): NextResponse | null {
  const result = checkRateLimit(`partner:${partner.partnerId}`, partner.rateLimitPerMin, now)
  if (result.ok) return null
  return NextResponse.json(
    { error: 'Rate limit exceeded. Retry after the time in Retry-After.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } },
  )
}

function pruneExpired(now: number): void {
  buckets.forEach((bucket, key) => {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key)
  })
}

// Test helper. Clears all counters.
export function resetRateLimitsForTests(): void {
  buckets.clear()
}
