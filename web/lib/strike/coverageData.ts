// The one query behind coverage: which (state, species) pairs have hunt_seasons rows for this or next season year.
// hunt_seasons has RLS on with no policies, so this runs on the service client only.
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSeasonIndex, seasonYearsToCheck, type SeasonIndex } from '@/lib/strike/coverage'

// Null when the read fails, so a hunting pair is reported as unknown rather than uncovered.
export async function loadSeasonIndex(db: SupabaseClient, now: Date = new Date()): Promise<SeasonIndex | null> {
  const { data, error } = await db
    .from('hunt_seasons')
    .select('state, species')
    .in('season_year', seasonYearsToCheck(now))
  if (error) {
    console.error('[coverage] hunt_seasons read failed:', error.message)
    return null
  }
  return buildSeasonIndex((data ?? []) as Array<{ state: string | null; species: string | null }>)
}
