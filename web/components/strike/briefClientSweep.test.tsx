// FF-098: the Run Sweep button is in the Strike page header, on every tab, and the tabs point at it.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikeBriefClient from './StrikeBriefClient'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/hooks/useStrikeCache', () => ({ useStrikeCache: () => ({ cachedBrief: null, cacheBrief: vi.fn() }) }))

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const objective = {
  id: 'prof-1',
  objective_id: 'arc-1',
  taxonomy_key: 'trout.rainbow.fly_fishing',
  domain: 'fishing',
  geo: {},
  timing: { trip_start: '2027-01-01', trip_end: '2027-01-10' },
  assigned_agents: [],
  agent_build_status: 'ready',
  // A location, so the Brief tab is about sweeps, not about adding a spot.
  lat: 40.1, lon: -111.0, nws_grid_office: 'SLC', nws_grid_x: 1, nws_grid_y: 2,
}

type Sweep = { lastSweepAt: string | null; nextSweepAt: string | null; latestDataAt: string | null }
const NONE: Sweep = { lastSweepAt: null, nextSweepAt: null, latestDataAt: null }

const render = (over: { brief?: Record<string, unknown>; sweep?: Sweep; evaluation?: unknown; objective?: Record<string, unknown> } = {}) =>
  renderToStaticMarkup(
    <StrikeBriefClient
      brief={over.brief ?? { time_windows: null }}
      objective={(over.objective ?? objective) as never}
      title="Green River opener"
      hasBrief={false}
      evaluation={(over.evaluation ?? null) as never}
      sweep={over.sweep ?? NONE}
    />,
  )

describe('header', () => {
  it('has the Run Sweep button with its scope line', () => {
    const html = render()
    expect(html).toContain('>Run Sweep<')
    expect(html).toContain('Checks all your active objectives')
  })

  it('the button is there on the Prep tab too (an upcoming hunt opens on Prep)', () => {
    const html = render({ evaluation: { state: 'upcoming', detail: { code: 'trip_not_started', trip_start: '2027-01-01' } } })
    expect(html).toContain('Objective details') // the Prep tab is showing
    expect(html).toContain('>Run Sweep<')
  })

  it('shows the last sweep age beside it', () => {
    expect(render({ sweep: { lastSweepAt: ago(2), nextSweepAt: null, latestDataAt: null } })).toContain('Last sweep: 2d ago')
  })

  it('shows the 23-hour state when the server says the next sweep is not allowed yet', () => {
    const next = new Date(Date.now() + 4 * 60 * 60 * 1000 + 30_000).toISOString()
    const html = render({ sweep: { lastSweepAt: ago(0.8), nextSweepAt: next, latestDataAt: ago(0.8) } })
    expect(html).toMatch(/Next sweep available in 4h/)
  })

  it('still has the Mission Control link', () => {
    expect(render()).toContain('Mission Control')
  })
})

describe('Brief tab', () => {
  it('an objective with no sweep data and no brief gets the no-intel prompt with the button inline', () => {
    const html = render()
    expect(html).toContain('No intel yet. Tap Run Sweep to get intel for this objective.')
    expect((html.match(/>Run Sweep</g) ?? []).length).toBe(2) // header and inline
  })

  it('old sweep data with no brief says how old it is', () => {
    const html = render({ sweep: { lastSweepAt: ago(5), nextSweepAt: null, latestDataAt: ago(5) } })
    expect(html).toContain('Last sweep 5 days ago. Tap Run Sweep to refresh.')
  })

  it('recent sweep data with no brief still points at Run Sweep (a sweep writes the brief)', () => {
    const html = render({ sweep: { lastSweepAt: ago(1), nextSweepAt: null, latestDataAt: ago(1) } })
    expect(html).toContain('No intel yet. Tap Run Sweep')
  })

  it('a missing location wins over the sweep prompt', () => {
    const html = render({ objective: { ...objective, lat: null, lon: null, nws_grid_office: null } })
    expect(html).toContain('Add a hunt spot on the Prep tab to start your brief')
    expect(html).not.toContain('No intel yet')
  })

  it('never mentions a scheduled sweep', () => {
    expect(render()).not.toMatch(/scheduled|check back/i)
  })
})
