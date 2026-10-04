// Hunt spot operations. Routes do auth and parsing; this file does the work. Every function
// takes the service client and an objective id that the caller has already verified as owned.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FullGeography } from '@/lib/geo/locationResolver'
import { maxSpotsForUser, limitForResponse } from './limits'
import { validateCoordinates } from './coordinates'
import { boundaryFlagForObjective } from '@/lib/hunts/boundary'
import {
  SpotError,
  clearSpotFromProfile,
  resolveSpotGeo,
  writeSpotToProfile,
} from './applySpot'

export const NAME_MAX = 40
export const PRIMARY_SPOT_NAME = 'Primary spot'
const SPOT_COLUMNS = 'id, objective_id, name, lat, lon, is_active, sort_order, geo_snapshot, geo_resolved_at, hunt_unit_id, inside_boundary, activated_at, created_at'

export type SpotRow = {
  id: string
  objective_id: string
  name: string
  lat: number
  lon: number
  is_active: boolean
  sort_order: number
  geo_snapshot: Partial<FullGeography> | null
  geo_resolved_at: string | null
  hunt_unit_id: string | null
  inside_boundary: boolean | null
  activated_at: string | null
  created_at: string
}

export function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length < 1 || name.length > NAME_MAX) {
    throw new SpotError(`Name must be 1 to ${NAME_MAX} characters.`, 400)
  }
  return name
}

function assertCoordinates(lat: unknown, lon: unknown): { lat: number; lon: number } {
  const message = validateCoordinates(lat, lon)
  if (message) throw new SpotError(message, 400)
  return { lat: Number(lat), lon: Number(lon) }
}

async function loadSpot(service: SupabaseClient, objectiveId: string, spotId: string): Promise<SpotRow> {
  const { data, error } = await service
    .from('objective_spots')
    .select(SPOT_COLUMNS)
    .eq('id', spotId)
    .eq('objective_id', objectiveId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new SpotError('Not found', 404)
  return data as SpotRow
}

async function loadSpots(service: SupabaseClient, objectiveId: string): Promise<SpotRow[]> {
  const { data, error } = await service
    .from('objective_spots')
    .select(SPOT_COLUMNS)
    .eq('objective_id', objectiveId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as SpotRow[]
}

// Makes a spot the active one: the database swaps it atomically, then the profile gets the spot's geography.
async function activateInDatabase(
  service: SupabaseClient,
  objectiveId: string,
  spotId: string,
) {
  const { error } = await service.rpc('activate_objective_spot', {
    p_objective_id: objectiveId,
    p_spot_id: spotId,
  })
  if (error) throw new Error(error.message)
}

export async function listSpots(service: SupabaseClient, objectiveId: string, userId: string) {
  const spots = await loadSpots(service, objectiveId)
  const active = spots.find(s => s.is_active) ?? null
  return {
    spots,
    limit: limitForResponse(maxSpotsForUser(userId)),
    active_spot_id: active?.id ?? null,
  }
}

export async function createSpot(
  service: SupabaseClient,
  input: { objectiveId: string; userId: string; name: unknown; lat: unknown; lon: unknown; makeActive?: boolean },
  now: Date = new Date(),
) {
  const name = normalizeName(input.name)
  const { lat, lon } = assertCoordinates(input.lat, input.lon)

  const existing = await loadSpots(service, input.objectiveId)
  const limit = maxSpotsForUser(input.userId)
  if (existing.length >= limit) {
    throw new SpotError('Spot limit reached.', 403, { code: 'spot_limit_reached', limit: limitForResponse(limit) })
  }

  const makeActive = input.makeActive === true || existing.length === 0
  const { geo, resolvedAt } = await resolveSpotGeo(lat, lon, {}, now)
  const insideBoundary = await boundaryFlagForObjective(service, input.objectiveId, lat, lon)

  const { data: inserted, error } = await service
    .from('objective_spots')
    .insert({
      objective_id: input.objectiveId,
      user_id: input.userId,
      name,
      lat,
      lon,
      is_active: false,
      sort_order: existing.length,
      geo_snapshot: geo,
      geo_resolved_at: resolvedAt,
      hunt_unit_id: geo.hunt_unit_id ?? null,
      inside_boundary: insideBoundary,
    })
    .select(SPOT_COLUMNS)
    .single()
  if (error || !inserted) throw new Error(error?.message ?? 'Spot insert failed')

  let spot = inserted as SpotRow
  let location = null
  if (makeActive) {
    await activateInDatabase(service, input.objectiveId, spot.id)
    location = await writeSpotToProfile(service, input.objectiveId, { lat, lon, geo })
    spot = { ...spot, is_active: true, activated_at: new Date().toISOString() }
  }
  return { spot, location }
}

export async function activateSpot(
  service: SupabaseClient,
  objectiveId: string,
  spotId: string,
  now: Date = new Date(),
) {
  const spot = await loadSpot(service, objectiveId, spotId)
  // Snapshot under 30 days old is copied with no external calls; otherwise the point is re-resolved.
  const { geo, resolvedAt, reused } = await resolveSpotGeo(spot.lat, spot.lon, spot, now)

  if (!reused) {
    const { error } = await service
      .from('objective_spots')
      .update({ geo_snapshot: geo, geo_resolved_at: resolvedAt, hunt_unit_id: geo.hunt_unit_id ?? null })
      .eq('id', spot.id)
    if (error) throw new Error(error.message)
  }

  await activateInDatabase(service, objectiveId, spot.id)
  const insideBoundary = await boundaryFlagForObjective(service, objectiveId, spot.lat, spot.lon)
  const { error: flagError } = await service.from('objective_spots').update({ inside_boundary: insideBoundary }).eq('id', spot.id)
  if (flagError) throw new Error(flagError.message)
  const location = await writeSpotToProfile(service, objectiveId, { lat: spot.lat, lon: spot.lon, geo })
  return { spotId: spot.id, reused, location }
}

// Edits name and/or coordinates. Moving the active spot re-resolves and rewrites the profile.
// Moving an inactive spot only clears its snapshot, so the next switch re-resolves it.
// forceResolve re-resolves the active spot even when its coordinates did not change (the location editor).
export async function updateSpot(
  service: SupabaseClient,
  objectiveId: string,
  spotId: string,
  input: { name?: unknown; lat?: unknown; lon?: unknown },
  options: { forceResolve?: boolean } = {},
  now: Date = new Date(),
) {
  const spot = await loadSpot(service, objectiveId, spotId)
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = normalizeName(input.name)

  const coordsGiven = input.lat !== undefined || input.lon !== undefined
  const next = coordsGiven
    ? assertCoordinates(input.lat ?? spot.lat, input.lon ?? spot.lon)
    : { lat: spot.lat, lon: spot.lon }
  const moved = next.lat !== Number(spot.lat) || next.lon !== Number(spot.lon)
  if (moved || coordsGiven) Object.assign(patch, { lat: next.lat, lon: next.lon })

  if (moved || options.forceResolve) {
    patch.inside_boundary = await boundaryFlagForObjective(service, objectiveId, next.lat, next.lon)
  }

  if (spot.is_active && (moved || options.forceResolve)) {
    const { geo, resolvedAt } = await resolveSpotGeo(next.lat, next.lon, {}, now)
    const { error } = await service
      .from('objective_spots')
      .update({ ...patch, geo_snapshot: geo, geo_resolved_at: resolvedAt, hunt_unit_id: geo.hunt_unit_id ?? null })
      .eq('id', spot.id)
    if (error) throw new Error(error.message)
    const location = await writeSpotToProfile(service, objectiveId, { ...next, geo })
    return { location }
  }

  if (moved) Object.assign(patch, { geo_snapshot: null, geo_resolved_at: null })
  if (Object.keys(patch).length > 0) {
    const { error } = await service.from('objective_spots').update(patch).eq('id', spot.id)
    if (error) throw new Error(error.message)
  }
  return { location: null }
}

export async function deleteSpot(service: SupabaseClient, objectiveId: string, spotId: string) {
  const spot = await loadSpot(service, objectiveId, spotId)
  if (spot.is_active) {
    const all = await loadSpots(service, objectiveId)
    if (all.length > 1) {
      throw new SpotError('Make another spot the strike focus before deleting this one.', 409, { code: 'active_spot' })
    }
  }

  const { error } = await service.from('objective_spots').delete().eq('id', spot.id)
  if (error) throw new Error(error.message)
  if (spot.is_active) await clearSpotFromProfile(service, objectiveId)
}

// PATCH /location: edits the active spot's coordinates, or creates the first spot if none exists.
export async function setActiveLocation(
  service: SupabaseClient,
  input: { objectiveId: string; userId: string; lat: unknown; lon: unknown },
  now: Date = new Date(),
) {
  const spots = await loadSpots(service, input.objectiveId)
  const active = spots.find(s => s.is_active)
  if (active) {
    const { location } = await updateSpot(
      service, input.objectiveId, active.id, { lat: input.lat, lon: input.lon }, { forceResolve: true }, now,
    )
    return location
  }
  const { location } = await createSpot(service, {
    objectiveId: input.objectiveId,
    userId: input.userId,
    name: PRIMARY_SPOT_NAME,
    lat: input.lat,
    lon: input.lon,
    makeActive: true,
  }, now)
  return location
}

// The spot as the owner's UI sees it: coordinates, plus county and state from the snapshot.
export function spotView(spot: SpotRow) {
  const snap = spot.geo_snapshot ?? {}
  return {
    id: spot.id,
    name: spot.name,
    lat: Number(spot.lat),
    lon: Number(spot.lon),
    is_active: spot.is_active,
    county: (snap.county as string | null | undefined) ?? null,
    state: (snap.state as string | null | undefined) ?? null,
    hunt_unit_id: spot.hunt_unit_id,
    inside_boundary: spot.inside_boundary ?? null,
    activated_at: spot.activated_at,
  }
}
