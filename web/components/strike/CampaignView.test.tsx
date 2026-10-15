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

// Removes a <div data-testid="id">...</div> block, matching nested divs by depth
// rather than the first "</div>" (a naive regex would stop too early).
function stripBalancedDiv(html: string, testid: string): string {
  const open = new RegExp(`<div data-testid="${testid}"[^>]*>`).exec(html)
  if (!open) return html
  const start = open.index
  const tagPattern = /<div\b[^>]*>|<\/div>/g
  tagPattern.lastIndex = start + open[0].length
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(html))) {
    depth += match[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(0, start) + html.slice(match.index + match[0].length)
  }
  return html
}

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

describe('CampaignView: standalone objectives, grouped by focus (FF-095 Part 1, FF-106 Stage 1)', () => {
  type Other = NonNullable<Parameters<typeof CampaignView>[0]['others']>[number]
  const other = (over: Partial<Other> = {}): Other => ({
    id: 'prof-20', title: 'Sockeye salmon, river migration (Alaska)', subtitle: 'salmon · sockeye · river_migration',
    chip: { label: 'Active', tone: 'live' }, dates: null, tripStart: null, verdict: null, group: 'now', createdAt: '2026-10-02T00:00:00Z', limitedData: false, ...over,
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
    expect(html).toContain('Focus now')
    expect(html).toContain('Sockeye salmon, river migration (Alaska)')
    expect(html).toContain('Rainbow trout, fly fishing (Utah)')
    expect(html.indexOf('Unit 5A elk')).toBeLessThan(html.indexOf('Focus now'))
  })

  it('a user with only standalone objectives sees only the focus sections, no campaign block and no prompt', () => {
    const html = renderWith([], [other()])
    expect(html).toContain('Focus now')
    expect(html).toContain('Sockeye salmon, river migration (Alaska)')
    expect(html).not.toContain('Start your first objective')
    expect(html).not.toContain('No active campaigns')
  })

  it('hides the focus sections when there are no standalone objectives', () => {
    const html = renderWith([campaign('c1', 'Unit 5A elk', [unit()])], [])
    expect(html).not.toContain('Focus now')
    expect(html).not.toContain('data-testid="standalone-objectives"')
  })

  it('shows the start prompt, linking to /strike/new, when there are no campaigns and no other objectives', () => {
    const html = renderWith([], [])
    expect(html).toContain('Start your first objective')
    expect(html).toMatch(/<a[^>]*href="\/strike\/new"[^>]*>New objective<\/a>/)
    expect(html).not.toContain('Focus now')
  })

  it('each spotlight card links to its strike page by profile id and carries the title, subtitle, status chip and verdict', () => {
    const html = renderWith([], [other({ id: 'prof-xyz', verdict: 'GO' })])
    expect(html).toMatch(/<a[^>]*href="\/strike\/prof-xyz"/)
    expect(html).toContain('salmon · sockeye · river_migration')
    expect(html).toContain('>Active<')
    expect(html).toContain('>GO<')
  })

  it('renders "now" first (as the spotlight), then "prep", then "ended" last', () => {
    const html = renderWith([], [
      other({ id: 'a', title: 'Live trip' }),
      other({ id: 'u', title: 'Upcoming trip', group: 'prep', chip: { label: 'Opens Nov 10', tone: 'pending' } }),
      other({ id: 'e', title: 'Finished trip', group: 'ended', chip: { label: 'Trip ended on Sep 15', tone: 'ended' } }),
    ])
    expect(html.indexOf('Live trip')).toBeLessThan(html.indexOf('Upcoming trip'))
    expect(html.indexOf('Upcoming trip')).toBeLessThan(html.indexOf('Finished trip'))
    expect(html).toContain('Getting ready')
    expect(html).toContain('Finished (1)')
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
    // Take the (nested) standalone-objectives block out and the page is byte-for-byte the old one.
    expect(stripBalancedDiv(withOthers, 'standalone-objectives')).toBe(without)
  })

  describe('spotlight: "Focus now" vs "Next up"', () => {
    it('spotlights the first "now" item as "Focus now", with the rest of "now" listed below it', () => {
      const html = renderWith([], [
        other({ id: 'n1', title: 'First now' }),
        other({ id: 'n2', title: 'Second now' }),
      ])
      expect(html).toContain('Focus now')
      expect(html).not.toContain('Next up')
      expect(html.indexOf('First now')).toBeLessThan(html.indexOf('Second now'))
    })

    it('spotlights the first "prep" item as "Next up" when there is nothing in "now"', () => {
      const html = renderWith([], [
        other({ id: 'p1', title: 'Soonest prep', group: 'prep' }),
        other({ id: 'p2', title: 'Later prep', group: 'prep' }),
      ])
      expect(html).toContain('Next up')
      expect(html).not.toContain('Focus now')
      expect(html).toContain('Getting ready')
      // The spotlighted prep item is not duplicated under "Getting ready".
      expect(html.match(/Soonest prep/g)).toHaveLength(1)
      expect(html).toContain('Later prep')
    })

    it('shows no spotlight when both "now" and "prep" are empty', () => {
      const html = renderWith([], [other({ id: 'r1', title: 'On the radar item', group: 'radar' })])
      expect(html).not.toContain('Focus now')
      expect(html).not.toContain('Next up')
      expect(html).toContain('On the radar item')
    })
  })

  describe('collapsing (FF-106 Stage 1)', () => {
    const radarItem = (n: number) => other({ id: `r${n}`, title: `Radar ${n}`, group: 'radar' })
    const nextYearItem = (n: number) => other({ id: `y${n}`, title: `Next year ${n}`, group: 'next_year' })

    it('does not collapse "On the radar" at 3 items', () => {
      const html = renderWith([], [radarItem(1), radarItem(2), radarItem(3)])
      expect(html).toContain('On the radar')
      expect(html).not.toContain('On the radar (3)')
      expect(html).not.toMatch(/<details>[\s\S]*Radar 1/)
    })

    it('collapses "On the radar" behind a count once there are 4 or more', () => {
      const html = renderWith([], [radarItem(1), radarItem(2), radarItem(3), radarItem(4)])
      expect(html).toContain('On the radar (4)')
      expect(html).toMatch(/<details>[\s\S]*On the radar \(4\)[\s\S]*Radar 1[\s\S]*<\/details>/)
    })

    it('collapses "Next year" the same way, after 3', () => {
      const html = renderWith([], [nextYearItem(1), nextYearItem(2), nextYearItem(3), nextYearItem(4)])
      expect(html).toContain('Next year (4)')
    })

    it('always collapses "Finished", even with a single item', () => {
      const html = renderWith([], [other({ id: 'e1', title: 'One finished hunt', group: 'ended' })])
      expect(html).toContain('Finished (1)')
      expect(html).toMatch(/<details>[\s\S]*Finished \(1\)[\s\S]*One finished hunt[\s\S]*<\/details>/)
    })

    it('never collapses "Getting ready"', () => {
      const items = [1, 2, 3, 4, 5].map(n => other({ id: `g${n}`, title: `Getting ready ${n}`, group: 'prep' }))
      const html = renderWith([], items)
      expect(html).not.toContain('Getting ready (')
    })
  })
})

describe('CampaignView: Limited data and Removed objectives (FF-096)', () => {
  type Other = NonNullable<Parameters<typeof CampaignView>[0]['others']>[number]
  const other = (over: Partial<Other> = {}): Other => ({
    id: 'p1', title: 'Wild turkey, archery (Kansas)', subtitle: 'turkey · eastern · archery',
    chip: { label: 'Active', tone: 'live' }, dates: null, tripStart: null, verdict: null, group: 'now', createdAt: null, limitedData: false, ...over,
  })
  // The spotlight card does not show the limited-data chip (it is not in the spotlight's
  // title/window-chip/verdict-chip list), so these tests use "radar" rows instead.
  const radarOther = (over: Partial<Other> = {}) => other({ group: 'radar', ...over })

  it('shows a "Limited data" chip only on a row flagged limitedData', () => {
    const html = renderToStaticMarkup(<CampaignView campaigns={[]} others={[radarOther({ limitedData: true }), radarOther({ id: 'p2', title: 'Covered one' })]} />)
    expect((html.match(/Limited data/g) ?? []).length).toBe(1)
    expect(html.indexOf('Limited data')).toBeLessThan(html.indexOf('Covered one'))
  })

  it('the Limited data chip is opaque, readable, and changes nothing else on the row', () => {
    const html = renderToStaticMarkup(<CampaignView campaigns={[]} others={[radarOther({ limitedData: true })]} />)
    expect(html).toContain('background-color:#78350f')
    expect(html).toContain('color:#fde68a')
    expect(html).toContain('>Active<')
    expect(html).toMatch(/<a[^>]*href="\/strike\/p1"/)
  })

  it('shows the Removed objectives section only when something is removed', () => {
    const without = renderToStaticMarkup(<CampaignView campaigns={[]} others={[other()]} />)
    expect(without).not.toContain('Removed objectives')

    const withRemoved = renderToStaticMarkup(<CampaignView campaigns={[]} others={[other()]} removed={[{ id: 'r1', title: 'Old trip' }]} />)
    expect(withRemoved).toContain('Removed objectives (1)')
    expect(withRemoved).toContain('Old trip')
    expect(withRemoved.indexOf('Focus now')).toBeLessThan(withRemoved.indexOf('Removed objectives'))
  })

  it('a user whose only objectives are removed still sees the start prompt, plus the removed list', () => {
    const html = renderToStaticMarkup(<CampaignView campaigns={[]} others={[]} removed={[{ id: 'r1', title: 'Old trip' }]} />)
    expect(html).toContain('Start your first objective')
    expect(html).toContain('Removed objectives (1)')
  })
})
