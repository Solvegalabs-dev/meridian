import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { GET } from './route'

// Part D: ended hunts are transitioned by the lifecycle before their briefs are written.
const lifecycle = vi.fn()
const generate = vi.fn()
let transitioned = false

vi.mock('@/lib/objectives/objectiveWindow', () => ({
  applyWindowLifecycleForUser: (...args: unknown[]) => lifecycle(...args),
}))
vi.mock('@/lib/strikeBrief/strikeBriefGenerator', () => ({
  generateStrikeBrief: (...args: unknown[]) => generate(...args),
  LocationNotSetError: class LocationNotSetError extends Error {},
}))

const db = new FakeDb({
  objective_profiles: [
    { objective_id: 'obj-17', user_id: 'user-1', org_source: 'strike', status: 'active' },
    { objective_id: 'eb1002', user_id: 'user-1', org_source: 'strike', status: 'active' },
  ],
})
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))

function request() {
  return new NextRequest('http://localhost/api/cron/strike-brief-push', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret'
  transitioned = false
  lifecycle.mockReset()
  generate.mockReset()
  // Lifecycle marks the ended profiles; the brief generator then sees them as transitioned.
  lifecycle.mockImplementation(async () => { transitioned = true; return new Set(['obj-17']) })
  generate.mockImplementation(async () => {
    if (!transitioned) throw new Error('brief written before lifecycle ran')
    return { id: 'brief' }
  })
})

describe('daily strike cron', () => {
  it('runs the lifecycle once per user before any brief is written', async () => {
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(lifecycle).toHaveBeenCalledTimes(1)
    expect(lifecycle.mock.calls[0][1]).toBe('user-1')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(lifecycle.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0])
  })

  it('a lifecycle failure is logged and the briefs still run', async () => {
    lifecycle.mockImplementation(async () => { throw new Error('boom') })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    generate.mockImplementation(async () => ({ id: 'brief' }))
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(2)
    errSpy.mockRestore()
  })

  it('rejects a request without the cron secret', async () => {
    const res = await GET(new NextRequest('http://localhost/api/cron/strike-brief-push'))
    expect(res.status).toBe(401)
    expect(lifecycle).not.toHaveBeenCalled()
  })
})
