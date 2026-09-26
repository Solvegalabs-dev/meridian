// FF-074 — NWS gridpoint resolver
// Resolves lat/lon → NWS grid office, grid x/y, zone ID.
// Result is cached on objective_profiles — never call twice for the same objective.

export type NWSGridpoint = {
  gridOffice: string  // e.g. 'GJT'
  gridX: number       // e.g. 69
  gridY: number       // e.g. 170
  zoneId: string      // e.g. 'UTZ017'
  countyZoneId?: string // e.g. 'UTC043' — first two letters are the state code
  gridDataUrl?: string  // raw gridpoint URL (carries grid elevation)
}

export async function resolveNWSGridpoint(lat: number, lon: number): Promise<NWSGridpoint | null> {
  try {
    const url = `https://api.weather.gov/points/${lat},${lon}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Meridian/1.0 (ghostnet5x5@gmail.com)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      properties?: {
        gridId?: string
        gridX?: number
        gridY?: number
        forecastZone?: string
        county?: string
        forecastGridData?: string
      }
    };

    const p = data.properties;
    if (!p?.gridId || p.gridX == null || p.gridY == null) return null;

    const zoneId = p.forecastZone?.split('/').pop() ?? '';

    return {
      gridOffice: p.gridId,
      gridX: p.gridX,
      gridY: p.gridY,
      zoneId,
      countyZoneId: p.county?.split('/').pop(),
      gridDataUrl: p.forecastGridData,
    };
  } catch {
    return null;
  }
}
