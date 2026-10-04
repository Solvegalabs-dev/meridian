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

const GRID_AND_COORD_PLACEHOLDERS = ['{lat}', '{lon}', '{nws_grid_office}', '{nws_grid_x}', '{nws_grid_y}']

// True when the URL template needs a point on the ground (coordinates, NWS grid, or state).
export function templateNeedsLocation(template: string): boolean {
  return GRID_AND_COORD_PLACEHOLDERS.some(p => template.includes(p)) || template.includes('{state}')
}

// A profile has a location when it has coordinates and an NWS grid, which weather agents need.
export function hasLocation(profile: LocationProfile): boolean {
  return profile != null
    && profile.lat != null && profile.lon != null
    && profile.nws_grid_office != null && profile.nws_grid_x != null && profile.nws_grid_y != null
}

// Whether a run should be skipped: the template needs a location and the objective has none.
// Templates without location placeholders always run, as before.
export function shouldSkipForLocation(template: string, profile: LocationProfile): boolean {
  return templateNeedsLocation(template) && !hasLocation(profile)
}
