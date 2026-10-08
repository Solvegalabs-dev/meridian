// FF-096b: StrikeBriefClient passes no hunt number to the header for a fishing objective, even when a stale
// one is on the row. Child panels are stubbed: only the header output matters here.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikeBriefClient from './StrikeBriefClient'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/hooks/useStrikeCache', () => ({ useStrikeCache: () => ({ cachedBrief: null, cacheBrief: vi.fn() }) }))
vi.mock('./StrikePrepPanel', () => ({ default: () => null }))
vi.mock('./StrikeBriefPanel', () => ({ default: () => null }))
vi.mock('./StrikeIntelPanel', () => ({ default: () => null }))
vi.mock('./StrikeSignalsPanel', () => ({ default: () => null }))
vi.mock('./StrikeNotesPanel', () => ({ default: () => null }))
vi.mock('./OfflineBanner', () => ({ default: () => null }))

const base = {
  id: 'prof-1',
  objective_id: 'arc-1',
  geo: {},
  timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' },
  assigned_agents: [],
  agent_build_status: 'ready',
  hunt_code: 'EA2004',
}

const render = (objective: Record<string, unknown>) => renderToStaticMarkup(
  <StrikeBriefClient
    brief={{}}
    objective={objective as never}
    title="Green River opener"
    hasBrief={false}
    evaluation={null}
  />,
)

describe('StrikeBriefClient header', () => {
  it('shows no hunt number for a fishing objective', () => {
    const html = render({ ...base, taxonomy_key: 'trout.rainbow.fly_fishing', domain: 'fishing' })
    expect(html).toContain('Green River opener')
    expect(html).not.toContain('EA2004')
  })

  it('shows the hunt number for a hunting objective', () => {
    const html = render({ ...base, taxonomy_key: 'elk.bull.archery', domain: 'elk' })
    expect(html).toContain('EA2004')
  })
})
