// Point-in-polygon for GeoJSON geometry. No imports: safe for client bundles and for any module
// that must not pull in server code (lib/supabase/server, next/headers).

export type Ring = number[][] // [lon, lat] pairs
export type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }

// Ray casting: count edge crossings of a ray cast east from the point
export function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// GeoJSON polygon: first ring is the outer boundary, the rest are holes
export function inPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (!rings[0] || !inRing(lon, lat, rings[0])) return false
  return !rings.slice(1).some(hole => inRing(lon, lat, hole))
}

export function inGeometry(lon: number, lat: number, geometry: Geometry): boolean {
  if (geometry.type === 'Polygon') return inPolygon(lon, lat, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(p => inPolygon(lon, lat, p))
  return false
}
