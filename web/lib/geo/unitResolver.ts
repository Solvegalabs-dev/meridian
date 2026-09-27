// FF-089 — Hunt unit resolver: point-in-polygon against hunt_unit_registry boundaries.
// Units from different hunt types overlap (a point can sit in a general-season unit and a
// limited-entry unit at once), so matches are ranked by hunt type — general bull first,
// the primary layer for the Strike Brief.
import { createServiceClient } from '@/lib/supabase/server'

type Ring = number[][] // [lon, lat] pairs
type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }

const HUNT_TYPE_PRIORITY = ['general_bull', 'limited_entry', 'spike_only']

// Ray casting: count edge crossings of a ray cast east from the point
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// GeoJSON polygon: first ring is the outer boundary, the rest are holes
function inPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (!rings[0] || !inRing(lon, lat, rings[0])) return false
  return !rings.slice(1).some(hole => inRing(lon, lat, hole))
}

function inGeometry(lon: number, lat: number, geometry: Geometry): boolean {
  if (geometry.type === 'Polygon') return inPolygon(lon, lat, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(p => inPolygon(lon, lat, p))
  return false
}

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
