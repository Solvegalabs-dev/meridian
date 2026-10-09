// Location rules for geo-templated agents. Pure, so the skip decision is testable without Supabase.
// There are no fallback coordinates: an objective without a location never borrows another area's data (FF-091 Part C).

export const LOCATION_NOT_SET = 'location_not_set'
// The objective has a location but no USGS gauge near it, so a gauge-templated agent has nothing to read (FF-100).
export const NO_GAUGE_FOR_SPOT = 'no_usgs_gauge_for_spot'

export type LocationFields = {
  lat?: number | string | null
  lon?: number | string | null
  nws_grid_office?: string | null
  nws_grid_x?: number | null
  nws_grid_y?: number | null
  state?: string | null
  // The up to five nearest stream gauges for the active pin, nearest first.
  usgs_gauge_ids?: string[] | null
}

export type LocationProfile = LocationFields | null

// Placeholders that need a point on the ground: coordinates or the NWS grid.
const POINT_PLACEHOLDERS = ['{lat}', '{lon}', '{nws_grid_office}', '{nws_grid_x}', '{nws_grid_y}']

export function templateNeedsCoordinates(template: string): boolean {
  return POINT_PLACEHOLDERS.some(p => template.includes(p))
}

// {usgs_gauge_ids} and {usgs_gauge_id} read the pin's own gauges. With none, the agent has nothing to read.
export function templateNeedsGauge(template: string): boolean {
  return template.includes('{usgs_gauge_ids}') || template.includes('{usgs_gauge_id}')
}

export function templateNeedsState(template: string): boolean {
  return template.includes('{state}')
}

// A profile has a point when it has coordinates and an NWS grid.
export function hasLocation(profile: LocationProfile): boolean {
  return profile != null
    && profile.lat != null && profile.lon != null
    && profile.nws_grid_office != null && profile.nws_grid_x != null && profile.nws_grid_y != null
}

// Why a geo-templated run is skipped, or null when it can run. Split by what the template needs:
// - coordinate or grid placeholders: skip unless the profile has a full location
// - {usgs_gauge_ids}: skip unless the profile has at least one gauge (a skip with its own reason, not an error)
// - {state} only: skip only when no state is known (profile or run context). No coordinates needed.
// Templates with none of these always run.
export function skipReason(
  template: string,
  profile: LocationProfile,
  runState?: string | null,
): string | null {
  if (templateNeedsCoordinates(template) && !hasLocation(profile)) return LOCATION_NOT_SET
  if (templateNeedsGauge(template) && !(profile?.usgs_gauge_ids && profile.usgs_gauge_ids.length > 0)) return NO_GAUGE_FOR_SPOT
  if (templateNeedsState(template) && !(profile?.state || runState)) return LOCATION_NOT_SET
  return null
}

export function shouldSkipForLocation(
  template: string,
  profile: LocationProfile,
  runState?: string | null,
): boolean {
  return skipReason(template, profile, runState) !== null
}
