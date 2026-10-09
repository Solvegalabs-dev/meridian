// What each spot-level agent records from its response, and where the reading came from (FF-100). The generic
// extractor in agentHelpers reads "the first number" in a response, which for a multi-gauge USGS answer is not the
// nearest gauge's and for an NWS forecast is whatever field comes first. These agents name exactly what they take.
// A table keyed on the agent, so a new agent is one entry rather than another `if` in the runner.
import { nearestGaugeReading, type SpotPoint } from './usgsNearest'
import type { SourceDetail } from '@/lib/strike/signalFormat'

export type SpotContext = { gaugeIds: string[]; lat: number | string | null | undefined; lon: number | string | null | undefined }
export type Extraction = { value: number; detail: NonNullable<SourceDetail> }
type Extractor = (body: unknown, ctx: SpotContext) => Extraction | null

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null)

function usgsGauge(body: unknown, ctx: SpotContext): Extraction | null {
  const spot: SpotPoint = { lat: ctx.lat, lon: ctx.lon }
  const hit = nearestGaugeReading(body, ctx.gaugeIds, spot)
  if (!hit) return null
  return { value: hit.value, detail: { kind: 'gauge', site_no: hit.site_no, site_name: hit.site_name, distance_mi: hit.distance_mi } }
}

// The NWS forecast period for this hour (periods[0]).
function firstPeriod(body: unknown): Obj | null {
  const periods = asObj(asObj(body)?.properties)?.periods
  return Array.isArray(periods) ? asObj(periods[0]) : null
}

const FORECAST: NonNullable<SourceDetail> = { kind: 'forecast', provider: 'NWS' }

// "15 mph" or "10 to 20 mph": the first number, as the wind agent has always read it.
function firstNumber(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const m = text.match(/\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

const SPOT_EXTRACTORS: Record<string, Extractor> = {
  OUTDOOR_USGS_WATER_TEMP: usgsGauge,
  OUTDOOR_USGS_DISSOLVED_O2: usgsGauge,
  OUTDOOR_USGS_TURBIDITY: usgsGauge,
  OUTDOOR_USGS_STREAMFLOW_NEAR: usgsGauge,

  // Degrees Fahrenheit. The NWS says which unit it used; convert if it is not F.
  OUTDOOR_NOAA_TEMP: body => {
    const p = firstPeriod(body)
    const t = p?.temperature
    if (typeof t !== 'number' || !Number.isFinite(t)) return null
    const value = p?.temperatureUnit === 'C' ? t * 9 / 5 + 32 : t
    return { value, detail: FORECAST }
  },

  // Percent chance of precipitation this hour. A null from the NWS means no figure, which is a miss.
  OUTDOOR_NOAA_PRECIP: body => {
    const v = asObj(firstPeriod(body)?.probabilityOfPrecipitation)?.value
    return typeof v === 'number' && Number.isFinite(v) ? { value: v, detail: FORECAST } : null
  },

  // Miles per hour, with the gust beside it when the forecast gives one.
  OUTDOOR_WINDY_API: body => {
    const p = firstPeriod(body)
    const value = firstNumber(p?.windSpeed)
    if (value === null) return null
    const gust = firstNumber(p?.windGust)
    return { value, detail: gust === null ? FORECAST : { ...FORECAST, gust_mph: gust } }
  },
}

export function isSpotAgent(agentKey: string): boolean {
  return agentKey in SPOT_EXTRACTORS
}

export function extractSpotReading(agentKey: string, body: unknown, ctx: SpotContext): Extraction | null {
  const extractor = SPOT_EXTRACTORS[agentKey]
  return extractor ? extractor(body, ctx) : null
}
