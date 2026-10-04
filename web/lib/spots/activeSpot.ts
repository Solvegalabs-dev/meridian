// Reads which spot is active for an objective. Service client only: objective_spots has no RLS policies.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function loadActiveSpotId(supabase: SupabaseClient, objectiveId: string): Promise<string | null> {
  const { data } = await supabase
    .from('objective_spots')
    .select('id')
    .eq('objective_id', objectiveId)
    .eq('is_active', true)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// PostgREST `or` expression for agent_run_log hits that belong to the active spot.
// Rows written before spots existed have no geo_context.spotId. They are kept, so a brief
// is not thin on deploy day. Those rows are same-day only (the caller filters ran_at), and
// every run after deploy carries a spotId.
export function spotRunFilter(spotId: string): string {
  return `geo_context->>spotId.eq.${spotId},geo_context->>spotId.is.null`
}
