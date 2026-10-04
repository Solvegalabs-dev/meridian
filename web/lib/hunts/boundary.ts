// Spot pin checks against the cached hunt boundary (FF-091 B4). Warnings only, never blocks.
// Uses any cached boundary, even an expired one: the boundary is static, and a check never calls UDWR.
import type { SupabaseClient } from '@supabase/supabase-js'
import { insideBoundary } from './huntCode'
import { readCache } from './udwrCache'

// Whether a point is inside the objective's hunt boundary. Null when the objective has no
// hunt number or no cached boundary (unknown, not "outside").
export async function boundaryFlagForObjective(
  supabase: SupabaseClient,
  objectiveId: string,
  lat: number,
  lon: number,
): Promise<boolean | null> {
  const { data: profile } = await supabase
    .from('objective_profiles')
    .select('hunt_code')
    .eq('objective_id', objectiveId)
    .maybeSingle()
  const code = (profile?.hunt_code as string | null | undefined) ?? null
  if (!code) return null
  const row = await readCache(supabase, code)
  return insideBoundary(row?.boundary_geojson ?? null, lat, lon)
}

// Recomputes inside_boundary for every spot of an objective. Used after the hunt number changes.
export async function recomputeSpotBoundaryFlags(supabase: SupabaseClient, objectiveId: string): Promise<void> {
  const { data: spots } = await supabase
    .from('objective_spots')
    .select('id, lat, lon')
    .eq('objective_id', objectiveId)
  for (const spot of (spots ?? []) as Array<{ id: string; lat: number; lon: number }>) {
    const flag = await boundaryFlagForObjective(supabase, objectiveId, Number(spot.lat), Number(spot.lon))
    const { error } = await supabase.from('objective_spots').update({ inside_boundary: flag }).eq('id', spot.id)
    if (error) throw new Error(error.message)
  }
}
