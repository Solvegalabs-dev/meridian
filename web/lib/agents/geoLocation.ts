// Location rules for geo-templated agents. Pure, so the skip decision is testable without Supabase.
// There are no fallback coordinates: an objective without a location never borrows another area's data (FF-091 Part C).

export const LOCATION_NOT_SET = 'location_not_set'

export type LocationFields = {
  lat?: number | string | null
  lon?: number | string | null
  nws_grid_office?: string | null
  nws_grid_x?: number | null
  nws_grid_y?: number | null
  state?: string | null
}

export type LocationProfile = LocationFields | null

// Placeholders that need a point on the ground: coordinates or the NWS grid.
const POINT_PLACEHOLDERS = ['{lat}', '{lon}', '{nws_grid_office}', '{nws_grid_x}', '{nws_grid_y}']

export function templateNeedsCoordinates(template: string): boolean {
  return POINT_PLACEHOLDERS.some(p => template.includes(p))
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

// Skip rule, split by what the template needs:
// - coordinate or grid placeholders: skip unless the profile has a full location
// - {state} only: skip only when no state is known (profile or run context). No coordinates needed.
// Templates with neither placeholder always run.
export function shouldSkipForLocation(
  template: string,
  profile: LocationProfile,
  runState?: string | null,
): boolean {
  if (templateNeedsCoordinates(template) && !hasLocation(profile)) return true
  if (templateNeedsState(template) && !(profile?.state || runState)) return true
  return false
}
