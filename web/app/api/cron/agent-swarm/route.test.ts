// FF-106 Stage 2 Part A: cadence gating in the agent swarm cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fakeSupabase'

const runAgentCalls: Array<{ agentKey: string; context: Record<string, unknown> }> = []

vi.mock('@/lib/agents/agentRunner', () => ({
  runAgent: vi.fn(async (agentKey: string, context: Record<string, unknown>) => {
    runAgentCalls.push({ agentKey, context })
    return { result: 'hit', agent: agentKey }
  }),
}))

vi.mock('@/lib/agents/agentContextResolver', () => ({
  resolveAgentParams: vi.fn((input: unknown, ctx: unknown) => ({ ...(ctx as object) })),
}))

let agentConfigs: Array<Record<string, unknown>> = []
let objectiveProfiles: Array<Record<string, unknown>> = []
let huntSeasons: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fakeSupabase((call) => {
    if (call.table === 'agent_configs') return { data: agentConfigs }
    if (call.table === 'objective_profiles') return { data: objectiveProfiles }
    if (call.table === 'hunt_seasons') return { data: huntSeasons }
    return { data: [] }
  }),
}))

const AUTH = { authorization: `Bearer ${process.env.CRON_SECRET ?? 'test-secret'}` }

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret'
  runAgentCalls.length = 0
  agentConfigs = []
  objectiveProfiles = []
  huntSeasons = []
})

// Days-from-today trip_start/trip_end so focus buckets are exercised without faking the clock.
function daysFromNow(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function profile(overrides: Record<string, unknown>) {
  return {
    id: overrides.id ?? 'prof-1',
    objective_id: overrides.objective_id ?? 'obj-1',
    user_id: 'u1',
    status: 'active',
    timing: {},
    taxonomy_key: 'elk.bull.archery',
    state: 'UT',
    lat: 40.0,
    lon: -111.0,
    hunt_unit_id: null,
    hunt_code: null,
    domain: 'hunting',
    ended_at: null,
    ended_reason: null,
    assigned_agents: ['AGENT_A'],
    county: 'Duchesne',
    org_source: 'strike',
    ...overrides,
  }
}

async function callRoute() {
  const { GET } = await import('./route')
  const res = await GET(new Request('http://localhost/x', { headers: AUTH }))
  return { res, body: await res.json() }
}

describe('agent-swarm cadence gating', () => {
  it('401s with no/bad bearer', async () => {
    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/x'))
    expect(res.status).toBe(401)
  })

  it('a radar-focus Strike profile is skipped at hour 12 and runs at hour 6', async () => {
    agentConfigs = [{ agent_key: 'AGENT_A', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    objectiveProfiles = [profile({ timing: { trip_start: daysFromNow(150) } })] // radar bucket (90 < days <= 180)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 12, 0, 0))) // hour 12
      const { body } = await callRoute()
      expect(runAgentCalls.length).toBe(0)
      expect(body.skipped.radar).toBe(1)

      runAgentCalls.length = 0
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 6, 0, 0))) // hour 6
      const { body: body2 } = await callRoute()
      expect(runAgentCalls.length).toBe(1)
      expect(body2.skipped.radar).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an ended Strike profile never runs', async () => {
    agentConfigs = [{ agent_key: 'AGENT_A', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    objectiveProfiles = [profile({ timing: { trip_start: '2020-01-01', trip_end: '2020-01-10' } })]
    const { body } = await callRoute()
    expect(runAgentCalls.length).toBe(0)
    expect(body.skipped.ended).toBe(1)
  })

  it('a non-Strike profile always runs, every cycle', async () => {
    agentConfigs = [{ agent_key: 'AGENT_A', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    objectiveProfiles = [profile({ org_source: 'arc', timing: { trip_start: daysFromNow(400) } })]
    const { body } = await callRoute()
    expect(runAgentCalls.length).toBe(1)
    expect(body.skipped).toEqual({ radar: 0, next_year: 0, ended: 0 })
  })

  it('fails open when the batched window evaluation throws: every Strike profile runs as today', async () => {
    agentConfigs = [{ agent_key: 'AGENT_A', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    // A non-string taxonomy_key makes evaluateProfilesWindow's species extraction throw (key.toLowerCase()).
    objectiveProfiles = [profile({ taxonomy_key: 12345 as unknown as string, timing: { trip_start: daysFromNow(150) } })]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { body } = await callRoute()
    expect(runAgentCalls.length).toBe(1)
    expect(body.ran).toBe(1)
    expect(errSpy).toHaveBeenCalledWith('[agent-swarm] focus evaluation failed', expect.any(String))
    errSpy.mockRestore()
  })

  it('an agent assigned to no objective still gets its FF-071 fallback run', async () => {
    agentConfigs = [{ agent_key: 'AGENT_NONE', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    objectiveProfiles = []
    const { body } = await callRoute()
    expect(runAgentCalls.length).toBe(1)
    expect(runAgentCalls[0].context.objectiveId).toBeUndefined()
    expect(body.ran).toBe(1)
  })

  it('an agent whose only assigned profile is gated out this cycle is skipped, with no fallback run', async () => {
    agentConfigs = [{ agent_key: 'AGENT_A', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    objectiveProfiles = [profile({ timing: { trip_start: daysFromNow(150) } })] // radar
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 12, 0, 0))) // not hour 6: radar skipped
      const { body } = await callRoute()
      expect(runAgentCalls.length).toBe(0)
      expect(body.ran).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('now and prep profiles collect every cycle', async () => {
    agentConfigs = [{ agent_key: 'AGENT_A', domain: 'hunting', geo_scope: ['UT', ''], source_url_template: '' }]
    objectiveProfiles = [profile({ id: 'p-now', objective_id: 'obj-now', timing: { trip_start: daysFromNow(5) } })]
    const { body } = await callRoute()
    expect(runAgentCalls.length).toBe(1)
    expect(body.ran).toBe(1)
  })
})
