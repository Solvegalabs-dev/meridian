// FF-089 — Hunt unit resolver: point-in-polygon against hunt_unit_registry boundaries.
// Units from different hunt types overlap (a point can sit in a general-season unit and a
// limited-entry unit at once), so matches are ranked by hunt type — general bull first,
// the primary layer for the Strike Brief.
import { createServiceClient } from '@/lib/supabase/server'
import { inGeometry, type Geometry } from '@/lib/geo/pointInPolygon'

const HUNT_TYPE_PRIORITY = ['general_bull', 'limited_entry', 'spike_only']

// Point-in-polygon lives in pointInPolygon.ts (no server imports). Re-exported for existing callers.
export { inGeometry } from '@/lib/geo/pointInPolygon'

export async function findHuntUnit(lat: number, lon: number, state: string): Promise<string | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('hunt_unit_registry')
      .select('unit_id, hunt_type, boundary_geojson')
      .eq('state', state)
      .not('boundary_geojson', 'is', null)
    if (error || !data) return null

    const rank = (t: string | null) => {
      const i = HUNT_TYPE_PRIORITY.indexOf(t ?? '')
      return i < 0 ? HUNT_TYPE_PRIORITY.length : i
    }
    const match = data
      .filter(u => inGeometry(lon, lat, u.boundary_geojson as Geometry))
      .sort((a, b) => rank(a.hunt_type as string | null) - rank(b.hunt_type as string | null))[0]
    return (match?.unit_id as string | undefined) ?? null
  } catch {
    return null
  }
}
