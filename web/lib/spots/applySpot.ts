// Shared by the spot routes and the PATCH /location route: resolve a point's geography
// (or reuse a fresh snapshot), then write it onto the objective profile.
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveFullGeography, type FullGeography } from '@/lib/geo/locationResolver'
import { toProfileColumns } from '@/lib/geo/profileColumns'

export const SNAPSHOT_MAX_AGE_DAYS = 30
export const NO_GRID_MESSAGE =
  'Could not resolve an NWS forecast grid for those coordinates. Check they are inside the US and try again.'

export class SpotError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: Record<string, unknown> = {}) {
    super(message)
  }
}

// A snapshot counts as fresh only with a known resolve time under 30 days old and an NWS grid.
export function isSnapshotFresh(
  snapshot: Partial<FullGeography> | null | undefined,
  resolvedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!snapshot || !snapshot.nws_grid_office || !resolvedAt) return false
  const t = Date.parse(resolvedAt)
  if (Number.isNaN(t)) return false
  return now.getTime() - t < SNAPSHOT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
}

// Columns written to the profile when a point is applied. hunt_unit_id is the objective's
// declared unit: a resolver result never overwrites it. The resolver only fills it in when
// the profile has none.
export function profileGeoColumns(
  geo: FullGeography,
  currentHuntUnitId: string | null | undefined
): Omit<FullGeography, 'hunt_unit_id' | 'usgs_gauge_nearest'> & { hunt_unit_id?: string | null } {
  const { hunt_unit_id, ...rest } = toProfileColumns(geo)
  if (currentHuntUnitId) return rest
  return { ...rest, hunt_unit_id: hunt_unit_id ?? null }
}

export type ResolvedSpotGeo = { geo: FullGeography; resolvedAt: string; reused: boolean }

// Reuses a fresh snapshot without calling external APIs. Otherwise re-resolves. Throws
// SpotError(422) when the point has no NWS grid, so nothing is written.
export async function resolveSpotGeo(
  lat: number,
  lon: number,
  spot: { geo_snapshot?: unknown; geo_resolved_at?: string | null },
  now: Date = new Date()
): Promise<ResolvedSpotGeo> {
  const snapshot = spot.geo_snapshot as Partial<FullGeography> | null | undefined
  if (isSnapshotFresh(snapshot, spot.geo_resolved_at, now)) {
    return { geo: snapshot as FullGeography, resolvedAt: spot.geo_resolved_at as string, reused: true }
  }
  const geo = await resolveFullGeography(lat, lon)
  if (!geo?.nws_grid_office) throw new SpotError(NO_GRID_MESSAGE, 422)
  return { geo, resolvedAt: now.toISOString(), reused: false }
}

const PROFILE_LOCATION_SELECT =
  'lat, lon, nws_grid_office, nws_grid_x, nws_grid_y, nws_zone_id, state, county, usgs_gauge_ids, snotel_station_ids, elevation_ft_avg, hunt_unit_id'

// Writes a point and its geography onto the objective profile. Returns the location row,
// or null when the objective has no profile.
export async function writeSpotToProfile(
  service: SupabaseClient,
  objectiveId: string,
  point: { lat: number; lon: number; geo: FullGeography }
) {
  const { data: current, error: readError } = await service
    .from('objective_profiles')
    .select('hunt_unit_id')
    .eq('objective_id', objectiveId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!current) return null

  const { data: updated, error } = await service
    .from('objective_profiles')
    .update({
      lat: point.lat,
      lon: point.lon,
      ...profileGeoColumns(point.geo, current.hunt_unit_id as string | null),
    })
    .eq('objective_id', objectiveId)
    .select(PROFILE_LOCATION_SELECT)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return updated
}

// Returns the objective to "location not set": coordinates and resolver geography are
// cleared. state and hunt_unit_id stay, because the season matcher still needs them.
export async function clearSpotFromProfile(service: SupabaseClient, objectiveId: string) {
  const { error } = await service
    .from('objective_profiles')
    .update({
      lat: null,
      lon: null,
      nws_grid_office: null,
      nws_grid_x: null,
      nws_grid_y: null,
      nws_zone_id: null,
      county: null,
      usgs_gauge_ids: [],
      snotel_station_ids: [],
      elevation_ft_avg: null,
    })
    .eq('objective_id', objectiveId)
  if (error) throw new Error(error.message)
}
