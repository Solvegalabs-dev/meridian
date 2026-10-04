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
