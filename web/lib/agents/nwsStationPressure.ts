// OUTDOOR_NOAA_BAROMETRIC (FF-100 Part 3). The NWS gridpoint has no pressure; stations do. Finds the stations near the
// spot, takes the first one that reports barometric pressure, and returns it in inHg with the change over the last
// few hours. CALCULATED:nws_station_pressure. Returns null (a miss) when no nearby station reports pressure.
import type { SourceDetail } from '@/lib/strike/signalFormat'
import { milesBetween } from './usgsNearest'

const NWS_HEADERS = { 'User-Agent': 'Meridian/1.0 (ghostnet5x5@gmail.com)', Accept: 'application/geo+json' }
const PA_TO_INHG = 0.00029530
// Stations tried, nearest first (the gridpoint lists them by distance).
const MAX_STATIONS = 3

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null)
const features = (body: unknown): Obj[] => {
  const f = asObj(body)?.features
  return Array.isArray(f) ? f.map(asObj).filter((x): x is Obj => x !== null) : []
}

export type PressureReading = { value: number; detail: NonNullable<SourceDetail> }

// observations: the station's feature list, newest first.
export function pressureFromObservations(observations: unknown, stationId: string): PressureReading | null {
  const points: Array<{ inhg: number; at: number }> = []
  for (const f of features(observations)) {
    const props = asObj(f.properties)
    const pa = asObj(props?.barometricPressure)?.value
    const at = Date.parse(String(props?.timestamp ?? ''))
    if (typeof pa === 'number' && Number.isFinite(pa) && !Number.isNaN(at)) points.push({ inhg: pa * PA_TO_INHG, at })
  }
  if (points.length === 0) return null
  const newest = points[0]
  const oldest = points[points.length - 1]
  const hours = (newest.at - oldest.at) / 3600000
  const detail: NonNullable<SourceDetail> = { kind: 'station', station_id: stationId }
  if (points.length > 1 && hours > 0) {
    detail.change_inhg = Math.round((newest.inhg - oldest.inhg) * 100) / 100
    detail.change_hours = Math.round(hours * 10) / 10
  }
  return { value: Math.round(newest.inhg * 100) / 100, detail }
}

export async function fetchStationPressure(
  grid: { office: string; x: number; y: number; lat?: number | null; lon?: number | null },
  fetchImpl: typeof fetch = fetch,
): Promise<PressureReading | null> {
  const get = async (url: string): Promise<unknown> => {
    const res = await fetchImpl(url, { headers: NWS_HEADERS, signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  const stations = features(await get(`https://api.weather.gov/gridpoints/${grid.office}/${grid.x},${grid.y}/stations`))
    .map(f => {
      const coords = asObj(f.geometry)?.coordinates
      const [lon, lat] = Array.isArray(coords) ? coords : []
      return { id: String(asObj(f.properties)?.stationIdentifier ?? ''), lat: Number(lat), lon: Number(lon) }
    })
    .filter(st => st.id)
    .slice(0, MAX_STATIONS)
  for (const st of stations) {
    const reading = pressureFromObservations(await get(`https://api.weather.gov/stations/${st.id}/observations?limit=4`), st.id)
    if (!reading) continue
    if (grid.lat != null && grid.lon != null && Number.isFinite(st.lat) && Number.isFinite(st.lon)) {
      reading.detail.distance_mi = Math.round(milesBetween(grid.lat, grid.lon, st.lat, st.lon) * 10) / 10
    }
    return reading
  }
  return null
}
