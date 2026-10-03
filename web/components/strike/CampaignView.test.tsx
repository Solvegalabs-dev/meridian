import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CampaignView from './CampaignView'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

type Unit = Parameters<typeof CampaignView>[0]['campaigns'][number]['units'][number]

function unit(over: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    objective_id: 'obj-17',
    role: 'primary',
    rank: 1,
    status: 'active',
    missed_reason: null,
    pivot_recommended: false,
    pivot_reason: null,
    profile: {
      geo: { unit: '5A', state: 'UT' },
      timing: { trip_start: '2026-09-12', trip_end: '2026-09-30' },
      status: 'active',
    },
    brief: { confidence_tier: 'HIGH', go_no_go: 'GO' },
    ended: null,
    ...over,
  }
}

function campaign(id: string, name: string, units: Unit[], status = 'active') {
  return { id, name, status, taxonomy_key: 'elk.bull.archery', season_year: 2026, units }
}

function render(campaigns: ReturnType<typeof campaign>[]) {
  return renderToStaticMarkup(<CampaignView campaigns={campaigns} />)
}

const originalTz = process.env.TZ
afterEach(() => {
  process.env.TZ = originalTz
})

describe('CampaignView: ended units', () => {
  it('shows "Trip ended" and no GO badge for a unit whose window ended yesterday with a stored GO brief', () => {
    const html = render([campaign('c1', 'Unit 5A elk', [unit({ ended: { reason: 'trip_ended', date: '2026-10-02' } })])])
    expect(html).toContain('Trip ended on Oct 2')
    expect(html).not.toContain('>GO<')
    expect(html).not.toContain('HIGH')
  })

  it('shows "Season closed on {date}" for a season-closed unit', () => {
    const html = render([campaign('c1', 'Unit 5A elk', [unit({ ended: { reason: 'season_closed', date: '2026-09-16' } })])])
    expect(html).toContain('Season closed on Sep 16')
    expect(html).not.toContain('>GO<')
  })

  it('keeps the stored GO badge for a unit inside its window', () => {
    const html = render([campaign('c1', 'Unit 5A elk', [unit()])])
    expect(html).toContain('>GO<')
    expect(html).not.toContain('Trip ended')
  })
})

describe('CampaignView: pivot banner', () => {
  it('does not recommend a shift when the primary has ended', () => {
    const html = render([campaign('c1', 'Unit 5A elk', [
      unit({ id: 'p', role: 'primary', ended: { reason: 'trip_ended', date: '2026-10-02' } }),
      unit({ id: 'f1', role: 'fallback_1', objective_id: 'obj-18', pivot_recommended: true, pivot_reason: 'Shift focus' }),
    ])])
    expect(html).not.toContain('Pivot recommended')
  })

  it('shows the pivot card for a live primary', () => {
    const html = render([campaign('c1', 'Unit 5A elk', [
      unit({ id: 'p', role: 'primary', pivot_recommended: true, pivot_reason: 'Shift focus' }),
    ])])
    expect(html).toContain('Pivot recommended')
  })
})

describe('CampaignView: ordering', () => {
  it('sorts a campaign whose units have all ended below a live one', () => {
    const ended = campaign('c-ended', 'Ended hunt', [unit({ id: 'e', ended: { reason: 'trip_ended', date: '2026-10-02' } })])
    const live = campaign('c-live', 'Live hunt', [unit({ id: 'l' })])
    const html = render([ended, live])
    expect(html.indexOf('Live hunt')).toBeLessThan(html.indexOf('Ended hunt'))
  })
})

describe('CampaignView: trip dates', () => {
  for (const tz of ['America/New_York', 'America/Los_Angeles']) {
    it(`renders a 2026-09-12 trip start as Sep 12 under TZ=${tz}`, () => {
      process.env.TZ = tz
      const html = render([campaign('c1', 'Unit 5A elk', [unit()])])
      expect(html).toContain('Sep 12 – Sep 30')
    })
  }
})
