import { describe, it, expect, beforeEach, vi } from 'vitest'

const { acquireLeaseMock, releaseLeaseMock, cooldownRemainingMsMock, refreshCatalogMock } = vi.hoisted(() => ({
  acquireLeaseMock: vi.fn(),
  releaseLeaseMock: vi.fn(),
  cooldownRemainingMsMock: vi.fn(),
  refreshCatalogMock: vi.fn(),
}))

vi.mock('@/lib/swarm/agents/outdoor/collar/lease', () => ({
  acquireLease: acquireLeaseMock,
  releaseLease: releaseLeaseMock,
  cooldownRemainingMs: cooldownRemainingMsMock,
}))

vi.mock('@/lib/swarm/agents/outdoor/collar/catalog', () => ({
  refreshCatalog: refreshCatalogMock,
}))

import { GET } from './route'

describe('GET /api/cron/movebank-catalog', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    acquireLeaseMock.mockReset().mockResolvedValue(true)
    releaseLeaseMock.mockReset()
    cooldownRemainingMsMock.mockReset().mockResolvedValue(0)
    refreshCatalogMock.mockReset().mockResolvedValue({ studiesFetched: 10, rawRowCount: 10, responseBytes: 100, truncated: false, batchesUpserted: 1 })
  })

  it('returns 401 without the bearer token', async () => {
    const req = new Request('https://example.com/api/cron/movebank-catalog')
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(acquireLeaseMock).not.toHaveBeenCalled()
  })

  it('skips when a cooldown is active, without acquiring the lease', async () => {
    cooldownRemainingMsMock.mockResolvedValue(30000)
    const req = new Request('https://example.com/api/cron/movebank-catalog', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const res = await GET(req)
    const body = await res.json()

    expect(body.skipped).toBe(true)
    expect(acquireLeaseMock).not.toHaveBeenCalled()
  })

  it('skips when the lease is held by another worker', async () => {
    acquireLeaseMock.mockResolvedValue(false)
    const req = new Request('https://example.com/api/cron/movebank-catalog', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const res = await GET(req)
    const body = await res.json()

    expect(body.skipped).toBe(true)
    expect(refreshCatalogMock).not.toHaveBeenCalled()
  })

  it('refreshes the catalog and always releases the lease, even on failure', async () => {
    const req = new Request('https://example.com/api/cron/movebank-catalog', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const res = await GET(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.studiesFetched).toBe(10)
    expect(releaseLeaseMock).toHaveBeenCalledWith('movebank-catalog-cron')
  })

  it('releases the lease even when refreshCatalog throws', async () => {
    refreshCatalogMock.mockRejectedValue(new Error('boom'))
    const req = new Request('https://example.com/api/cron/movebank-catalog', { headers: { Authorization: 'Bearer test-cron-secret' } })
    const res = await GET(req)

    expect(res.status).toBe(502)
    expect(releaseLeaseMock).toHaveBeenCalledWith('movebank-catalog-cron')
  })
})
