import { describe, it, expect, beforeEach, vi } from 'vitest'

const { acquireLeaseMock, releaseLeaseMock, cooldownRemainingMsMock, runOneJobMock } = vi.hoisted(() => ({
  acquireLeaseMock: vi.fn(),
  releaseLeaseMock: vi.fn(),
  cooldownRemainingMsMock: vi.fn(),
  runOneJobMock: vi.fn(),
}))

vi.mock('@/lib/swarm/agents/outdoor/collar/lease', () => ({
  acquireLease: acquireLeaseMock,
  releaseLease: releaseLeaseMock,
  cooldownRemainingMs: cooldownRemainingMsMock,
}))

vi.mock('@/lib/swarm/agents/outdoor/collar/jobRunner', () => ({
  runOneJob: runOneJobMock,
}))

import { GET } from './route'

describe('GET /api/cron/collar-worker', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    acquireLeaseMock.mockReset().mockResolvedValue(true)
    releaseLeaseMock.mockReset()
    cooldownRemainingMsMock.mockReset().mockResolvedValue(0)
    runOneJobMock.mockReset().mockResolvedValue({ ran: true, jobId: 'job-1', status: 'done' })
  })

  it('returns 401 without the bearer token, and never echoes credentials', async () => {
    process.env.MOVEBANK_USERNAME = 'realuser'
    process.env.MOVEBANK_PASSWORD = 'realpass'
    const req = new Request('https://example.com/api/cron/collar-worker')
    const res = await GET(req)
    const bodyText = await res.text()

    expect(res.status).toBe(401)
    expect(bodyText).not.toContain('realuser')
    expect(bodyText).not.toContain('realpass')
    expect(acquireLeaseMock).not.toHaveBeenCalled()
  })

  it('returns 401 with an incorrect bearer token', async () => {
    const req = new Request('https://example.com/api/cron/collar-worker', { headers: { Authorization: 'Bearer wrong' } })
    expect((await GET(req)).status).toBe(401)
  })

  it('skips when a cooldown is active, without acquiring the lease or running a job', async () => {
    cooldownRemainingMsMock.mockResolvedValue(60000)
    const req = new Request('https://example.com/api/cron/collar-worker', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const body = await (await GET(req)).json()

    expect(body.skipped).toBe(true)
    expect(acquireLeaseMock).not.toHaveBeenCalled()
    expect(runOneJobMock).not.toHaveBeenCalled()
  })

  it('skips when the lease is held by another worker', async () => {
    acquireLeaseMock.mockResolvedValue(false)
    const req = new Request('https://example.com/api/cron/collar-worker', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const body = await (await GET(req)).json()

    expect(body.skipped).toBe(true)
    expect(runOneJobMock).not.toHaveBeenCalled()
  })

  it('runs one job and always releases the lease afterward', async () => {
    const req = new Request('https://example.com/api/cron/collar-worker', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const body = await (await GET(req)).json()

    expect(body).toEqual({ ran: true, jobId: 'job-1', status: 'done' })
    expect(releaseLeaseMock).toHaveBeenCalledWith('collar-worker-cron')
  })

  it('releases the lease even when runOneJob throws', async () => {
    runOneJobMock.mockRejectedValue(new Error('boom'))
    const req = new Request('https://example.com/api/cron/collar-worker', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const res = await GET(req)

    expect(res.status).toBe(502)
    expect(releaseLeaseMock).toHaveBeenCalledWith('collar-worker-cron')
  })
})
