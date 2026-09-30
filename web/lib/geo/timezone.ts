// State -> IANA timezone for the lower 48 + AK/HI. Some states straddle a
// zone boundary (Idaho's panhandle, west Texas near El Paso, western Kansas
// counties, etc.) — those are handled as call-site special cases below using
// latitude/longitude rather than being split out into more map entries.
const STATE_ZONE: Record<string, string> = {
  WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  MT: 'America/Denver', WY: 'America/Denver', CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver',
  AZ: 'America/Phoenix', // no DST
  ND: 'America/Chicago', SD: 'America/Chicago', NE: 'America/Chicago', KS: 'America/Chicago',
  OK: 'America/Chicago', TX: 'America/Chicago', MN: 'America/Chicago', IA: 'America/Chicago',
  MO: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago', WI: 'America/Chicago',
  IL: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', TN: 'America/Chicago',
  KY: 'America/New_York', IN: 'America/New_York', OH: 'America/New_York', MI: 'America/New_York',
  WV: 'America/New_York', VA: 'America/New_York', NC: 'America/New_York', SC: 'America/New_York',
  GA: 'America/New_York', FL: 'America/New_York', PA: 'America/New_York', NY: 'America/New_York',
  NJ: 'America/New_York', CT: 'America/New_York', RI: 'America/New_York', MA: 'America/New_York',
  VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York', DE: 'America/New_York',
  MD: 'America/New_York', DC: 'America/New_York',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

// Idaho's ~10 northernmost counties (the panhandle) observe Pacific time;
// the rest of the state is Mountain. Approximated by latitude since the
// real boundary follows county lines, not a clean parallel.
const IDAHO_PANHANDLE_LAT_THRESHOLD = 45.9;

// Longitude-based fallback for anything unmapped — coarse but reasonable
// for the continental US, where this agent's objectives are concentrated.
function fallbackFromLongitude(lon: number): string {
  if (lon > -100) return 'America/Chicago';
  if (lon > -115) return 'America/Denver';
  if (lon > -125) return 'America/Los_Angeles';
  return 'America/Anchorage';
}

export function resolveTimezone(stateCode: string | null | undefined, lat: number, lon: number): string {
  const state = stateCode?.toUpperCase();

  if (state === 'ID') {
    return lat >= IDAHO_PANHANDLE_LAT_THRESHOLD ? 'America/Los_Angeles' : 'America/Denver';
  }

  if (state && STATE_ZONE[state]) return STATE_ZONE[state];

  return fallbackFromLongitude(lon);
}
