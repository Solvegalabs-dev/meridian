import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikeBriefPanel from './StrikeBriefPanel'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const window1 = { window: '0600–1100', action: 'Glass the north bench', probability: 0.8, priority: 'high' as const, confidence_tier: 'T1' }

function brief(over: Record<string, unknown> = {}) {
  return {
    go_no_go: 'GO',
    brief_date: '2026-10-03',
    brief_generated_at: new Date().toISOString(),
    confidence_tier: 'T1',
    time_windows: [window1],
    lead_signal: 'Fresh tracks on the ridge',
    summary: 'Hold the north side in the morning.',
    sources: ['Movebank'],
    map_pins: [],
    attribution: 'Powered by Meridian Arc',
    ...over,
  }
}

function render(props: Partial<Parameters<typeof StrikeBriefPanel>[0]> & { brief: Record<string, unknown> | null }) {
  return renderToStaticMarkup(<StrikeBriefPanel isOnline onRefresh={async () => 'same' as const} windowState="active" {...props} />)
}

describe('StrikeBriefPanel', () => {
  it('renders the verdict first, then lead signal, windows, summary and sources', () => {
    const html = render({ brief: brief() })
    const at = (s: string) => html.indexOf(s)
    expect(at('>GO<')).toBeGreaterThan(-1)
    expect(at('>GO<')).toBeLessThan(at('Lead signal'))
    expect(at('Lead signal')).toBeLessThan(at('Time windows'))
    expect(at('Time windows')).toBeLessThan(at('Strike summary'))
    expect(at('Strike summary')).toBeLessThan(at('>Sources<'))
  })

  it('shows the updated line with relative time and local date', () => {
    const html = render({ brief: brief() })
    expect(html).toMatch(/Updated (just now|\d+m ago) \(/)
  })

  it('shows the stale note for an active hunt with a brief older than 36 hours', () => {
    const old = new Date(Date.now() - 50 * 3600_000).toISOString()
    const html = render({ brief: brief({ brief_generated_at: old }), windowState: 'active' })
    expect(html).toContain('This brief is 50 h old; the next sweep updates it.')
  })

  it('does not show the stale note when the hunt is not active', () => {
    const old = new Date(Date.now() - 50 * 3600_000).toISOString()
    const html = render({ brief: brief({ brief_generated_at: old }), windowState: 'upcoming' })
    expect(html).not.toContain('this brief is')
    expect(html).not.toContain('h old;')
  })

  it('closed hunt: no CLOSED pill, no closed time-window card, no windows, no tier, no lead signal, no summary', () => {
    const html = render({
      brief: brief({ go_no_go: 'CLOSED', confidence_tier: null, time_windows: [], lead_signal: null, summary: null, sources: [] }),
      windowState: 'trip_ended',
    })
    expect(html).not.toContain('>CLOSED<')
    expect(html).not.toContain('Hunt closed: no time windows')
    expect(html).not.toContain('Time windows')
    expect(html).not.toContain('Updated ')
    expect(html).not.toContain('0600–1100')
    expect(html).not.toContain('Lead signal')
    expect(html).not.toContain('>T1<')
    expect(html).not.toContain('>GO<')
  })

  it('closed hunt: no Refresh control, but keeps the date and attribution line', () => {
    const html = render({
      brief: brief({ go_no_go: 'CLOSED', confidence_tier: null, time_windows: [], summary: null, sources: [], brief_date: '2026-10-03' }),
      windowState: 'season_closed',
    })
    expect(html).not.toContain('Check for newer brief')
    expect(html).toContain('2026-10-03 · Powered by Meridian Arc')
  })

  it('pending state, upcoming hunt: says when briefs start', () => {
    const html = render({ brief: brief({ time_windows: null }), windowState: 'upcoming', tripStart: '2026-10-15' })
    expect(html).toContain('Intelligence sweep pending')
    expect(html).toContain('Briefs start when your trip window opens (Oct 15).')
  })

  it('pending state without an upcoming hunt has no start line', () => {
    const html = render({ brief: brief({ time_windows: null }), windowState: 'active' })
    expect(html).toContain('Intelligence sweep pending')
    expect(html).not.toContain('Briefs start')
  })

  it('uses 14px body and 12px minimum labels: no text below 12px on the tab', () => {
    const html = render({ brief: brief() })
    expect(html).not.toMatch(/text-\[(9|10|11)px\]/)
  })

  it('upcoming hunt with a GO brief shows the pre-season caption under the verdict', () => {
    const html = render({ brief: brief(), windowState: 'upcoming', tripStart: '2026-10-15' })
    expect(html).toContain('>GO<')
    expect(html).toContain('Pre-season outlook, not a hunt-day call')
    expect(html.indexOf('>GO<')).toBeLessThan(html.indexOf('Pre-season outlook'))
  })

  it('active hunt with a GO brief has no pre-season caption', () => {
    const html = render({ brief: brief(), windowState: 'active' })
    expect(html).not.toContain('Pre-season outlook')
  })

  it('closed hunt has no verdict and no caption', () => {
    const html = render({ brief: brief({ go_no_go: 'CLOSED', time_windows: [] }), windowState: 'season_not_open' })
    expect(html).not.toContain('Pre-season outlook')
  })
})

describe('StrikeBriefPanel: no location (FF-095 Part 3)', () => {
  it('tells the user to add a hunt spot on the Prep tab, with a button, instead of "sweep pending"', () => {
    const html = render({ brief: brief({ time_windows: null }), noLocation: true, onGoToPrep: () => {} })
    expect(html).toContain('Add a hunt spot on the Prep tab to start your brief')
    expect(html).toContain('Go to Prep')
    expect(html).not.toContain('Intelligence sweep pending')
    expect(html).not.toContain('Check back after the next run')
    // The button is at least 44 px tall.
    expect(html).toMatch(/<button[^>]*min-h-\[44px\]/)
  })

  it('the button switches to the Prep tab', () => {
    const goToPrep = vi.fn()
    const tree = StrikeBriefPanel({
      brief: brief({ time_windows: null }), isOnline: true, onRefresh: async () => 'same' as const,
      windowState: 'active', noLocation: true, onGoToPrep: goToPrep,
    }) as unknown as { props: { children: unknown } }

    const buttons: Array<{ props: { onClick?: () => void } }> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      const el = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } }
      if (el.type === 'button') buttons.push(el as { props: { onClick?: () => void } })
      walk(el.props?.children)
    }
    walk(tree)

    expect(buttons).toHaveLength(1)
    buttons[0].props.onClick?.()
    expect(goToPrep).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing pending text for an objective that has a location but no brief yet', () => {
    const html = render({ brief: brief({ time_windows: null }), noLocation: false, onGoToPrep: () => {} })
    expect(html).toContain('Intelligence sweep pending')
    expect(html).toContain('Check back after the next run')
    expect(html).not.toContain('Add a hunt spot')
    expect(html).not.toContain('Go to Prep')
  })

  it('does not change a brief that exists, with or without a location', () => {
    const html = render({ brief: brief(), noLocation: true, onGoToPrep: () => {} })
    expect(html).toContain('>GO<')
    expect(html).not.toContain('Add a hunt spot')
  })
})
