// Whether hunt_seasons has rows for this objective's hunt. Season dates are never parsed from
// the DWR text; they come only from seeded rows (FF-091 B3).
import type { SupabaseClient } from '@supabase/supabase-js'
import { findSeasonRows, objectiveTimezone } from '@/lib/objectives/seasonMatcher'
import { localDateIn } from '@/lib/objectives/windowState'

export type SeasonProfileInput = {
  state: string | null
  taxonomy_key: string | null
  hunt_unit_id: string | null
  hunt_code: string | null
  lat?: number | null
  lon?: number | null
}

export async function seasonOnFile(
  supabase: SupabaseClient,
  profile: SeasonProfileInput,
  now: Date = new Date(),
): Promise<boolean> {
  const today = localDateIn(now, objectiveTimezone(profile))
  const rows = await findSeasonRows(supabase, profile, today)
  return rows.length > 0
}
