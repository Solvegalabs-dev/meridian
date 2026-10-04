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
  return renderToStaticMarkup(<StrikeBriefPanel isOnline onRefresh={() => {}} windowState="active" {...props} />)
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

  it('closed brief: neutral CLOSED pill, no windows, no tier, no lead signal, no summary', () => {
    const html = render({
      brief: brief({ go_no_go: 'CLOSED', confidence_tier: null, time_windows: [], lead_signal: null, summary: null, sources: [] }),
      windowState: 'trip_ended',
    })
    expect(html).toContain('>CLOSED<')
    expect(html).toContain('Hunt closed: no time windows')
    expect(html).not.toContain('Updated ')
    expect(html).not.toContain('0600–1100')
    expect(html).not.toContain('Lead signal')
    expect(html).not.toContain('>T1<')
    expect(html).not.toContain('>GO<')
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
