// FF-089 — Geographic Intelligence Engine: full location resolver
// Extends resolveNWSGridpoint() with state/county, nearby USGS stream gauges,
// nearby SNOTEL stations, elevation and hunt unit. Every source is non-fatal — a failed
// lookup yields null (or []) for its fields and never blocks the caller.
import { resolveNWSGridpoint } from '@/lib/geo/nwsGridpoint'
import { findHuntUnit } from '@/lib/geo/unitResolver'

export type FullGeography = {
  nws_grid_office: string | null
  nws_grid_x: number | null
  nws_grid_y: number | null
  nws_zone_id: string | null
  state: string | null              // 2-letter code, from the NWS county zone (e.g. UTC043 → UT)
  county: string | null             // county name, from the NWS county zone
  usgs_gauge_ids: string[]          // active stream gauges within 50 mi, nearest first
  snotel_station_ids: string[]      // active SNOTEL station IDs within 50 mi, nearest first
  elevation_ft_avg: number | null   // USGS 3DEP point elevation, NWS grid elevation fallback
  hunt_unit_id: string | null       // hunt_unit_registry unit containing the point (needs NWS state)
  // The nearest of those gauges with its site name and straight-line distance, for the fishing spot row.
  // Snapshot-only: there is no profile column for it (see lib/geo/profileColumns.ts). Absent on snapshots saved before FF-096b.
  usgs_gauge_nearest?: NearestGauge | null
}

export type NearestGauge = { site_no: string; name: string; distance_mi: number }

const NWS_HEADERS = { 'User-Agent': 'Meridian/1.0 (ghostnet5x5@gmail.com)' }
const GAUGE_RADIUS_MI = 50
const SNOTEL_RADIUS_MI = 50
const MAX_STATIONS = 5

function distanceMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(a))
}

async function fetchJson<T>(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

async function resolveCountyName(countyZoneId: string): Promise<string | null> {
  const data = await fetchJson<{ properties?: { name?: string } }>(
    `https://api.weather.gov/zones/county/${countyZoneId}`, 10000, NWS_HEADERS)
  return data?.properties?.name ?? null
}

type GaugeHit = { id: string; name: string; d: number }

// USGS site service has no radius parameter (lat/lng/radius → HTTP 400 "unrecognized keyword: lat"),
// so query a bounding box, then filter by distance.
async function resolveUSGSGauges(lat: number, lon: number): Promise<GaugeHit[]> {
  try {
    const dLat = GAUGE_RADIUS_MI / 69
    const dLon = GAUGE_RADIUS_MI / (69 * Math.cos((lat * Math.PI) / 180))
    const bBox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(n => n.toFixed(4)).join(',')
    const res = await fetch(
      `https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=${bBox}&siteType=ST&siteStatus=active`,
      { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []

    // RDB: '#' comments, a header row, a column-format row (5s, 15s, 16d…), then tab-separated data
    const rows = (await res.text()).split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && !l.startsWith('#'))
    const header = rows[0]?.split('\t') ?? []
    const iSite = header.indexOf('site_no')
    const iName = header.indexOf('station_nm')
    const iLat = header.indexOf('dec_lat_va')
    const iLon = header.indexOf('dec_long_va')
    if (iSite < 0 || iLat < 0 || iLon < 0) return []

    return rows.slice(1)
      .filter(r => !r.split('\t').every(c => /^\d+[sdn]$/.test(c)))
      .map(r => r.split('\t'))
      .map(c => ({ id: c[iSite], name: iName >= 0 ? (c[iName] ?? '').trim() : '', d: distanceMi(lat, lon, Number(c[iLat]), Number(c[iLon])) }))
      .filter(g => g.id && Number.isFinite(g.d) && g.d <= GAUGE_RADIUS_MI)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_STATIONS)
  } catch {
    return []
  }
}

// Site names arrive in capitals ("GREEN RIVER NEAR GREENDALE, UT"). Shown to a person, so ease them down.
export function readableGaugeName(raw: string): string {
  const name = raw.trim()
  if (!name || name !== name.toUpperCase()) return name
  return name.toLowerCase()
    .replace(/\b([a-z])/g, c => c.toUpperCase())
    .replace(/,\s*([a-z]{2})$/i, (_m, st: string) => `, ${st.toUpperCase()}`)
}

export function nearestGauge(gauges: GaugeHit[]): NearestGauge | null {
  const first = gauges[0]
  if (!first || !first.name) return null
  return { site_no: first.id, name: readableGaugeName(first.name), distance_mi: Math.round(first.d * 10) / 10 }
}

// AWDB ignores lat/lon bounds, so fetch the active SNTL network (~900 stations) and filter by distance.
// Returns bare station IDs to match the OUTDOOR_NRCS_SNOTEL template ({station_id}:-1:SNTL).
async function resolveSnotelStations(lat: number, lon: number): Promise<string[]> {
  const stations = await fetchJson<{ stationId?: string; latitude?: number; longitude?: number }[]>(
    'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?activeOnly=true&stationTriplets=*:*:SNTL', 15000)
  if (!Array.isArray(stations)) return []
  return stations
    .filter(s => s.stationId && s.latitude != null && s.longitude != null)
    .map(s => ({ id: s.stationId as string, d: distanceMi(lat, lon, s.latitude as number, s.longitude as number) }))
    .filter(s => s.d <= SNOTEL_RADIUS_MI)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_STATIONS)
    .map(s => s.id)
}

async function resolveEPQSElevation(lat: number, lon: number): Promise<number | null> {
  const data = await fetchJson<{ value?: number | string }>(
    `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Feet&wkid=4326`, 8000)
  const ft = Number(data?.value)
  // EPQS returns -1000000 for no-data points
  return Number.isFinite(ft) && ft > -1000 ? Math.round(ft) : null
}

async function resolveGridElevation(gridDataUrl: string): Promise<number | null> {
  const data = await fetchJson<{ properties?: { elevation?: { value?: number } } }>(gridDataUrl, 10000, NWS_HEADERS)
  const m = data?.properties?.elevation?.value
  return m != null && Number.isFinite(m) ? Math.round(m * 3.28084) : null
}

export async function resolveFullGeography(lat: number, lon: number): Promise<FullGeography | null> {
  const [grid, gauges, snotel_station_ids, epqsElevation] = await Promise.all([
    resolveNWSGridpoint(lat, lon),
    resolveUSGSGauges(lat, lon),
    resolveSnotelStations(lat, lon),
    resolveEPQSElevation(lat, lon),
  ])
  const usgs_gauge_ids = gauges.map(g => g.id)

  const countyZoneId = grid?.countyZoneId ?? null
  const state = countyZoneId && /^[A-Z]{2}C\d+$/.test(countyZoneId) ? countyZoneId.slice(0, 2) : null
  const [county, gridElevation, hunt_unit_id] = await Promise.all([
    countyZoneId ? resolveCountyName(countyZoneId) : Promise.resolve(null),
    epqsElevation == null && grid?.gridDataUrl ? resolveGridElevation(grid.gridDataUrl) : Promise.resolve(null),
    state ? findHuntUnit(lat, lon, state) : Promise.resolve(null),
  ])

  const result: FullGeography = {
    nws_grid_office: grid?.gridOffice ?? null,
    nws_grid_x: grid?.gridX ?? null,
    nws_grid_y: grid?.gridY ?? null,
    nws_zone_id: grid?.zoneId || null,
    state,
    county,
    usgs_gauge_ids,
    snotel_station_ids,
    elevation_ft_avg: epqsElevation ?? gridElevation,
    hunt_unit_id,
    usgs_gauge_nearest: nearestGauge(gauges),
  }

  const anyResolved = result.nws_grid_office != null || result.elevation_ft_avg != null
    || usgs_gauge_ids.length > 0 || snotel_station_ids.length > 0
  return anyResolved ? result : null
}
