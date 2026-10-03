// Season matcher: maps an objective profile to rows in hunt_seasons.
//
// This is the ONLY place that knows the hunting taxonomy shape
// (species.sex[.hunt_type], e.g. 'elk.bull.archery'). windowState.ts stays
// domain-agnostic and receives already-matched rows.
//
// No season rows for an objective means "season unknown" — the caller must
// treat that as open and rely on the trip window. Never as closed.
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTimezone } from '@/lib/geo/timezone'
import type { SeasonWindow } from './windowState'

export type HuntSeasonRow = SeasonWindow & {
  id: string
  state: string
  species: string
  hunt_type: string
  sex_class: string | null
  hunt_unit_id: string | null
  hunt_code: string | null
  season_year: number
  source_url: string
  source_checked_at: string
  notes: string | null
}

export type SeasonProfile = {
  state: string | null
  taxonomy_key: string | null
  hunt_unit_id?: string | null
}

export type ParsedTaxonomy = {
  species: string
  sex: string | null
  huntType: string | null
}

// 'elk.bull.archery' -> { elk, bull, archery }; 'elk.bull' -> { elk, bull, null }
// Returns null for keys that do not have a species segment.
export function parseTaxonomyKey(key: string | null | undefined): ParsedTaxonomy | null {
  if (!key) return null
  const [species, sex, huntType] = key.toLowerCase().split('.')
  if (!species) return null
  return { species, sex: sex || null, huntType: huntType || null }
}

// Specificity score: higher is more specific. Hard mismatches return -1 and
// are excluded before scoring.
function scoreRow(row: HuntSeasonRow, profile: SeasonProfile, tax: ParsedTaxonomy): number {
  // Season-class: taxonomy hunt type must equal the row's when the taxonomy
  // names one. When it does not, any hunt type can match (lowest tier).
  if (tax.huntType && row.hunt_type !== tax.huntType) return -1

  // Sex: a sex-specific row needs the same sex; a sex-agnostic row (null) always fits.
  if (row.sex_class !== null && row.sex_class !== tax.sex) return -1

  // Unit: a unit-specific row only applies to that unit; statewide rows apply to all.
  if (row.hunt_unit_id !== null && row.hunt_unit_id !== (profile.hunt_unit_id ?? null)) return -1

  // hunt_code needs a profile-level code, which objective_profiles does not carry yet.
  // A code-specific row therefore never matches automatically.
  if (row.hunt_code !== null) return -1

  let score = 0
  if (tax.huntType) score += 4
  if (row.sex_class !== null) score += 2
  if (row.hunt_unit_id !== null) score += 8
  return score
}

// Pure matcher. Returns the rows at the highest specificity tier that match.
export function matchSeasonRows(
  profile: SeasonProfile,
  rows: HuntSeasonRow[],
  seasonYear: number
): HuntSeasonRow[] {
  const tax = parseTaxonomyKey(profile.taxonomy_key)
  const state = profile.state?.toUpperCase() ?? null
  if (!tax || !state) return []

  const scored: Array<{ row: HuntSeasonRow; score: number }> = []
  for (const row of rows) {
    if (row.state.toUpperCase() !== state) continue
    if (row.species.toLowerCase() !== tax.species) continue
    if (row.season_year !== seasonYear) continue
    const score = scoreRow(row, profile, tax)
    if (score < 0) continue
    scored.push({ row, score })
  }
  if (scored.length === 0) return []

  const best = Math.max(...scored.map(s => s.score))
  return scored.filter(s => s.score === best).map(s => s.row)
}

// Loads season rows for an objective. Uses the service client; hunt_seasons has
// RLS on with no policies, so only the service role can read it.
export async function findSeasonRows(
  supabase: SupabaseClient,
  profile: SeasonProfile,
  today: string // YYYY-MM-DD local date
): Promise<HuntSeasonRow[]> {
  const tax = parseTaxonomyKey(profile.taxonomy_key)
  const state = profile.state?.toUpperCase() ?? null
  if (!tax || !state) return []

  const seasonYear = Number(today.slice(0, 4))
  const { data, error } = await supabase
    .from('hunt_seasons')
    .select('*')
    .eq('state', state)
    .eq('species', tax.species)
    .eq('season_year', seasonYear)
  if (error) {
    console.error('[seasonMatcher] hunt_seasons read failed:', error.message)
    return []
  }
  return matchSeasonRows(profile, (data ?? []) as HuntSeasonRow[], seasonYear)
}

// Timezone for an objective. Coordinates only break ties inside a multi-zone
// state; a known state decides the zone by itself.
export function objectiveTimezone(profile: { state: string | null; lat?: number | null; lon?: number | null }): string {
  return resolveTimezone(profile.state, profile.lat ?? 40, profile.lon ?? -105)
}
