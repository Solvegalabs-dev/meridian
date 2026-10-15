// FF-105B Fix 2: a new objective's own assigned agents run once, right after creation.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { runAgent } from './agentRunner'
import { runAgentsForObjective } from './runAgentsForObjective'

vi.mock('./agentRunner', () => ({ runAgent: vi.fn(async () => ({ agentKey: 'x', result: 'miss', durationMs: 1 })) }))

let db: FakeDb

beforeEach(() => {
  vi.mocked(runAgent).mockClear()
  db = new FakeDb({
    objective_profiles: [{ objective_id: 'obj-1', assigned_agents: ['AGENT_A', 'AGENT_B'], state: 'UT', county: 'Daggett' }],
    agent_configs: [
      { agent_key: 'AGENT_A', domain: 'fishing', geo_scope: ['UT'], source_url_template: 'https://a', is_active: true },
      { agent_key: 'AGENT_B', domain: 'fishing', geo_scope: ['UT'], source_url_template: 'https://b', is_active: true },
      { agent_key: 'AGENT_C', domain: 'fishing', geo_scope: ['UT'], source_url_template: 'https://c', is_active: true },
    ],
  })
})

describe('runAgentsForObjective', () => {
  it('runs only the agents assigned to this objective, sequentially, with its own geography', async () => {
    await runAgentsForObjective(db as never, 'obj-1')

    expect(runAgent).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runAgent).mock.calls[0][0]).toBe('AGENT_A')
    expect(vi.mocked(runAgent).mock.calls[0][1]).toMatchObject({ state: 'UT', county: 'Daggett', objectiveId: 'obj-1' })
    expect(vi.mocked(runAgent).mock.calls[1][0]).toBe('AGENT_B')
    // AGENT_C is not assigned to this objective, so it never runs.
    expect(vi.mocked(runAgent).mock.calls.map(c => c[0])).not.toContain('AGENT_C')
  })

  it('runs nothing for an objective with no assigned agents', async () => {
    db.tables.objective_profiles = [{ objective_id: 'obj-2', assigned_agents: [], state: 'UT', county: null }]
    await runAgentsForObjective(db as never, 'obj-2')
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('runs nothing for an objective with no profile row', async () => {
    await runAgentsForObjective(db as never, 'missing-objective')
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('swallows a lookup failure and never throws', async () => {
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => {
      if (table === 'objective_profiles') throw new Error('connection reset')
      return realFrom(table)
    }) as typeof db.from

    await expect(runAgentsForObjective(db as never, 'obj-1')).resolves.toBeUndefined()
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('never lets a rejected agent run escape to the caller (same resilience as the cron, which also has no per-run try/catch)', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('timeout'))
    await expect(runAgentsForObjective(db as never, 'obj-1')).resolves.toBeUndefined()
  })
})
