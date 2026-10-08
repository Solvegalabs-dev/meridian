import { describe, it, expect, vi } from 'vitest'
import { checkForNewerBrief, isBriefPayload, refreshMessage } from './briefRefresh'

const OLD = '2026-10-03T06:15:00.000Z'
const NEW = '2026-10-03T12:00:00.000Z'

function brief(over: Record<string, unknown> = {}) {
  return { brief_generated_at: NEW, time_windows: [{ window: '0600–1100' }], summary: 'Hold the north side.', ...over }
}

function okResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response
}

function fetchReturning(res: Response | Error) {
  return vi.fn(async () => {
    if (res instanceof Error) throw res
    return res
  }) as unknown as typeof fetch
}

const run = (fetchFn: typeof fetch, over: Partial<Parameters<typeof checkForNewerBrief>[0]> = {}) =>
  checkForNewerBrief({ objectiveId: 'obj-1', currentGeneratedAt: OLD, online: true, fetchFn, ...over })

describe('isBriefPayload', () => {
  it('accepts a stored brief and the no-brief stub', () => {
    expect(isBriefPayload(brief())).toBe(true)
    expect(isBriefPayload(brief({ time_windows: null }))).toBe(true)
  })

  it('rejects error payloads and malformed shapes', () => {
    expect(isBriefPayload({ error: 'boom' })).toBe(false)
    expect(isBriefPayload(null)).toBe(false)
    expect(isBriefPayload([])).toBe(false)
    expect(isBriefPayload(brief({ time_windows: 'nope' }))).toBe(false)
    expect(isBriefPayload(brief({ brief_generated_at: undefined }))).toBe(false)
    expect(isBriefPayload(brief({ brief_generated_at: 'not a date' }))).toBe(false)
  })
})

describe('checkForNewerBrief', () => {
  it('offline: reports offline without fetching', async () => {
    const fetchFn = fetchReturning(okResponse(brief()))
    const out = await run(fetchFn, { online: false })
    expect(out).toEqual({ result: 'offline' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('same brief_generated_at: reports same and gives no brief to show', async () => {
    const out = await run(fetchReturning(okResponse(brief({ brief_generated_at: OLD }))))
    expect(out.result).toBe('same')
    expect(out.brief).toBeUndefined()
  })

  it('older returned brief counts as same, not new', async () => {
    const out = await run(fetchReturning(okResponse(brief({ brief_generated_at: '2026-10-02T06:00:00.000Z' }))))
    expect(out.result).toBe('same')
  })

  it('newer brief_generated_at: reports new and returns the brief', async () => {
    const payload = brief()
    const out = await run(fetchReturning(okResponse(payload)))
    expect(out.result).toBe('new')
    expect(out.brief).toEqual(payload)
  })

  it('no brief on screen and a stored brief arrives: reports new', async () => {
    const out = await run(fetchReturning(okResponse(brief())), { currentGeneratedAt: null })
    expect(out.result).toBe('new')
  })

  it('stub from the server does not replace a brief on screen', async () => {
    const out = await run(fetchReturning(okResponse(brief({ time_windows: null }))))
    expect(out.result).toBe('same')
    expect(out.brief).toBeUndefined()
  })

  it('error payload (ok response, bad shape): reports error and gives no brief', async () => {
    const out = await run(fetchReturning(okResponse({ error: 'Internal error' })))
    expect(out).toEqual({ result: 'error' })
  })

  it('non-OK response: reports error and gives no brief', async () => {
    const out = await run(fetchReturning({ ok: false, status: 500, json: async () => brief() } as unknown as Response))
    expect(out).toEqual({ result: 'error' })
  })

  it('network failure: reports error', async () => {
    const out = await run(fetchReturning(new TypeError('Failed to fetch')))
    expect(out).toEqual({ result: 'error' })
  })

  it('requests the strike partner for the objective', async () => {
    const fetchFn = fetchReturning(okResponse(brief({ brief_generated_at: OLD })))
    await run(fetchFn)
    expect(fetchFn).toHaveBeenCalledWith('/api/mip/brief?objective_id=obj-1&partner_key=strike')
  })
})

describe('refreshMessage', () => {
  it('offline', () => {
    expect(refreshMessage('offline', OLD)).toBe("You're offline. Showing the saved brief.")
  })

  it('same: names the time of the latest brief', () => {
    const msg = refreshMessage('same', OLD)
    expect(msg).toMatch(/^No newer brief\. The latest is from .+\. Tap Run Sweep for a fresh one\.$/)
    expect(msg).not.toContain('undefined')
  })

  it('same with no generated time: no time clause', () => {
    expect(refreshMessage('same', null)).toBe('No newer brief. Tap Run Sweep for a fresh one.')
  })

  it('new', () => {
    expect(refreshMessage('new', NEW)).toBe('New brief loaded.')
  })

  it('error', () => {
    expect(refreshMessage('error', OLD)).toBe("Couldn't check right now. Try again in a minute.")
  })
})
