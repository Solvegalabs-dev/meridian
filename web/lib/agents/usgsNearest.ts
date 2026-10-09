// Picks the reading of the NEAREST USGS gauge that actually measured something (FF-100 Part 1). A request for several
// gauges returns only the gauges that report the parameter, so the first value in the response is not the nearest
// gauge's and may belong to a gauge many miles away. The pin's gauges are listed nearest first
// (objective_profiles.usgs_gauge_ids); this walks that list and takes the first gauge with a usable value.
// Pure: no network, no database.

export type NearestGaugeReading = {
  value: number
  site_no: string
  site_name: string
  // Straight-line miles from the spot to the gauge, 1 decimal. Null when the spot or the gauge has no coordinates.
  distance_mi: number | null
}

export type SpotPoint = { lat: number | string | null | undefined; lon: number | string | null | undefined }

const EARTH_RADIUS_MI = 3958.8

export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)))
}

// USGS qualifier codes that mean the value is not a usable measurement: equipment malfunction, maintenance, ice,
// discontinued, seasonal shutdown, rating being developed. ("P" provisional and "e" estimated are real values.)
const MISSING_QUALIFIERS = new Set(['Eqp', 'Mnt', 'Ice', 'Dis', 'Ssn', 'Rat', 'Pmp'])

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null)
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

type Candidate = { value: number; at: number }

// The newest usable value in one time series, or null.
function newestUsable(series: Obj): Candidate | null {
  const noData = Number(asObj(series.variable)?.noDataValue)
  let best: Candidate | null = null
  for (const block of asArr(series.values)) {
    for (const point of asArr(asObj(block)?.value)) {
      const p = asObj(point)
      if (!p) continue
      const raw = typeof p.value === 'string' ? p.value.trim() : p.value
      if (raw === '' || raw === null || raw === undefined) continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      if (Number.isFinite(noData) && value === noData) continue
      if (asArr(p.qualifiers).some(q => MISSING_QUALIFIERS.has(String(q)))) continue
      const at = Date.parse(String(p.dateTime ?? ''))
      const candidate = { value, at: Number.isNaN(at) ? 0 : at }
      if (!best || candidate.at >= best.at) best = candidate
    }
  }
  return best
}

export function nearestGaugeReading(response: unknown, orderedSiteIds: string[], spot: SpotPoint): NearestGaugeReading | null {
  const series = asArr(asObj(asObj(response)?.value)?.timeSeries).map(asObj).filter((s): s is Obj => s !== null)
  const spotLat = Number(spot.lat)
  const spotLon = Number(spot.lon)
  const haveSpot = spot.lat != null && spot.lon != null && Number.isFinite(spotLat) && Number.isFinite(spotLon)

  for (const siteNo of orderedSiteIds) {
    // A site can report the parameter from more than one sensor; take the newest usable value among them.
    let best: Candidate | null = null
    let info: Obj | null = null
    for (const s of series) {
      const source = asObj(s.sourceInfo)
      const code = asArr(source?.siteCode).map(asObj).find(c => c !== null)
      if (String(code?.value ?? '') !== siteNo) continue
      const candidate = newestUsable(s)
      if (candidate && (!best || candidate.at >= best.at)) {
        best = candidate
        info = source
      }
    }
    if (!best || !info) continue

    const loc = asObj(asObj(info.geoLocation)?.geogLocation)
    const gaugeLat = Number(loc?.latitude)
    const gaugeLon = Number(loc?.longitude)
    const distance = haveSpot && Number.isFinite(gaugeLat) && Number.isFinite(gaugeLon)
      ? Math.round(milesBetween(spotLat, spotLon, gaugeLat, gaugeLon) * 10) / 10
      : null
    return { value: best.value, site_no: siteNo, site_name: String(info.siteName ?? siteNo), distance_mi: distance }
  }
  return null
}
