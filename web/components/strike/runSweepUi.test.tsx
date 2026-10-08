// FF-098 Part 1: the Run Sweep button on Strike, the prompt, and what the Brief, Intel and Signals tabs say.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import RunSweepPrompt from './RunSweepPrompt'
import RunSweepButton, { RunSweepButtonView } from './RunSweepButton'
import StrikeBriefPanel from './StrikeBriefPanel'
import StrikeIntelPanel from './StrikeIntelPanel'
import { SignalsBody } from './StrikeSignalsPanel'
import SweepButton from '@/components/dashboard/SweepButton'
import { emptyTabPrompt, sweepPromptFor, SWEEP_STALE_DAYS } from '@/lib/strike/sweepStatus'
import { ZERO_EVIDENCE_BANNER } from '@/lib/strikeBrief/evidence'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const NOW = new Date()
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
const classAttrs = (html: string) => Array.from(html.matchAll(/class="([^"]*)"/g)).map(m => m[1])

function expectStyleRules(html: string) {
  for (const cls of classAttrs(html)) {
    expect(cls).not.toMatch(/\/\d+/)
    expect(cls).not.toMatch(/\bopacity-/)
    expect(cls).not.toMatch(/text-\[(\d|1[01])px\]/)
  }
  for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toMatch(/min-h-\[44px\]/)
}

describe('Run Sweep button (Strike)', () => {
  const view = (over: Partial<Parameters<typeof RunSweepButtonView>[0]> = {}) => renderToStaticMarkup(
    <RunSweepButtonView isRunning={false} disabled={false} rateLimitedNext={null} lastSweepAt={null} error={null} onRun={() => {}} {...over} />,
  )

  it('is labelled "Run Sweep" with the scope line under it', () => {
    const html = view()
    expect(html).toContain('>Run Sweep<')
    expect(html).toContain('Checks all your active objectives')
  })

  it('shows "Sweeping..." and is disabled while running', () => {
    const html = view({ isRunning: true, disabled: true })
    expect(html).toContain('Sweeping...')
    expect(html).toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('shows the last sweep age when known, and not while sweeping', () => {
    expect(view({ lastSweepAt: ago(2) })).toContain('Last sweep: 2d ago')
    expect(view({ lastSweepAt: ago(2), isRunning: true, disabled: true })).not.toContain('Last sweep')
    expect(view()).not.toContain('Last sweep')
  })

  it('shows the 23-hour state instead of the last sweep when rate limited', () => {
    const next = new Date(Date.now() + 5 * 60 * 60 * 1000 + 30_000).toISOString()
    const html = view({ disabled: true, rateLimitedNext: next, lastSweepAt: ago(1) })
    expect(html).toMatch(/Next sweep available in 5h/)
    expect(html).not.toContain('Last sweep')
    expect(html).toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('shows the error text', () => {
    expect(view({ error: 'No active objectives found' })).toContain('No active objectives found')
  })

  it('the stateful button starts rate limited when the server says the next sweep is in the future', () => {
    const next = new Date(Date.now() + 3 * 60 * 60 * 1000 + 30_000).toISOString()
    const html = renderToStaticMarkup(<RunSweepButton lastSweepAt={ago(1)} nextSweepAt={next} />)
    expect(html).toMatch(/Next sweep available in 3h/)
    expect(html).toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('an expired limit is not a limit', () => {
    const html = renderToStaticMarkup(<RunSweepButton lastSweepAt={ago(2)} nextSweepAt={new Date(Date.now() - 1000).toISOString()} />)
    expect(html).not.toContain('Next sweep available')
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('follows the style rules: 44 px target, 12 px labels, no alpha or opacity', () => {
    const html = view({ lastSweepAt: ago(2), error: 'x' })
    expectStyleRules(html)
    expect(html).toMatch(/<span class="text-xs[^"]*">Checks all your active objectives/)
  })
})

describe('Mission Control button is unchanged by the extraction', () => {
  it('still renders "Run Sweep", the last sweep line and the Mission Control styling', () => {
    const html = renderToStaticMarkup(<SweepButton lastSweepAt={ago(3)} />)
    expect(html).toContain('Run Sweep')
    expect(html).toContain('Last sweep: 3d ago')
    expect(html).toContain('bg-navy')
    expect(html).toContain('text-[13px]')
  })

  it('still shows the rate-limited state and disables the button', () => {
    const next = new Date(Date.now() + 2 * 60 * 60 * 1000 + 30_000).toISOString()
    const html = renderToStaticMarkup(<SweepButton lastSweepAt={ago(1)} nextSweepAt={next} />)
    expect(html).toMatch(/Next sweep available in 2h/)
    expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    expect(html).toContain('cursor-not-allowed')
  })
})

describe('RunSweepPrompt', () => {
  const prompt = (p: ReturnType<typeof sweepPromptFor>) => renderToStaticMarkup(<RunSweepPrompt prompt={p} lastSweepAt={ago(5)} />)

  it('no data: the text and the button, in one place', () => {
    const html = prompt(sweepPromptFor(null))
    expect(html).toContain('No intel yet. Tap Run Sweep to get intel for this objective.')
    expect(html).toContain('>Run Sweep<')
  })

  it('stale at 4 days says how long, with the button', () => {
    const html = prompt(sweepPromptFor(ago(4)))
    expect(html).toContain('Last sweep 4 days ago. Tap Run Sweep to refresh.')
    expect(html).toContain('>Run Sweep<')
  })

  it('fresh at 2 days renders nothing', () => {
    expect(prompt(sweepPromptFor(ago(2)))).toBe('')
    expect(SWEEP_STALE_DAYS).toBe(3)
  })

  it('body text is 14 px (text-sm) or larger and follows the style rules', () => {
    const html = prompt(sweepPromptFor(null))
    expect(html).toMatch(/<p class="text-sm[^"]*">No intel yet/)
    expectStyleRules(html)
  })
})

const flow = (p: ReturnType<typeof emptyTabPrompt>) => <RunSweepPrompt prompt={p} />

describe('Brief tab', () => {
  const render = (props: Partial<Parameters<typeof StrikeBriefPanel>[0]> & { brief: Record<string, unknown> | null }) =>
    renderToStaticMarkup(<StrikeBriefPanel isOnline onRefresh={async () => 'same' as const} windowState="active" {...props} />)

  it('no brief: the Run Sweep prompt, not the old scheduled-sweep text', () => {
    const html = render({ brief: { time_windows: null }, emptyPrompt: flow(emptyTabPrompt(null)) })
    expect(html).toContain('No intel yet. Tap Run Sweep to get intel for this objective.')
    expect(html).toContain('>Run Sweep<')
    expect(html).not.toMatch(/scheduled sweep|Check back after/i)
  })

  it('a missing location takes priority over the sweep prompt', () => {
    const html = render({ brief: { time_windows: null }, noLocation: true, onGoToPrep: () => {}, emptyPrompt: flow(emptyTabPrompt(null)) })
    expect(html).toContain('Add a hunt spot on the Prep tab to start your brief')
    expect(html).not.toContain('No intel yet')
    expect(html).not.toContain('>Run Sweep<')
  })

  it('a brief with old sweep data shows the stale prompt above it', () => {
    const brief = { go_no_go: 'MONITOR', time_windows: [], summary: 'A summary.', brief_generated_at: ago(1), sources: [], map_pins: [] }
    const html = render({ brief, stalePrompt: flow(sweepPromptFor(ago(4))) })
    expect(html).toContain('Last sweep 4 days ago. Tap Run Sweep to refresh.')
    expect(html.indexOf('Last sweep 4 days ago')).toBeLessThan(html.indexOf('A summary.'))
  })

  it('a fresh brief shows no prompt', () => {
    const brief = { go_no_go: 'GO', time_windows: [], summary: 'A summary.', brief_generated_at: ago(1), sources: [], map_pins: [] }
    const html = render({ brief, stalePrompt: null })
    expect(html).not.toContain('Run Sweep')
  })

  it('a brief written with no evidence shows the prompt too, and the banner on its own line', () => {
    const brief = { go_no_go: 'MONITOR', time_windows: [], summary: `${ZERO_EVIDENCE_BANNER}\n\nTypical for this time of year.`, brief_generated_at: ago(0), sources: [], map_pins: [] }
    const html = render({ brief, emptyPrompt: flow(emptyTabPrompt(null)) })
    expect(html).toContain('No intel yet. Tap Run Sweep')
    expect(html).toContain('whitespace-pre-line')
    expect(html).toContain('No data collected yet. This is typical for the season, not confirmed. Tap Run Sweep to get intel.')
  })

  it('without a prompt passed, the no-brief state still never mentions a schedule', () => {
    const html = render({ brief: { time_windows: null } })
    expect(html).toContain('No intel yet. Tap Run Sweep')
    expect(html).not.toMatch(/scheduled|check back/i)
  })
})

describe('Intel tab', () => {
  const render = (props: Partial<Parameters<typeof StrikeIntelPanel>[0]>) =>
    renderToStaticMarkup(<StrikeIntelPanel brief={null} objective={{}} {...props} />)

  it('no signal data: the Run Sweep prompt, not "No signal data yet"', () => {
    const html = render({ emptyPrompt: flow(emptyTabPrompt(null)) })
    expect(html).toContain('No intel yet. Tap Run Sweep to get intel for this objective.')
    expect(html).toContain('>Run Sweep<')
    expect(html).not.toContain('No signal data yet')
  })

  it('old data with chips: the chips with the stale prompt above', () => {
    const brief = { signal_chips: [{ label: 'Streamflow', value: '2,490 cfs', status: 'ok' }] }
    const html = render({ brief, stalePrompt: flow(sweepPromptFor(ago(4))) })
    expect(html).toContain('Last sweep 4 days ago. Tap Run Sweep to refresh.')
    expect(html).toContain('2,490 cfs')
    expect(html.indexOf('Last sweep 4 days ago')).toBeLessThan(html.indexOf('Streamflow'))
  })

  it('fresh data with chips shows no prompt', () => {
    const brief = { signal_chips: [{ label: 'Streamflow', value: '2,490 cfs', status: 'ok' }] }
    expect(render({ brief, stalePrompt: null })).not.toContain('Run Sweep')
  })
})

describe('Signals tab', () => {
  const group = {
    label: 'Streamflow', icon: 'x',
    signals: [{ id: '1', agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE', objective_id: 'o', observed_value: 2490, source: 'observed', recorded_at: ago(1) }],
  }

  it('no signals: the Run Sweep prompt, not "Signals are building"', () => {
    const html = renderToStaticMarkup(<SignalsBody groups={[]} emptyPrompt={flow(emptyTabPrompt(null))} />)
    expect(html).toContain('No intel yet. Tap Run Sweep to get intel for this objective.')
    expect(html).toContain('>Run Sweep<')
    expect(html).not.toMatch(/building|check back/i)
  })

  it('old signals show the stale prompt above them', () => {
    const html = renderToStaticMarkup(<SignalsBody groups={[group]} stalePrompt={flow(sweepPromptFor(ago(4)))} />)
    expect(html).toContain('Last sweep 4 days ago. Tap Run Sweep to refresh.')
    expect(html.indexOf('Last sweep 4 days ago')).toBeLessThan(html.indexOf('Streamflow'))
  })

  it('fresh signals show no prompt', () => {
    expect(renderToStaticMarkup(<SignalsBody groups={[group]} />)).not.toContain('Run Sweep')
  })
})

describe('no scheduled-sweep wording is left in the Strike components', () => {
  const dirs = [join(__dirname), join(__dirname, '..', '..', 'lib', 'strike')]
  const files = dirs.flatMap(d => readdirSync(d).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map(f => join(d, f)))

  it('finds the files it is meant to check', () => {
    expect(files.some(f => f.endsWith('StrikeBriefPanel.tsx'))).toBe(true)
    expect(files.some(f => f.endsWith('briefRefresh.ts'))).toBe(true)
  })

  for (const phrase of [/scheduled sweep/i, /check back after/i, /sweep writes this brief/i, /are building/i]) {
    it(`has no ${phrase}`, () => {
      const hits = files.filter(f => phrase.test(readFileSync(f, 'utf8')))
      expect(hits).toEqual([])
    })
  }
})
