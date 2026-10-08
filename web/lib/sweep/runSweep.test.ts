// FF-098: the shared Run Sweep action. Mission Control and Strike both go through executeSweep.
import { describe, it, expect, vi } from 'vitest'
import { executeSweep, formatLastSweep, formatNextSweep, isRateLimited, type SweepHandlers } from './runSweep'

function handlers() {
  const calls: string[] = []
  const h: SweepHandlers = {
    onRateLimited: vi.fn(next => { calls.push(`limited:${next}`) }),
    onError: vi.fn(msg => { calls.push(`error:${msg}`) }),
    onSuccess: vi.fn(() => { calls.push('success') }),
    reload: vi.fn(() => { calls.push('reload') }),
  }
  return { h, calls }
}

const respond = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch

describe('executeSweep', () => {
  it('posts an empty JSON body to /api/sweep', async () => {
    const { h } = handlers()
    const fetchImpl = respond(200, { sweep_id: 's1' })
    await executeSweep(h, fetchImpl)

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sweep')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('on success reports the result, then refreshes the page', async () => {
    const { h, calls } = handlers()
    await executeSweep(h, respond(200, { sweep_id: 's1' }))
    expect(calls).toEqual(['success', 'reload'])
    expect(h.onSuccess).toHaveBeenCalledWith({ sweep_id: 's1' })
  })

  it('a 429 with next_sweep_at is the rate-limited state, with no error and no refresh', async () => {
    const { h, calls } = handlers()
    await executeSweep(h, respond(429, { error: 'rate_limited', next_sweep_at: '2026-10-09T12:00:00.000Z' }))
    expect(calls).toEqual(['limited:2026-10-09T12:00:00.000Z'])
  })

  it('a 429 without a time shows the server text as an error', async () => {
    const { h, calls } = handlers()
    await executeSweep(h, respond(429, { error: 'rate_limited' }))
    expect(calls).toEqual(['error:rate_limited'])
  })

  it('other failures show the server text, or "Sweep failed", and do not refresh', async () => {
    const a = handlers()
    await executeSweep(a.h, respond(400, { error: 'No active objectives found' }))
    expect(a.calls).toEqual(['error:No active objectives found'])

    const b = handlers()
    await executeSweep(b.h, respond(500, {}))
    expect(b.calls).toEqual(['error:Sweep failed'])
    expect(b.h.reload).not.toHaveBeenCalled()
  })

  it('a network failure shows its message', async () => {
    const { h, calls } = handlers()
    await executeSweep(h, vi.fn(async () => { throw new Error('Failed to fetch') }) as unknown as typeof fetch)
    expect(calls).toEqual(['error:Failed to fetch'])
  })
})

describe('helpers (unchanged from the Mission Control button)', () => {
  const NOW = Date.parse('2026-10-08T12:00:00Z')

  it('isRateLimited is true only for a future time', () => {
    expect(isRateLimited(null, NOW)).toBe(false)
    expect(isRateLimited('2026-10-08T11:00:00Z', NOW)).toBe(false)
    expect(isRateLimited('2026-10-08T13:00:00Z', NOW)).toBe(true)
  })

  it('formats the last sweep age', () => {
    expect(formatLastSweep('2026-10-08T11:45:00Z', NOW)).toBe('Just now')
    expect(formatLastSweep('2026-10-08T07:00:00Z', NOW)).toBe('5h ago')
    expect(formatLastSweep('2026-10-06T12:00:00Z', NOW)).toBe('2d ago')
  })

  it('formats the time until the next sweep', () => {
    expect(formatNextSweep('2026-10-08T11:00:00Z', NOW)).toBe('now')
    expect(formatNextSweep('2026-10-08T12:30:00Z', NOW)).toBe('in 30m')
    expect(formatNextSweep('2026-10-08T14:00:00Z', NOW)).toBe('in 2h')
    expect(formatNextSweep('2026-10-08T14:20:00Z', NOW)).toBe('in 2h 20m')
  })
})
