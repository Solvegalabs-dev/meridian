import { describe, it, expect } from 'vitest'
import { evaluateWindowState, type WindowEvaluation } from '@/lib/objectives/windowState'
import { contrastRatio } from '@/lib/utils/contrast'
import { WINDOW_CHIP_TONE } from './windowStatus'
import { TIER_CHIP, verdictStyle } from './verdictStyles'
import { buildSeasonIndex } from './coverage'
import {
  buildOtherObjectives,
  evaluationKey,
  sortOtherObjectives,
  LIMITED_DATA_TONE,
  OTHER_OBJECTIVE_CLASSES,
  type OtherObjective,
  type OtherProfileRow,
} from './otherObjectives'

const TODAY = '2026-10-03'

function profile(id: string, over: Partial<OtherProfileRow> = {}): OtherProfileRow {
  return {
    id,
    objective_id: `arc-${id}`,
    user_id: 'user-1',
    status: 'active',
    timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' },
    taxonomy_key: 'trout.rainbow.fly_fishing',
    state: 'UT',
    lat: null,
    lon: null,
    hunt_unit_id: null,
    hunt_code: null,
    domain: 'fishing',
    ended_at: null,
    ended_reason: null,
    geo: { water_body: 'Green River' },
    created_at: '2026-10-02T10:00:00Z',
    ...over,
  }
}

// Fishing has no hunt season: a trip window only.
function evalFor(p: OtherProfileRow): WindowEvaluation {
  return evaluateWindowState({ timing: p.timing, seasonRows: [], today: TODAY, tz: 'America/Denver' })
}

function build(profiles: OtherProfileRow[], extra: { briefs?: Record<string, { go_no_go?: string }>; titles?: Record<string, string | null> } = {}) {
  return buildOtherObjectives({
    profiles,
    evaluations: new Map(profiles.map(p => [evaluationKey(p), evalFor(p)])),
    briefs: new Map(Object.entries(extra.briefs ?? {})),
    storedTitles: new Map(Object.entries(extra.titles ?? {})),
  })
}

describe('buildOtherObjectives', () => {
  it('groups and labels active, upcoming and ended objectives', () => {
    const active = profile('a')
    const upcoming = profile('u', { timing: { trip_start: '2026-11-10', trip_end: '2026-11-20' } })
    const ended = profile('e', { timing: { trip_start: '2026-09-01', trip_end: '2026-09-15' } })
    const out = build([active, upcoming, ended])
    const by = (id: string) => out.find(o => o.id === id)!

    expect(by('a')).toMatchObject({ group: 'active', chip: { label: 'Active', tone: 'live' } })
    expect(by('u')).toMatchObject({ group: 'upcoming', chip: { label: 'Opens Nov 10', tone: 'pending' } })
    expect(by('e')).toMatchObject({ group: 'ended', chip: { label: 'Trip ended on Sep 15', tone: 'ended' } })
  })

  it('sorts active first, then upcoming, then ended last, newest first inside each group', () => {
    const profiles = [
      profile('ended-new', { timing: { trip_start: '2026-08-01', trip_end: '2026-08-10' }, created_at: '2026-09-30T00:00:00Z' }),
      profile('active-old', { created_at: '2026-09-01T00:00:00Z' }),
      profile('upcoming', { timing: { trip_start: '2026-12-01', trip_end: '2026-12-09' }, created_at: '2026-09-15T00:00:00Z' }),
      profile('active-new', { created_at: '2026-10-02T00:00:00Z' }),
      profile('ended-old', { timing: { trip_start: '2026-07-01', trip_end: '2026-07-09' }, created_at: '2026-08-01T00:00:00Z' }),
    ]
    expect(build(profiles).map(o => o.id)).toEqual(['active-new', 'active-old', 'upcoming', 'ended-new', 'ended-old'])
  })

  it('a hand-completed profile (status completed, no ended window) sorts as ended and shows Trip ended', () => {
    const out = build([profile('done', { status: 'completed', ended_at: null })])
    expect(out[0]).toMatchObject({ group: 'ended', chip: { label: 'Trip ended', tone: 'ended' } })
  })

  it('shows the verdict of a live brief and hides it for an ended hunt', () => {
    const live = profile('live')
    const ended = profile('over', { timing: { trip_start: '2026-09-01', trip_end: '2026-09-15' } })
    const out = build([live, ended], { briefs: { 'arc-live': { go_no_go: 'GO' }, 'arc-over': { go_no_go: 'GO' } } })
    expect(out.find(o => o.id === 'live')!.verdict).toBe('GO')
    expect(out.find(o => o.id === 'over')!.verdict).toBeNull()
  })

  it('has no verdict when there is no brief, or the brief is a CLOSED marker', () => {
    expect(build([profile('none')])[0].verdict).toBeNull()
    expect(build([profile('c')], { briefs: { 'arc-c': { go_no_go: 'CLOSED' } } })[0].verdict).toBeNull()
  })

  it('fishing evaluates on its trip window alone: active inside it, "Opens {date}" before it, "Trip ended" after it', () => {
    const inside = evalFor(profile('x'))
    const before = evalFor(profile('x', { timing: { trip_start: '2026-11-05', trip_end: '2026-11-09' } }))
    const after = evalFor(profile('x', { timing: { trip_start: '2026-09-05', trip_end: '2026-09-09' } }))
    expect([inside.state, before.state, after.state]).toEqual(['active', 'upcoming', 'trip_ended'])
  })

  it('shows the trip dates instead of a chip when the window gives no status', () => {
    const p = profile('odd', { timing: { trip_start: '2026-10-10' } })
    const out = buildOtherObjectives({ profiles: [p], evaluations: new Map(), briefs: new Map(), storedTitles: new Map() })
    expect(out[0].chip).toBeNull()
    expect(out[0].dates).toBe('Oct 10')
  })

  it('shows neither chip nor dates for an objective with no timing at all', () => {
    const p = profile('bare', { timing: null })
    const out = buildOtherObjectives({ profiles: [p], evaluations: new Map([[evaluationKey(p), evalFor(p)]]), briefs: new Map(), storedTitles: new Map() })
    expect(out[0].chip).toBeNull()
    expect(out[0].dates).toBeNull()
  })

  it('uses a readable title: stored when real, computed when the stored one is the raw key', () => {
    const raw = profile('raw')
    const written = profile('written')
    const out = build([raw, written], {
      titles: { 'arc-raw': 'trout · rainbow · fly_fishing', 'arc-written': 'Green River opener' },
    })
    expect(out.find(o => o.id === 'raw')!.title).toBe('Rainbow trout, fly fishing, Green River (Utah)')
    expect(out.find(o => o.id === 'written')!.title).toBe('Green River opener')
  })

  it('puts the hunt number and taxonomy in the subtitle, never coordinates', () => {
    const p = profile('hunt', { taxonomy_key: 'elk.cow.archery', hunt_code: 'EA2004', domain: 'elk', geo: null, lat: 40.5123, lon: -111.2456 })
    const out = build([p])
    expect(out[0].subtitle).toBe('EA2004 · elk · cow · archery')
    expect(out[0].title).toBe('EA2004 antlerless elk (Utah)')
    expect(JSON.stringify(out[0])).not.toMatch(/40\.5123|111\.2456/)
  })

  it('keys an unlinked profile (no objective_id) by its own id', () => {
    const a = profile('orphan-a', { objective_id: null as unknown as string })
    const b = profile('orphan-b', { objective_id: null as unknown as string })
    expect(evaluationKey(a)).toBe('orphan-a')
    expect(build([a, b])).toHaveLength(2)
  })
})

describe('sortOtherObjectives', () => {
  const item = (id: string, group: OtherObjective['group'], createdAt: string | null): OtherObjective => ({
    id, title: id, subtitle: '', chip: null, dates: null, verdict: null, group, createdAt, limitedData: false,
  })

  it('does not mutate its input and puts a missing created date last in its group', () => {
    const input = [item('b', 'active', null), item('a', 'active', '2026-10-01T00:00:00Z')]
    expect(sortOtherObjectives(input).map(i => i.id)).toEqual(['a', 'b'])
    expect(input.map(i => i.id)).toEqual(['b', 'a'])
  })
})

describe('Other objectives styles', () => {
  const classes = Object.values(OTHER_OBJECTIVE_CLASSES)

  it('uses no alpha backgrounds and no opacity', () => {
    for (const cls of classes) {
      expect(cls).not.toMatch(/\/\d+/)
      expect(cls).not.toMatch(/\bopacity-/)
    }
  })

  it('keeps body text at 14 px or more and labels at 12 px or more', () => {
    for (const cls of classes) {
      expect(cls).not.toMatch(/text-\[(\d|1[01])px\]/) // nothing below 12 px
      expect(cls).not.toMatch(/\btext-(xxs|2xs)\b/)
    }
    // Title and prompt body are body text: text-sm or larger. Subtitle, dates, chips, heading are labels: text-xs or larger.
    for (const key of ['title', 'titleEnded', 'promptTitle', 'promptBody', 'promptButton'] as const) {
      expect(OTHER_OBJECTIVE_CLASSES[key]).toMatch(/\btext-(sm|base|lg)\b/)
    }
    for (const key of ['heading', 'subtitle', 'chip', 'verdict', 'dates'] as const) {
      expect(OTHER_OBJECTIVE_CLASSES[key]).toMatch(/\btext-(xs|sm|base)\b/)
    }
  })

  it('makes the row and the prompt button at least 44 px tall', () => {
    expect(OTHER_OBJECTIVE_CLASSES.row).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/)
    expect(OTHER_OBJECTIVE_CLASSES.promptButton).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/)
  })

  it('meets 4.5:1 for the chip tones, the verdict pills and the row text on its card', () => {
    for (const tone of Object.values(WINDOW_CHIP_TONE)) {
      expect(contrastRatio(tone.color, tone.bg)).toBeGreaterThanOrEqual(4.5)
    }
    for (const v of ['GO', 'NO_GO', 'CONDITIONAL', 'MONITOR']) {
      const s = verdictStyle(v)!
      expect(contrastRatio(s.color, s.bg)).toBeGreaterThanOrEqual(4.5)
    }
    for (const t of Object.values(TIER_CHIP)) expect(contrastRatio(t.color, t.bg)).toBeGreaterThanOrEqual(4.5)
    // slate-800 card with white / slate-300 text, and slate-900 page with slate-300 heading.
    expect(contrastRatio('#ffffff', '#1e293b')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#cbd5e1', '#1e293b')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#cbd5e1', '#0f172a')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('Limited data (FF-096 Part 3)', () => {
  const index = buildSeasonIndex([{ state: 'UT', species: 'elk' }])
  const run = (p: OtherProfileRow, seasonIndex?: ReturnType<typeof buildSeasonIndex> | null) =>
    buildOtherObjectives({ profiles: [p], evaluations: new Map([[evaluationKey(p), evalFor(p)]]), briefs: new Map(), storedTitles: new Map(), seasonIndex })[0]

  it('flags a species and state with no data, and not one with data', () => {
    expect(run(profile('ks', { taxonomy_key: 'turkey.eastern.archery', state: 'KS', geo: null }), index).limitedData).toBe(true)
    expect(run(profile('ut', { taxonomy_key: 'elk.bull.archery', state: 'UT', geo: null }), index).limitedData).toBe(false)
    expect(run(profile('trout'), index).limitedData).toBe(false) // Utah trout: the fishing config covers it
  })

  it('does not flag an objective whose state is unknown, or when the season data could not be read', () => {
    expect(run(profile('nostate', { taxonomy_key: 'turkey.eastern.archery', state: null, geo: null }), index).limitedData).toBe(false)
    expect(run(profile('ks', { taxonomy_key: 'turkey.eastern.archery', state: 'KS', geo: null }), null).limitedData).toBe(false)
  })

  it('does not evaluate coverage at all when no index is passed', () => {
    expect(run(profile('ks', { taxonomy_key: 'turkey.eastern.archery', state: 'KS', geo: null })).limitedData).toBe(false)
  })

  it('does not change the title, chip, group or verdict of the row', () => {
    const p = profile('ks', { taxonomy_key: 'turkey.eastern.archery', state: 'KS', geo: null })
    const flagged = run(p, index)
    const plain = run(p)
    expect({ ...flagged, limitedData: false }).toEqual(plain)
  })

  it('the chip colours meet 4.5:1 and use no alpha', () => {
    expect(contrastRatio(LIMITED_DATA_TONE.color, LIMITED_DATA_TONE.bg)).toBeGreaterThanOrEqual(4.5)
    expect(OTHER_OBJECTIVE_CLASSES.limited).not.toMatch(/\/\d+/)
  })
})

describe('Removed objectives styles (FF-096 Part 1)', () => {
  it('text is 14 px or more, and the summary and rows are 44 px or taller', () => {
    expect(OTHER_OBJECTIVE_CLASSES.removedSummary).toMatch(/text-sm/)
    expect(OTHER_OBJECTIVE_CLASSES.removedSummary).toMatch(/min-h-\[44px\]/)
    expect(OTHER_OBJECTIVE_CLASSES.removedRow).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/)
    expect(OTHER_OBJECTIVE_CLASSES.removedTitle).toMatch(/text-sm/)
    expect(OTHER_OBJECTIVE_CLASSES.restoreButton).toMatch(/min-h-\[44px\]/)
    for (const key of ['removedSummary', 'removedRow', 'removedTitle', 'restoreButton', 'removedMessage'] as const) {
      expect(OTHER_OBJECTIVE_CLASSES[key]).not.toMatch(/\/\d+/)
      expect(OTHER_OBJECTIVE_CLASSES[key]).not.toMatch(/opacity-/)
    }
  })
})
