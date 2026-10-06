import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikeBriefPanel from '@/components/strike/StrikeBriefPanel'
import { hasStoredBrief } from '@/lib/strike/briefFreshness'
import { GET } from './route'

// Refresh path (partner_key=strike): the route reads the stored row and must report its created_at.
const rows: Record<string, unknown> = {}

// FF-092: the route needs a session, and the objective must belong to that user.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } }),
  createServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
      return chain
    },
  }),
}))
vi.mock('@/lib/objectives/objectiveWindow', () => ({
  loadObjectiveWindow: async () => null,
  isEndedState: () => false,
}))
vi.mock('@/lib/mip/briefPayload', () => ({ getMipBriefPayload: async () => ({ payload: null, notFound: true }) }))


const HOUR = 3600_000
const get = () => GET(new Request('http://localhost/api/mip/brief?objective_id=OBJ-1&partner_key=strike'))

beforeEach(() => {
  rows.objective_profiles = { id: 'PROF-1', objective_id: 'OBJ-1', user_id: 'user-1', taxonomy_key: 'elk.bull.archery', geo: {}, timing: {} }
  rows.strike_briefs = null
})

describe('GET /api/mip/brief partner_key=strike: brief_generated_at', () => {
  it('reports the stored brief time (40 h ago), not the refresh time', async () => {
    const createdAt = new Date(Date.now() - 40 * HOUR).toISOString()
    rows.strike_briefs = {
      created_at: createdAt, brief_date: '2026-10-03', go_no_go: 'GO', confidence_tier: 'T1',
      synthesis: 'Hold the north side.', lead_signal: 'Fresh tracks',
      movement_windows: [{ time: '06:00', reason: 'Glass the bench', probability: 0.8, confidence_tier: 'T1' }],
      agent_hits: [],
    }
    const json = await (await get()).json()
    expect(json.brief_generated_at).toBe(createdAt)
    expect(json.time_windows).toHaveLength(1)
  })

  it('after a refresh, an active hunt still shows the stale note', async () => {
    rows.strike_briefs = {
      created_at: new Date(Date.now() - 40 * HOUR).toISOString(), brief_date: '2026-10-03', go_no_go: 'GO',
      confidence_tier: 'T1', synthesis: 'x', movement_windows: [{ time: '06:00', reason: 'r', probability: 0.8 }], agent_hits: [],
    }
    const json = await (await get()).json()
    const html = renderToStaticMarkup(
      createElement(StrikeBriefPanel, { brief: json, isOnline: true, onRefresh: async () => 'same' as const, windowState: 'active' })
    )
    expect(html).not.toContain('just now')
    expect(html).toMatch(/Updated 1d ago \(/)
    expect(html).toContain('This brief is 40 h old; the next sweep updates it.')
  })

  it('no brief row: the stub has time_windows null, so the client treats it as no brief', async () => {
    const before = Date.now()
    const json = await (await get()).json()
    expect(json.time_windows).toBeNull()
    expect(hasStoredBrief(json)).toBe(false)
    expect(Date.parse(json.brief_generated_at)).toBeGreaterThanOrEqual(before)
  })
})
