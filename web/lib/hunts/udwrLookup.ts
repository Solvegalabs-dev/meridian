// Server-only client for the Utah DWR hunt boundary service.
// Service: https://dwrmapserv.utah.gov/dwrarcgis/rest/services/hunt/Boundaries_and_Tables/MapServer
//   Table 1  "NRDWRGIS.%HUNT_INFO_MOBILE": HUNT_NUMBER, BOUNDARYID (string), SEASON, BOUNDARY_NAME
//   Layer 0  "DWR_Hunt_Boundaries_combined": BoundaryID (small integer), Boundary_Name, polygon shape
// Terms of use for this service are not verified (open question for UDWR). Every display
// of this data carries "Source: Utah DWR".
const BASE = 'https://dwrmapserv.utah.gov/dwrarcgis/rest/services/hunt/Boundaries_and_Tables/MapServer'
const TIMEOUT_MS = 8000
const MAX_ATTEMPTS = 2 // one retry

export type UdwrRecord = {
  season_text: string | null
  boundary_id: string | null
  boundary_geojson: unknown | null
}

export type UdwrOutcome =
  | { status: 'found'; record: UdwrRecord }
  | { status: 'not_found' }
  | { status: 'error' }

export class UdwrHttpError extends Error {}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } })
  if (!res.ok) throw new UdwrHttpError(`HTTP ${res.status}`)
  const body = await res.json() as { error?: unknown }
  // ArcGIS reports some failures as 200 with an error object.
  if (body && typeof body === 'object' && 'error' in body && body.error) throw new UdwrHttpError('service error')
  return body
}

// One retry on any failure. Never throws: a failure becomes { status: 'error' }.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

// Fetches the season text and boundary for a hunt number. Only the hunt number is sent to UDWR.
export async function fetchHuntFromUdwr(code: string, fetchFn: typeof fetch = fetch): Promise<UdwrOutcome> {
  try {
    return await withRetry(async () => {
      const table = await getJson(
        `${BASE}/1/query?` + new URLSearchParams({
          where: `HUNT_NUMBER='${code}'`,
          outFields: 'HUNT_NUMBER,BOUNDARYID,SEASON,BOUNDARY_NAME',
          f: 'json',
        }),
        fetchFn,
      ) as { features?: Array<{ attributes: Record<string, unknown> }> }

      const attrs = table.features?.[0]?.attributes
      if (!attrs) return { status: 'not_found' as const }

      const boundaryId = typeof attrs.BOUNDARYID === 'string' && /^\d+$/.test(attrs.BOUNDARYID) ? attrs.BOUNDARYID : null
      const seasonText = typeof attrs.SEASON === 'string' ? attrs.SEASON : null

      let boundary: unknown | null = null
      if (boundaryId) {
        const geo = await getJson(
          `${BASE}/0/query?` + new URLSearchParams({
            where: `BoundaryID=${boundaryId}`,
            outFields: 'BoundaryID,Boundary_Name',
            returnGeometry: 'true',
            outSR: '4326',
            f: 'geojson',
          }),
          fetchFn,
        ) as { features?: unknown[] }
        boundary = geo.features && geo.features.length > 0 ? geo : null
      }

      return { status: 'found' as const, record: { season_text: seasonText, boundary_id: boundaryId, boundary_geojson: boundary } }
    })
  } catch {
    return { status: 'error' }
  }
}
