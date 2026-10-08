// Data coverage for a species and state (FF-096 Part 3). Pure: the season index is passed in, so the same
// rules run in the intake notice, the create route and the "Limited data" chip on the list.
//
// "Covered" comes from real data, not a guess:
//   Hunting: hunt_seasons has rows for that state and species for the current or next season year.
//   Fishing: the fishing taxonomy config exists for the key, it lists agents, and the state is one that
//            config supports (an Alaska-scoped species needs AK; a US_WEST one needs a supported state).
// COVERAGE_OVERRIDES lets a (species, state) pair be forced covered or uncovered without touching the rules.
import { FISHING_TAXONOMY, FISHING_SUPPORTED_STATES, isFishingTaxonomyKey } from '@/lib/strike/config/fishing-taxonomy'
import { STATE_NAMES, stateName } from '@/lib/objectives/objectiveTitle'

// 'warn': an uncovered selection shows a notice and needs one extra tap. 'block': it cannot be created.
export type CoverageMode = 'warn' | 'block'
export const COVERAGE_MODE: CoverageMode = 'warn'

export type CoverageOverride = {
  species: string // taxonomy root: 'elk', 'deer', 'turkey', 'trout', 'salmon'
  state: string   // two-letter code
  covered: boolean
}
// Add an entry to force a pair either way. Empty by default: the data decides.
export const COVERAGE_OVERRIDES: CoverageOverride[] = []

// hunt_seasons rows are read for this season year and the next.
export function seasonYearsToCheck(now: Date): number[] {
  const y = now.getUTCFullYear()
  return [y, y + 1]
}

// A set of "UT|elk" keys: one per state and species that has a season row.
export type SeasonIndex = Set<string>

export function seasonIndexKey(state: string, species: string): string {
  return `${state.trim().toUpperCase()}|${species.trim().toLowerCase()}`
}

export function buildSeasonIndex(rows: Array<{ state?: string | null; species?: string | null }>): SeasonIndex {
  const index: SeasonIndex = new Set()
  for (const r of rows) if (r.state && r.species) index.add(seasonIndexKey(r.state, r.species))
  return index
}

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
)

// "ut", "UT" and "Utah" all become "UT". Anything else is null.
export function toStateCode(input: string | null | undefined): string | null {
  const raw = (input ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return null
  if (raw.length === 2) return STATE_NAMES[raw.toUpperCase()] ? raw.toUpperCase() : null
  return NAME_TO_CODE[raw.toLowerCase()] ?? null
}

export type CoverageBasis = 'override' | 'hunt_seasons' | 'fishing_config' | 'unknown_state' | 'unknown_species' | 'unrecognized_state' | 'data_unavailable'

export type Coverage = {
  // null when it cannot be judged: no state yet, or no species.
  covered: boolean | null
  basis: CoverageBasis
  species: string
  stateCode: string | null
  stateLabel: string
}

type FishingConfig = { agent_bundle: string[]; geo_scope: string }

function fishingCovered(key: string, stateCode: string): boolean {
  const config = (FISHING_TAXONOMY as unknown as Record<string, FishingConfig | undefined>)[key]
  if (!config || config.agent_bundle.length === 0) return false
  if (config.geo_scope === 'US_WEST') return FISHING_SUPPORTED_STATES.includes(stateCode)
  return config.geo_scope === stateCode
}

export function checkCoverage(input: {
  taxonomyKey: string | null | undefined
  state: string | null | undefined
  // null when the season read failed: a hunting pair then cannot be judged (covered: null), never "uncovered".
  seasonIndex: SeasonIndex | null
  overrides?: CoverageOverride[]
}): Coverage {
  const key = (input.taxonomyKey ?? '').trim().toLowerCase()
  const species = key.split('.')[0] ?? ''
  const rawState = (input.state ?? '').trim()
  const stateCode = toStateCode(rawState)
  const stateLabel = stateName(stateCode ?? rawState) ?? rawState

  const base = { species, stateCode, stateLabel }
  if (!species) return { ...base, covered: null, basis: 'unknown_species' }
  if (!rawState) return { ...base, covered: null, basis: 'unknown_state' }
  if (!stateCode) return { ...base, covered: false, basis: 'unrecognized_state' }

  const override = (input.overrides ?? COVERAGE_OVERRIDES).find(o => o.species === species && o.state.toUpperCase() === stateCode)
  if (override) return { ...base, covered: override.covered, basis: 'override' }

  if (isFishingTaxonomyKey(key)) return { ...base, covered: fishingCovered(key, stateCode), basis: 'fishing_config' }
  if (!input.seasonIndex) return { ...base, covered: null, basis: 'data_unavailable' }
  return { ...base, covered: input.seasonIndex.has(seasonIndexKey(stateCode, species)), basis: 'hunt_seasons' }
}

export function coverageNotice(c: Pick<Coverage, 'species' | 'stateLabel'>, mode: CoverageMode = COVERAGE_MODE): string {
  const head = `We don't have ${c.species} data for ${c.stateLabel} yet.`
  return mode === 'block'
    ? `${head} This objective can't be created until we do.`
    : `${head} You can still create this objective, but briefs will be limited and may stay empty.`
}

// What the form does when the user taps Create. 'confirm' means show the notice and wait for one more tap.
export type CoverageDecision = 'proceed' | 'confirm' | 'blocked'

export function coverageDecision(mode: CoverageMode, covered: boolean | null, confirmed: boolean): CoverageDecision {
  if (covered !== false) return 'proceed'
  if (mode === 'block') return 'blocked'
  return confirmed ? 'proceed' : 'confirm'
}
