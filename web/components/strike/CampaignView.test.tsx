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
    // The ended row is muted by colour only: no opacity anywhere, so the label stays fully readable.
    expect(html).not.toMatch(/opacity-/)
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

describe('CampaignView: Other objectives (FF-095 Part 1)', () => {
  type Other = NonNullable<Parameters<typeof CampaignView>[0]['others']>[number]
  const other = (over: Partial<Other> = {}): Other => ({
    id: 'prof-20', title: 'Sockeye salmon, river migration (Alaska)', subtitle: 'salmon · sockeye · river_migration',
    chip: { label: 'Active', tone: 'live' }, dates: null, verdict: null, group: 'active', createdAt: '2026-10-02T00:00:00Z', ...over,
  })
  const renderWith = (campaigns: ReturnType<typeof campaign>[], others: Other[]) =>
    renderToStaticMarkup(<CampaignView campaigns={campaigns} others={others} />)
  const classAttrs = (html: string) => Array.from(html.matchAll(/class="([^"]*)"/g)).map(m => m[1])

  it('a user with a campaign and standalone objectives sees both sections', () => {
    const html = renderWith(
      [campaign('c1', 'Unit 5A elk', [unit()])],
      [other(), other({ id: 'prof-18', title: 'Rainbow trout, fly fishing (Utah)' })],
    )
    expect(html).toContain('Unit 5A elk')
    expect(html).toContain('Other objectives')
    expect(html).toContain('Sockeye salmon, river migration (Alaska)')
    expect(html).toContain('Rainbow trout, fly fishing (Utah)')
    expect(html.indexOf('Unit 5A elk')).toBeLessThan(html.indexOf('Other objectives'))
  })

  it('a user with only standalone objectives sees only Other objectives, no campaign block and no prompt', () => {
    const html = renderWith([], [other()])
    expect(html).toContain('Other objectives')
    expect(html).toContain('Sockeye salmon, river migration (Alaska)')
    expect(html).not.toContain('Start your first objective')
    expect(html).not.toContain('No active campaigns')
  })

  it('hides the Other objectives section when there are none', () => {
    const html = renderWith([campaign('c1', 'Unit 5A elk', [unit()])], [])
    expect(html).not.toContain('Other objectives')
  })

  it('shows the start prompt, linking to /strike/new, when there are no campaigns and no other objectives', () => {
    const html = renderWith([], [])
    expect(html).toContain('Start your first objective')
    expect(html).toMatch(/<a[^>]*href="\/strike\/new"[^>]*>New objective<\/a>/)
    expect(html).not.toContain('Other objectives')
  })

  it('each row links to its strike page by profile id and carries the title, subtitle, status chip and verdict', () => {
    const html = renderWith([], [other({ id: 'prof-xyz', verdict: 'GO' })])
    expect(html).toMatch(/<a[^>]*href="\/strike\/prof-xyz"/)
    expect(html).toContain('salmon · sockeye · river_migration')
    expect(html).toContain('>Active<')
    expect(html).toContain('>GO<')
  })

  it('renders rows in the order given, so an ended objective stays last', () => {
    const html = renderWith([], [
      other({ id: 'a', title: 'Live trip' }),
      other({ id: 'u', title: 'Upcoming trip', group: 'upcoming', chip: { label: 'Opens Nov 10', tone: 'pending' } }),
      other({ id: 'e', title: 'Finished trip', group: 'ended', chip: { label: 'Trip ended on Sep 15', tone: 'ended' } }),
    ])
    expect(html.indexOf('Live trip')).toBeLessThan(html.indexOf('Upcoming trip'))
    expect(html.indexOf('Upcoming trip')).toBeLessThan(html.indexOf('Finished trip'))
    expect(html).toContain('Trip ended on Sep 15')
  })

  it('shows trip dates when a row has no chip', () => {
    const html = renderWith([], [other({ chip: null, dates: 'Oct 10 – Oct 14' })])
    expect(html).toContain('Oct 10 – Oct 14')
  })

  it('new markup uses no alpha backgrounds, no opacity, no text under 12 px, and 44 px touch targets', () => {
    const html = renderWith([], [other({ verdict: 'GO' }), other({ id: 'e', group: 'ended', chip: { label: 'Trip ended', tone: 'ended' } })])
    // With no campaigns, everything on the page is new markup or the unchanged header and footer.
    for (const cls of classAttrs(html)) {
      expect(cls).not.toMatch(/\/\d+/)
      expect(cls).not.toMatch(/\bopacity-/)
      expect(cls).not.toMatch(/text-\[(\d|1[01])px\]/)
    }
    const rows = (html.match(/<a[^>]*href="\/strike\/[^"]+"[^>]*>/g) ?? []).filter(a => !a.includes('href="/strike/new"'))
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/)
  })

  it('leaves the existing campaign cards unchanged when others are passed', () => {
    const without = render([campaign('c1', 'Unit 5A elk', [unit()])])
    const withOthers = renderWith([campaign('c1', 'Unit 5A elk', [unit()])], [other()])
    // Take the Other objectives section out and the page is byte-for-byte the old one.
    expect(withOthers.replace(/<section aria-labelledby="other-objectives-heading">[\s\S]*?<\/section>/, '')).toBe(without)
  })
})
