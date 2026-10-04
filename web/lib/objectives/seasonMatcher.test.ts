import { describe, it, expect } from 'vitest'
import { matchSeasonRows, parseTaxonomyKey, type HuntSeasonRow, type SeasonProfile } from './seasonMatcher'

function row(overrides: Partial<HuntSeasonRow> & Pick<HuntSeasonRow, 'id'>): HuntSeasonRow {
  return {
    state: 'UT',
    species: 'elk',
    hunt_type: 'archery',
    sex_class: 'bull',
    hunt_unit_id: null,
    hunt_code: null,
    season_year: 2026,
    season_start: '2026-08-15',
    season_end: '2026-09-16',
    source_url: 'https://example.invalid/proclamation',
    source_checked_at: '2026-10-02',
    notes: null,
    ...overrides,
  }
}

const STATEWIDE_BULL_ARCHERY = row({ id: 'A' })
const ANY_SEX_ARCHERY = row({ id: 'E', sex_class: null })
const ANY_WEAPON_BULL = row({ id: 'B', hunt_type: 'any_weapon', season_start: '2026-10-01', season_end: '2026-10-15' })
const UNIT_BULL_ARCHERY = row({ id: 'C', hunt_unit_id: 'HD-316', season_start: '2026-08-20', season_end: '2026-09-05' })
const CODE_SPECIFIC = row({ id: 'G', hunt_code: 'EB1005' })
const DEER_ARCHERY = row({ id: 'D', species: 'deer', sex_class: null })
const LAST_YEAR = row({ id: 'F', season_year: 2025 })
const IDAHO = row({ id: 'I', state: 'ID' })

const ALL = [STATEWIDE_BULL_ARCHERY, ANY_SEX_ARCHERY, ANY_WEAPON_BULL, UNIT_BULL_ARCHERY, CODE_SPECIFIC, DEER_ARCHERY, LAST_YEAR, IDAHO]

function ids(rows: HuntSeasonRow[]) {
  return rows.map(r => r.id).sort()
}

const UT_ELK_BULL_ARCHERY: SeasonProfile = { state: 'UT', taxonomy_key: 'elk.bull.archery', hunt_unit_id: null }

describe('parseTaxonomyKey', () => {
  it('splits species, sex and hunt type', () => {
    expect(parseTaxonomyKey('elk.bull.archery')).toEqual({ species: 'elk', sex: 'bull', huntType: 'archery' })
  })

  it('leaves hunt type null when the key has none', () => {
    expect(parseTaxonomyKey('elk.bull')).toEqual({ species: 'elk', sex: 'bull', huntType: null })
  })

  it('returns null for a missing key', () => {
    expect(parseTaxonomyKey(null)).toBeNull()
    expect(parseTaxonomyKey('')).toBeNull()
  })
})

describe('matchSeasonRows', () => {
  it('matches species, sex and hunt type exactly, statewide', () => {
    expect(ids(matchSeasonRows(UT_ELK_BULL_ARCHERY, ALL, 2026))).toEqual(['A'])
  })

  it('a unit-specific row wins when the profile names that unit', () => {
    const r = matchSeasonRows({ ...UT_ELK_BULL_ARCHERY, hunt_unit_id: 'HD-316' }, ALL, 2026)
    expect(ids(r)).toEqual(['C'])
  })

  it('a unit-specific row never applies to a different unit', () => {
    const r = matchSeasonRows({ ...UT_ELK_BULL_ARCHERY, hunt_unit_id: 'HD-999' }, ALL, 2026)
    expect(ids(r)).toEqual(['A'])
  })

  it('falls back to a sex-agnostic row when the taxonomy sex has no match', () => {
    const r = matchSeasonRows({ state: 'UT', taxonomy_key: 'elk.cow.archery' }, ALL, 2026)
    expect(ids(r)).toEqual(['E'])
  })

  it('no hunt type in the taxonomy matches any season class for that sex', () => {
    const r = matchSeasonRows({ state: 'UT', taxonomy_key: 'elk.bull' }, ALL, 2026)
    expect(ids(r)).toEqual(['A', 'B'])
  })

  it('an unmatched hunt type (rifle) gets no rows: season unknown, not closed', () => {
    expect(matchSeasonRows({ state: 'UT', taxonomy_key: 'elk.bull.rifle' }, ALL, 2026)).toEqual([])
  })

  it('never matches a code-specific row for a profile with no hunt number', () => {
    expect(ids(matchSeasonRows(UT_ELK_BULL_ARCHERY, [CODE_SPECIFIC], 2026))).toEqual([])
  })

  it('matches a code-specific row only for the same hunt number', () => {
    const sameCode: SeasonProfile = { ...UT_ELK_BULL_ARCHERY, hunt_code: 'EB1005' }
    const otherCode: SeasonProfile = { ...UT_ELK_BULL_ARCHERY, hunt_code: 'EA2004' }
    expect(ids(matchSeasonRows(sameCode, [CODE_SPECIFIC], 2026))).toEqual(['G'])
    expect(ids(matchSeasonRows(otherCode, [CODE_SPECIFIC], 2026))).toEqual([])
  })

  it('the hunt number outranks the unit when both match', () => {
    const profile: SeasonProfile = { ...UT_ELK_BULL_ARCHERY, hunt_unit_id: 'HD-316', hunt_code: 'EB1005' }
    expect(ids(matchSeasonRows(profile, [STATEWIDE_BULL_ARCHERY, UNIT_BULL_ARCHERY, CODE_SPECIFIC], 2026))).toEqual(['G'])
  })

  it('filters by season year', () => {
    expect(matchSeasonRows(UT_ELK_BULL_ARCHERY, [LAST_YEAR], 2026)).toEqual([])
  })

  it('filters by state', () => {
    expect(matchSeasonRows({ ...UT_ELK_BULL_ARCHERY, state: 'ID' }, ALL, 2026).map(r => r.id)).toEqual(['I'])
  })

  it('filters by species', () => {
    expect(matchSeasonRows({ state: 'UT', taxonomy_key: 'deer.bull.archery' }, ALL, 2026).map(r => r.id)).toEqual(['D'])
  })

  it('no taxonomy or state means no rows', () => {
    expect(matchSeasonRows({ state: 'UT', taxonomy_key: null }, ALL, 2026)).toEqual([])
    expect(matchSeasonRows({ state: null, taxonomy_key: 'elk.bull.archery' }, ALL, 2026)).toEqual([])
  })

  it('no seeded rows at all means no match (season unknown)', () => {
    expect(matchSeasonRows(UT_ELK_BULL_ARCHERY, [], 2026)).toEqual([])
  })
})

// EA2004 (Chalk Creek): UT, elk, any_weapon, antlerless, 2026-08-01 to 2027-01-31, stored as season_year 2026.
const EA2004_ROW = row({
  id: 'EA2004',
  hunt_type: 'any_weapon',
  sex_class: 'antlerless',
  hunt_code: 'EA2004',
  hunt_unit_id: null,
  season_year: 2026,
  season_start: '2026-08-01',
  season_end: '2027-01-31',
})
const EA2004_PROFILE: SeasonProfile = {
  state: 'UT',
  taxonomy_key: 'elk.antlerless.any_weapon',
  hunt_unit_id: 'chalk-creek',
  hunt_code: 'EA2004',
}

describe('January year boundary', () => {
  it('a season running into January resolves on 2027-01-15 (the season started in 2026)', () => {
    expect(ids(matchSeasonRows(EA2004_PROFILE, [EA2004_ROW], 2027, '2027-01-15'))).toEqual(['EA2004'])
  })

  it('without a date the old single-year lookup still finds nothing in 2027', () => {
    expect(matchSeasonRows(EA2004_PROFILE, [EA2004_ROW], 2027)).toEqual([])
  })

  it('still resolves in the autumn of the start year', () => {
    expect(ids(matchSeasonRows(EA2004_PROFILE, [EA2004_ROW], 2026, '2026-10-04'))).toEqual(['EA2004'])
  })

  it('after the season has ended, the same row does not match (season unknown beyond its dates)', () => {
    expect(matchSeasonRows(EA2004_PROFILE, [EA2004_ROW], 2027, '2027-02-05')).toEqual([])
  })
})

