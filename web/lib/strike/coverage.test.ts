import { describe, it, expect } from 'vitest'
import {
  buildSeasonIndex,
  checkCoverage,
  coverageDecision,
  coverageNotice,
  seasonIndexKey,
  seasonYearsToCheck,
  toStateCode,
  COVERAGE_MODE,
  type CoverageOverride,
} from './coverage'

// What hunt_seasons holds today: Utah elk and mule deer (stored under the species root 'deer').
const index = buildSeasonIndex([
  { state: 'UT', species: 'elk' },
  { state: 'ut', species: 'Deer' },
  { state: 'UT', species: 'elk' }, // duplicate rows collapse
])

const cover = (taxonomyKey: string, state: string | null, extra: { overrides?: CoverageOverride[]; seasonIndex?: typeof index | null } = {}) =>
  checkCoverage({ taxonomyKey, state, seasonIndex: extra.seasonIndex === undefined ? index : extra.seasonIndex, overrides: extra.overrides })

describe('checkCoverage', () => {
  it('UT elk is covered by hunt_seasons rows', () => {
    expect(cover('elk.bull.archery', 'UT')).toMatchObject({ covered: true, basis: 'hunt_seasons', species: 'elk', stateCode: 'UT' })
  })

  it('UT trout is covered by the fishing config', () => {
    expect(cover('trout.rainbow.fly_fishing', 'UT')).toMatchObject({ covered: true, basis: 'fishing_config' })
    expect(cover('trout.brown.fly_fishing', 'MT')).toMatchObject({ covered: true })
  })

  it('KS turkey is not covered', () => {
    expect(cover('turkey.eastern.archery', 'KS')).toMatchObject({ covered: false, basis: 'hunt_seasons', species: 'turkey', stateLabel: 'Kansas' })
  })

  it('a species with no rows in a covered state is not covered, and elk in another state is not either', () => {
    expect(cover('turkey.eastern.archery', 'UT').covered).toBe(false)
    expect(cover('elk.bull.rifle', 'KS').covered).toBe(false)
  })

  it('fishing needs the config, its agents, and a state the config supports', () => {
    expect(cover('salmon.sockeye.river_migration', 'AK').covered).toBe(true)
    expect(cover('salmon.sockeye.river_migration', 'UT').covered).toBe(false) // Alaska-scoped
    expect(cover('trout.rainbow.fly_fishing', 'KS').covered).toBe(false)      // not a supported state
    expect(cover('trout.golden.fly_fishing', 'UT').covered).toBe(false)       // no config for that key
  })

  it('reads a state typed as a code in any case, or as a full name', () => {
    expect(cover('elk.bull.archery', 'ut').covered).toBe(true)
    expect(cover('elk.bull.archery', ' Utah ').covered).toBe(true)
    expect(toStateCode('new  mexico')).toBe('NM')
    expect(toStateCode('ZZ')).toBeNull()
    expect(toStateCode('')).toBeNull()
  })

  it('cannot judge a blank state or an empty species: null, so no notice', () => {
    expect(cover('elk.bull.archery', '')).toMatchObject({ covered: null, basis: 'unknown_state' })
    expect(cover('elk.bull.archery', null).covered).toBeNull()
    expect(cover('', 'UT')).toMatchObject({ covered: null, basis: 'unknown_species' })
  })

  it('treats a state it does not recognise as uncovered, and keeps what the user typed for the notice', () => {
    expect(cover('elk.bull.archery', 'Narnia')).toMatchObject({ covered: false, basis: 'unrecognized_state', stateLabel: 'Narnia' })
  })

  it('a failed season read is "unknown" for hunting, never "uncovered", and does not affect fishing', () => {
    expect(cover('elk.bull.archery', 'UT', { seasonIndex: null })).toMatchObject({ covered: null, basis: 'data_unavailable' })
    expect(cover('trout.rainbow.fly_fishing', 'UT', { seasonIndex: null }).covered).toBe(true)
  })

  it('the override list wins over the data, both ways', () => {
    const force: CoverageOverride[] = [{ species: 'turkey', state: 'KS', covered: true }, { species: 'elk', state: 'UT', covered: false }]
    expect(cover('turkey.eastern.archery', 'KS', { overrides: force })).toMatchObject({ covered: true, basis: 'override' })
    expect(cover('elk.bull.archery', 'UT', { overrides: force })).toMatchObject({ covered: false, basis: 'override' })
  })
})

describe('season index', () => {
  it('keys are state and species, normalised', () => {
    expect(seasonIndexKey(' ut ', 'ELK')).toBe('UT|elk')
    expect(index.size).toBe(2)
  })

  it('checks the current season year and the next', () => {
    expect(seasonYearsToCheck(new Date('2026-10-08T00:00:00Z'))).toEqual([2026, 2027])
  })
})

describe('notice and decision', () => {
  it('names the species and the state in full, and says the objective can still be created', () => {
    const c = cover('turkey.eastern.archery', 'KS')
    expect(coverageNotice(c, 'warn')).toBe(
      "We don't have turkey data for Kansas yet. You can still create this objective, but briefs will be limited and may stay empty.",
    )
  })

  it("'block' mode says it can't be created", () => {
    expect(coverageNotice(cover('turkey.eastern.archery', 'KS'), 'block')).toContain("can't be created")
  })

  it("ships in 'warn' mode", () => {
    expect(COVERAGE_MODE).toBe('warn')
  })

  it('warn: an uncovered selection needs one extra tap, and proceeds once confirmed', () => {
    expect(coverageDecision('warn', false, false)).toBe('confirm')
    expect(coverageDecision('warn', false, true)).toBe('proceed')
  })

  it('a covered or unknown selection proceeds with no extra tap', () => {
    expect(coverageDecision('warn', true, false)).toBe('proceed')
    expect(coverageDecision('warn', null, false)).toBe('proceed')
    expect(coverageDecision('block', true, false)).toBe('proceed')
    expect(coverageDecision('block', null, false)).toBe('proceed')
  })

  it('block: an uncovered selection is blocked, and confirming does not help', () => {
    expect(coverageDecision('block', false, false)).toBe('blocked')
    expect(coverageDecision('block', false, true)).toBe('blocked')
  })
})
