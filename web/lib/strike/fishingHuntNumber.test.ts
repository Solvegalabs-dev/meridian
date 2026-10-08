// FF-096b: a hunt number never appears on a fishing objective's title or list row, even if a stale one is stored.
import { describe, it, expect } from 'vitest'
import { buildObjectiveTitle, resolveObjectiveTitle } from '@/lib/objectives/objectiveTitle'
import { evaluateWindowState } from '@/lib/objectives/windowState'
import { buildOtherObjectives, evaluationKey, type OtherProfileRow } from './otherObjectives'

describe('title', () => {
  it('leaves the hunt number out of a fishing title', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'trout.rainbow.fly_fishing', state: 'UT', huntCode: 'EA2004' }))
      .toBe('Rainbow trout, fly fishing (Utah)')
    expect(buildObjectiveTitle({ taxonomyKey: 'salmon.sockeye.river_migration', huntCode: 'EA2004' }))
      .toBe('Sockeye salmon, river migration')
  })

  it('still puts it first on a hunting title', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.cow.archery', state: 'UT', huntCode: 'EA2004' })).toBe('EA2004 antlerless elk (Utah)')
  })

  it('a stored raw-key fishing title is replaced by the readable one', () => {
    expect(resolveObjectiveTitle({ storedTitle: 'trout · rainbow · fly_fishing', taxonomyKey: 'trout.rainbow.fly_fishing', state: 'UT', huntCode: 'EA2004' }))
      .toBe('Rainbow trout, fly fishing (Utah)')
  })
})

describe('Other objectives row', () => {
  const profile = (over: Partial<OtherProfileRow>): OtherProfileRow => ({
    id: 'p1', objective_id: 'arc-1', user_id: 'u1', status: 'active',
    timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' },
    taxonomy_key: 'trout.rainbow.fly_fishing', state: 'UT', lat: null, lon: null, hunt_unit_id: null,
    hunt_code: 'EA2004', domain: 'fishing', ended_at: null, ended_reason: null, geo: null, created_at: null, ...over,
  })

  const build = (p: OtherProfileRow) => buildOtherObjectives({
    profiles: [p],
    evaluations: new Map([[evaluationKey(p), evaluateWindowState({ timing: p.timing, seasonRows: [], today: '2026-10-08', tz: 'America/Denver' })]]),
    briefs: new Map(),
    storedTitles: new Map(),
  })[0]

  it('a fishing row has no hunt number in its subtitle or title', () => {
    const row = build(profile({}))
    expect(row.subtitle).toBe('trout · rainbow · fly_fishing')
    expect(row.title).not.toContain('EA2004')
  })

  it('a hunting row keeps it', () => {
    const row = build(profile({ taxonomy_key: 'elk.cow.archery', domain: 'elk' }))
    expect(row.subtitle).toBe('EA2004 · elk · cow · archery')
    expect(row.title).toBe('EA2004 antlerless elk (Utah)')
  })

  it('the fishing domain alone counts, whatever the taxonomy key', () => {
    expect(build(profile({ taxonomy_key: 'mystery.catch.new', domain: 'fishing' })).subtitle).toBe('mystery · catch · new')
  })
})
