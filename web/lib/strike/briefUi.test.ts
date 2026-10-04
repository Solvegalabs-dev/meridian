import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { verdictStyle, TIER_CHIP } from './verdictStyles'
import { defaultStrikeTab } from './defaultTab'
import { windowStatusChip, isPreseasonState } from './windowStatus'
import { strikeDetailHref } from './strikeLinks'
import { isStaleBrief, staleBriefNote, updatedLabel, briefAgeHours, briefGeneratedAt, hasStoredBrief } from './briefFreshness'
import { contrastRatio } from '@/lib/utils/contrast'
import type { WindowEvaluation, WindowState } from '@/lib/objectives/windowState'

const ev = (state: WindowState, detail: WindowEvaluation['detail'] = { code: 'X' }): WindowEvaluation => ({ state, detail })

describe('verdict palette', () => {
  it('maps every verdict and treats unknown as no verdict', () => {
    expect(verdictStyle('GO')?.label).toBe('GO')
    expect(verdictStyle('NO-GO')?.label).toBe('NO GO')
    expect(verdictStyle('NO_GO')?.label).toBe('NO GO')
    expect(verdictStyle('CONDITIONAL')?.label).toBe('CONDITIONAL')
    expect(verdictStyle('MONITOR')?.label).toBe('MONITOR')
    expect(verdictStyle('CLOSED')?.label).toBe('CLOSED')
    expect(verdictStyle('banana')).toBeNull()
    expect(verdictStyle(null)).toBeNull()
  })

  for (const v of ['GO', 'NO_GO', 'CONDITIONAL', 'MONITOR', 'CLOSED']) {
    it(`${v} text meets WCAG AA on its opaque background`, () => {
      const s = verdictStyle(v)!
      expect(contrastRatio(s.color.slice(1), s.bg.slice(1))).toBeGreaterThanOrEqual(4.5)
    })
  }

  for (const [tier, chip] of Object.entries(TIER_CHIP)) {
    it(`tier ${tier} chip meets WCAG AA`, () => {
      expect(contrastRatio(chip.color.slice(1), chip.bg.slice(1))).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('default tab', () => {
  it('upcoming and season-not-open open on Prep', () => {
    expect(defaultStrikeTab('upcoming')).toBe('prep')
    expect(defaultStrikeTab('season_not_open')).toBe('prep')
  })
  it('active, ended and unknown open on the Brief tab', () => {
    expect(defaultStrikeTab('active')).toBe('strike')
    expect(defaultStrikeTab('season_closed')).toBe('strike')
    expect(defaultStrikeTab('trip_ended')).toBe('strike')
    expect(defaultStrikeTab('no_dates')).toBe('strike')
    expect(defaultStrikeTab(null)).toBe('strike')
  })
})

describe('window status chip', () => {
  it('shows Active, Opens {date}, and the ended states', () => {
    expect(windowStatusChip(ev('active'))?.label).toBe('Active')
    expect(windowStatusChip(ev('upcoming', { code: 'X', trip_start: '2026-10-15' }))?.label).toBe('Opens Oct 15')
    expect(windowStatusChip(ev('season_not_open', { code: 'X', season_start: '2026-08-01' }))?.label).toBe('Opens Aug 1')
    expect(windowStatusChip(ev('season_closed'))?.label).toBe('Season closed')
    expect(windowStatusChip(ev('trip_ended'))?.label).toBe('Trip ended')
  })
  it('shows nothing without dates or evaluation', () => {
    expect(windowStatusChip(ev('no_dates'))).toBeNull()
    expect(windowStatusChip(null)).toBeNull()
  })
})

describe('Open strike view link', () => {
  it('uses the profile PK when a profile exists', () => {
    expect(strikeDetailHref({ profileId: 'prof-1', objectiveId: 'OBJ-17' })).toBe('/strike/prof-1')
  })
  it('falls back to the objective-level view when there is no profile', () => {
    expect(strikeDetailHref({ profileId: null, objectiveId: 'OBJ-17' })).toBe('/objectives/OBJ-17/strike')
  })
})

describe('brief freshness', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString()

  it('is stale only after 36 hours and only for an active hunt', () => {
    expect(isStaleBrief(hoursAgo(37), now, true)).toBe(true)
    expect(isStaleBrief(hoursAgo(35), now, true)).toBe(false)
    expect(isStaleBrief(hoursAgo(37), now, false)).toBe(false)
    expect(briefAgeHours(hoursAgo(10), now)).toBeCloseTo(10)
  })
  it('states the age in hours', () => {
    expect(staleBriefNote(hoursAgo(50), now)).toBe('This brief is 50 h old; the next sweep updates it.')
  })
  it('updated label has relative time and a local date and time', () => {
    const label = updatedLabel(new Date().toISOString())
    expect(label).toMatch(/^Updated (just now|\d+m ago|\d+h ago) \(.+\)$/)
  })
})

describe('Strike panel and header colour pairs', () => {
  // Text colours as they are used on the opaque surfaces in the panel and header.
  const pairs: Array<[string, string, string]> = [
    ['label slate-300 on slate-800 (panel cards and labels)', 'cbd5e1', '1e293b'],
    ['summary slate-100 on slate-800', 'f1f5f9', '1e293b'],
    ['sources slate-200 on slate-700', 'e2e8f0', '334155'],
    ['lead signal blue-100 on blue-900', 'dbeafe', '1e3a8a'],
    ['priority high red-400 on slate-800', 'f87171', '1e293b'],
    ['priority medium amber-400 on slate-800', 'fbbf24', '1e293b'],
    ['priority low green-400 on slate-800', '4ade80', '1e293b'],
    ['stale note amber-200 on amber-950', 'fde68a', '451a03'],
    ['footer slate-300 on slate-900', 'cbd5e1', '0f172a'],
    ['refresh blue-300 on slate-900', '93c5fd', '0f172a'],
    ['tab label slate-300 on slate-900', 'cbd5e1', '0f172a'],
  ]
  for (const [name, fg, bg] of pairs) {
    it(`${name} meets 4.5:1`, () => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('no alpha utilities in the Strike tab and header markup', () => {
  // The Addendum 3 rule, applied to the markup this PR changes: opaque backgrounds, no opacity on text.
  const files = [
    'components/strike/StrikeBriefPanel.tsx',
    'components/strike/StrikeHeader.tsx',
    'components/strike/StrikeFooter.tsx',
    'components/strike/StrikeBriefClient.tsx',
  ]
  for (const f of files) {
    it(`${f} has no bg-*/NN, border-*/NN, text-*/NN or opacity-* utilities`, () => {
      const src = readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), 'utf8')
      expect(src).not.toMatch(/\b(bg|border|text|ring|from|to)-[a-z]+-?\d*\/\d+/)
      expect(src).not.toMatch(/\bopacity-\d/)
    })
  }
})

describe('stored brief time and presence', () => {
  const now = new Date('2026-10-03T12:00:00Z')

  it('keeps the stored created_at, so a 40 h old brief stays 40 h old', () => {
    const created = new Date(now.getTime() - 40 * 3600_000).toISOString()
    expect(briefGeneratedAt(created, now)).toBe(created)
  })

  it('falls back to now only when there is no stored time', () => {
    expect(briefGeneratedAt(null, now)).toBe(now.toISOString())
    expect(briefGeneratedAt(undefined, now)).toBe(now.toISOString())
  })

  it('a stub (time_windows null) is no brief; any stored brief, even with no windows, is one', () => {
    expect(hasStoredBrief({ time_windows: null })).toBe(false)
    expect(hasStoredBrief({ time_windows: [] })).toBe(true)
    expect(hasStoredBrief({ time_windows: [{ window: 'x' }] })).toBe(true)
  })

  it('pre-season caption applies to upcoming and season_not_open only', () => {
    expect(isPreseasonState(ev('upcoming', { code: 'X', trip_start: '2026-10-15' }))).toBe(true)
    expect(isPreseasonState(ev('season_not_open', { code: 'X', season_start: '2026-10-15' }))).toBe(true)
    expect(isPreseasonState(ev('active'))).toBe(false)
    expect(isPreseasonState(ev('trip_ended'))).toBe(false)
    expect(isPreseasonState(null)).toBe(false)
  })
})
