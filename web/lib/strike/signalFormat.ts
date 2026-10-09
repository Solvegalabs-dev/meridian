// One place that says what each agent's stored number means and how to show it (FF-099). The Signals tab, the
// signal chips and the brief prompt (lib/strikeBrief/evidence.ts re-exports from here) all use this table, so
// they show the same text. Display only: stored values are never changed. Pure and client-safe.

export type Reading = {
  agent_key: string
  observed_value: number | string | null
  source: string | null
  recorded_at: string
  // Where the reading came from. Missing on old rows.
  source_detail?: SourceDetail
}

const DAY_MS = 24 * 60 * 60 * 1000

// An estimated reading of exactly 0 is a failed lookup written as a value (OUTDOOR_NOAA_TEMP writes it for every
// run when its URL fails), not a measurement. It shows as "No data" and is left out of trends and sparklines.
export function isPlaceholderReading(r: { observed_value: number | string | null; source: string | null }): boolean {
  if (r.observed_value === null || r.observed_value === '') return true
  const value = Number(r.observed_value)
  if (!Number.isFinite(value)) return true
  return r.source === 'estimated' && value === 0
}

export function isUsableReading(r: Reading): boolean {
  return !isPlaceholderReading(r)
}

// ─── Moon ────────────────────────────────────────────────────────────────────

const SYNODIC_DAYS = 29.530588
// A known new moon: 2000-01-06 18:14 UTC.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14)

export function moonInfo(at: Date): { ageDays: number; illumination: number; waxing: boolean; daysToNew: number; daysToFull: number } {
  const raw = ((at.getTime() - NEW_MOON_EPOCH_MS) / DAY_MS) % SYNODIC_DAYS
  const ageDays = raw < 0 ? raw + SYNODIC_DAYS : raw
  const half = SYNODIC_DAYS / 2
  return {
    ageDays,
    illumination: 50 * (1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_DAYS)),
    waxing: ageDays < half,
    daysToNew: SYNODIC_DAYS - ageDays,
    daysToFull: ageDays < half ? half - ageDays : SYNODIC_DAYS + half - ageDays,
  }
}

// The stored value is percent illuminated only, so it cannot say waxing or waning by itself. A previous reading
// settles it (rising is waxing, falling is waning). With only one reading the calendar date decides.
export function moonDirection(percent: number, at: Date, previousPercent?: number | null): boolean {
  if (previousPercent !== null && previousPercent !== undefined && Number.isFinite(previousPercent) && Math.abs(percent - previousPercent) > 0.05) {
    return percent > previousPercent
  }
  return moonInfo(at).waxing
}

export function moonPhaseName(percent: number, waxing: boolean): string {
  if (percent < 3) return 'new moon'
  if (percent > 97) return 'full moon'
  if (percent >= 40 && percent <= 60) return waxing ? 'first quarter' : 'last quarter'
  return `${waxing ? 'waxing' : 'waning'} ${percent < 40 ? 'crescent' : 'gibbous'}`
}

// A light note, only where it is certain.
export function moonNightNote(percent: number): string | null {
  if (percent < 10) return 'Darker nights'
  if (percent > 90) return 'Bright nights'
  return null
}

const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

// For the brief prompt: "9% illuminated, waning (new moon in about 2 days)".
export function describeMoon(percentIlluminated: number, at: Date): string {
  const info = moonInfo(at)
  const pct = `${Math.round(percentIlluminated)}% illuminated`
  if (info.waxing) return `${pct}, waxing (full moon in about ${plural(Math.max(0, Math.round(info.daysToFull)))})`
  return `${pct}, waning (new moon in about ${plural(Math.max(0, Math.round(info.daysToNew)))})`
}

export type MoonDisplay = { percent: number; waxing: boolean; headline: string; detail: string | null; note: string | null }

// For the Signals card: "9% lit, waning crescent" and "New moon in about 2 days".
export function moonDisplay(percent: number, at: Date, previousPercent?: number | null): MoonDisplay {
  const waxing = moonDirection(percent, at, previousPercent)
  const info = moonInfo(at)
  const rounded = Math.round(percent)
  const headline = `${rounded}% lit, ${moonPhaseName(percent, waxing)}`
  let detail: string | null = null
  if (!waxing && percent >= 3) detail = `New moon in about ${plural(Math.max(0, Math.round(info.daysToNew)))}`
  else if (waxing && percent <= 97) detail = `Full moon in about ${plural(Math.max(0, Math.round(info.daysToFull)))}`
  return { percent, waxing, headline, detail, note: moonNightNote(percent) }
}

// ─── Agents: group, label, kind, value text ──────────────────────────────────

export type Value = { primary: string; secondary?: string }

// Where a reading came from, stored with it (agent_signal_history.source_detail). Old rows have none.
export type SourceDetail = {
  kind?: string
  // kind 'gauge': the USGS gauge that measured it and how far it is from the spot.
  site_no?: string
  site_name?: string
  distance_mi?: number | null
  // The agent this reading was computed from (the hatch score is computed from water temperature).
  derived_from?: string
  // kind 'forecast'
  provider?: string
  gust_mph?: number | null
  // kind 'station'
  station_id?: string
  change_inhg?: number | null
  change_hours?: number | null
} | null

// A gauge this close (miles) is treated as measuring the user's water. Farther is shown, labeled, and not counted.
export const NEARBY_GAUGE_MAX_MI = 15

type AgentFormat = {
  // The card heading for this agent.
  group: string
  icon: string
  // The base name of the reading. The text in brackets after it comes from where the reading came from.
  label: string
  // 'unit': a real measurement with a unit. 'score' and 'index': a number with no physical unit. 'moon': see moonDisplay.
  kind: 'unit' | 'score' | 'index' | 'moon'
  // Name of the scale for an index, shown beside the number. For a weather agent it names what OLD rows hold
  // (a percent change from the retired endpoint), which are shown as an index and never counted.
  indexName?: string
  format?: (value: number, detail?: SourceDetail) => Value
  // 'gauge': measured at a USGS gauge, so it is only about this water when the gauge is near. 'state': a state-wide
  // list. 'weather': NWS forecast or station data for the spot.
  family?: 'gauge' | 'state' | 'weather'
  // The hatch score is computed from the water temperature, so it carries that gauge.
  derived?: boolean
  // Full label for old rows from the fixed reference gauge (15266300), when "(reference gauge, not this water)" is not enough.
  referenceLabel?: string
  // A line under the card heading, for readings that mean something other than what the heading suggests.
  note?: string
  // Short chip text, for agents that get a chip. No chip for an index (a number with no unit).
  chip?: { label: string; text?: (value: number) => string }
  // The chip shows only when the reading came from a gauge near the spot.
  chipOnlyNearby?: boolean
}

const fmt = (n: number, digits = 1) => String(Number(n.toFixed(digits)))
const grouped = (n: number) => Math.round(n).toLocaleString('en-US')

// Hatch window is a 0 to 1 score from the water-temperature calendar. Thresholds: under 0.34 Low, under 0.67
// Moderate, otherwise High.
export function hatchBand(score: number): string {
  if (score < 0.34) return 'Low'
  if (score < 0.67) return 'Moderate'
  return 'High'
}

// Old rows from the three water agents and the hatch score came from a fixed USGS gauge (15266300, Alaska), so they
// say nothing about the user's water. Shown as labeled reference data, never as a chip, never counted as evidence.
export const REFERENCE_NOTE = 'A reference gauge, not the water at your spot.'
export const FORECAST_NOTE = 'A forecast for this hour, not a measurement.'
export const FORECAST_SOURCE = 'NWS forecast for this hour (not a measurement)'

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`

// Every agent that writes a signal reading, keyed on the FULL agent key. (Matching on pieces of the key put the
// hatch score under Wind because OUTDOOR_HATCH_WINDOW contains "WIND".) Units: USGS reports water temperature in
// degrees Celsius; the NWS forecast reports degrees Fahrenheit; the barometer is stored in inHg.
export const AGENTS: Record<string, AgentFormat> = {
  OUTDOOR_MOON_PHASE: { group: 'Moon Phase', icon: '🌙', label: 'Moon', kind: 'moon', chip: { label: 'Moon' } },
  OUTDOOR_USGS_WATER_TEMP: {
    group: 'Water temperature', icon: '🌡', label: 'Water temperature', kind: 'unit', family: 'gauge',
    format: v => ({ primary: `${fmt(v * 9 / 5 + 32)} F`, secondary: `(${fmt(v)} C)` }),
    chip: { label: 'Water', text: v => `${Math.round(v * 9 / 5 + 32)} F` }, chipOnlyNearby: true,
  },
  OUTDOOR_USGS_STREAMFLOW_NEAR: {
    group: 'Streamflow', icon: '💧', label: 'Streamflow', kind: 'unit', family: 'gauge',
    format: v => ({ primary: `${grouped(v)} cfs` }),
    chip: { label: 'Flow' }, chipOnlyNearby: true,
  },
  OUTDOOR_USGS_STREAMFLOW_STATE: {
    group: 'State streamflow', icon: '💧', label: 'State-level streamflow (not this water)', kind: 'unit', family: 'state',
    format: v => ({ primary: `${grouped(v)} cfs` }),
    note: 'A state-wide reading, not the flow at your spot.',
    chip: { label: 'State flow' },
  },
  OUTDOOR_USGS_DISSOLVED_O2: { group: 'Dissolved oxygen', icon: '💧', label: 'Dissolved oxygen', kind: 'unit', family: 'gauge', format: v => ({ primary: `${fmt(v)} mg/L` }) },
  // USGS parameter 63680, formazin nephelometric units.
  OUTDOOR_USGS_TURBIDITY: { group: 'Turbidity', icon: '💧', label: 'Turbidity', kind: 'unit', family: 'gauge', format: v => ({ primary: `${fmt(v)} FNU` }) },
  OUTDOOR_HATCH_WINDOW: {
    group: 'Hatch window', icon: '🎣', label: 'Hatch window score', kind: 'score', family: 'gauge', derived: true,
    referenceLabel: 'Hatch window score (based on a reference gauge, not this water)',
    format: v => ({ primary: `${hatchBand(v)}, ${v.toFixed(2)}` }),
  },
  OUTDOOR_NOAA_TEMP: {
    group: 'Air temperature', icon: '🌡', label: 'Air temperature', kind: 'unit', family: 'weather', indexName: 'change index',
    format: v => ({ primary: `${fmt(v, 0)} F` }),
  },
  OUTDOOR_NOAA_PRECIP: {
    group: 'Precipitation', icon: '🌧', label: 'Chance of precipitation', kind: 'unit', family: 'weather', indexName: 'change index',
    format: v => ({ primary: `${fmt(v, 0)}%` }),
  },
  OUTDOOR_WINDY_API: {
    group: 'Wind', icon: '💨', label: 'Wind', kind: 'unit', family: 'weather',
    format: (v, d) => ({ primary: `${fmt(v, 0)} mph`, ...(typeof d?.gust_mph === 'number' ? { secondary: `(gusts ${fmt(d.gust_mph, 0)} mph)` } : {}) }),
    chip: { label: 'Wind' },
  },
  OUTDOOR_NOAA_BAROMETRIC: {
    group: 'Barometric pressure', icon: '🌡', label: 'Barometric pressure', kind: 'unit', family: 'weather', indexName: 'change index',
    format: (v, d) => ({
      primary: `${v.toFixed(2)} inHg`,
      ...(typeof d?.change_inhg === 'number' && typeof d?.change_hours === 'number'
        ? { secondary: `(${signed(d.change_inhg)} inHg over ${fmt(d.change_hours, 0)} h)` } : {}),
    }),
  },
  OUTDOOR_NOAA_DROUGHT_STATE: { group: 'Drought', icon: '🏜', label: 'Drought', kind: 'index', indexName: 'drought index' },
  OUTDOOR_NOAA_DROUGHT_COUNTY: { group: 'Drought', icon: '🏜', label: 'Drought', kind: 'index', indexName: 'drought index' },
  OUTDOOR_NOAA_FIRE_RISK: { group: 'Fire Risk', icon: '🔥', label: 'Fire risk', kind: 'index', indexName: 'fire outlook' },
  OUTDOOR_USGS_SNOWPACK: { group: 'Snowpack', icon: '❄', label: 'Snowpack', kind: 'index', indexName: 'snowpack change index' },
  OUTDOOR_NRCS_SNOTEL: { group: 'Snowpack', icon: '❄', label: 'SNOTEL snowpack', kind: 'index', indexName: 'snowpack change index' },
  OUTDOOR_SNOTEL_SNOWPACK: { group: 'Snowpack', icon: '❄', label: 'SNOTEL snowpack', kind: 'index', indexName: 'snowpack change index' },
  OUTDOOR_DWR_FISHING_FORECAST_UT: { group: 'Fishing', icon: '🎣', label: 'Fishing forecast', kind: 'index', indexName: 'forecast index' },
  OUTDOOR_DWR_HARVEST_UT: { group: 'Herd / Permits', icon: '🦌', label: 'Herd survey', kind: 'index', indexName: 'survey index' },
  OUTDOOR_DWR_PERMITS_UT: { group: 'Herd / Permits', icon: '🦌', label: 'Permits', kind: 'index', indexName: 'permits index' },
  OUTDOOR_INAT_OBSERVATIONS: { group: 'Sightings', icon: '👁', label: 'Sightings', kind: 'index', indexName: 'sightings index' },
  OUTDOOR_INATURALIST_AQUATIC: { group: 'Sightings', icon: '👁', label: 'Aquatic sightings', kind: 'index', indexName: 'sightings index' },
  OUTDOOR_TERRAIN_COMPOSITE: { group: 'Terrain Intel', icon: '⛰', label: 'Terrain intel', kind: 'index', indexName: 'terrain score' },
  OUTDOOR_SALMON_PROGRESSION: { group: 'Salmon Run', icon: '🐟', label: 'Salmon run progress', kind: 'unit', format: v => ({ primary: `${fmt(v, 0)}% of the annual run` }) },
  OUTDOOR_USACE_BONNEVILLE: { group: 'Salmon Run', icon: '🐟', label: 'Bonneville fish count', kind: 'unit', format: v => ({ primary: `${grouped(v)} fish per day` }) },
  OUTDOOR_USACE_MCNARY: { group: 'Salmon Run', icon: '🐟', label: 'McNary fish count', kind: 'unit', format: v => ({ primary: `${grouped(v)} fish per day` }) },
  OUTDOOR_ADFG_SONAR: { group: 'Salmon Run', icon: '🐟', label: 'ADF&G sonar count', kind: 'unit', format: v => ({ primary: `${grouped(v)} fish per day` }) },
}

function cleanedKey(agentKey: string): string {
  const words = agentKey.replace(/^OUTDOOR_/, '').replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ─── Where a reading came from ───────────────────────────────────────────────

// nearby_gauge: a USGS gauge within NEARBY_GAUGE_MAX_MI of the spot. distant_gauge: a gauge farther away.
// reference: an old row from the fixed Alaska gauge. state: a state-wide list. forecast and station: NWS data for the
// spot. legacy: an old row from a weather endpoint that never existed; its number has no unit. spot: anything else.
export type Provenance = 'spot' | 'nearby_gauge' | 'distant_gauge' | 'reference' | 'state' | 'forecast' | 'station' | 'legacy'

export function provenance(agentKey: string, detail?: SourceDetail): Provenance {
  const a = AGENTS[agentKey]
  if (a?.family === 'state') return 'state'
  if (a?.family === 'gauge') {
    if (detail?.kind !== 'gauge') return 'reference'
    return typeof detail.distance_mi === 'number' && detail.distance_mi <= NEARBY_GAUGE_MAX_MI ? 'nearby_gauge' : 'distant_gauge'
  }
  if (a?.family === 'weather') {
    if (detail?.kind === 'forecast') return 'forecast'
    if (detail?.kind === 'station') return 'station'
    // The wind agent has always read the NWS forecast in mph. The other three stored percent changes from endpoints
    // that do not exist, so their old numbers are not temperatures, chances or pressures.
    return agentKey === 'OUTDOOR_WINDY_API' ? 'forecast' : 'legacy'
  }
  return 'spot'
}

// True for a reading that describes the objective's own spot: counted as evidence for a brief.
export function isSpotLevel(agentKey: string, detail?: SourceDetail): boolean {
  const p = provenance(agentKey, detail)
  return p === 'spot' || p === 'nearby_gauge' || p === 'forecast' || p === 'station'
}

const miles = (d: SourceDetail | undefined) => (typeof d?.distance_mi === 'number' ? fmt(d.distance_mi, 1) : 'unknown')

export function agentGroup(agentKey: string): { label: string; icon: string } {
  const a = AGENTS[agentKey]
  return a ? { label: a.group, icon: a.icon } : { label: cleanedKey(agentKey), icon: '📡' }
}

export function agentLabel(agentKey: string, detail?: SourceDetail): string {
  const a = AGENTS[agentKey]
  if (!a) return cleanedKey(agentKey).toLowerCase()
  switch (provenance(agentKey, detail)) {
    case 'nearby_gauge':
      return `${a.label} (${a.derived ? 'from water temperature at ' : ''}USGS gauge ${detail?.site_name ?? detail?.site_no ?? 'unnamed'}, ${miles(detail)} mi from your spot)`
    case 'distant_gauge':
      return `${a.label} (distant gauge, ${miles(detail)} mi away, may not match this water)`
    case 'reference':
      return a.referenceLabel ?? `${a.label} (reference gauge, not this water)`
    default:
      return a.label
  }
}

export function agentNote(agentKey: string, detail?: SourceDetail): string | null {
  switch (provenance(agentKey, detail)) {
    case 'distant_gauge': return `A gauge ${miles(detail)} mi away. It may not match the water at your spot.`
    case 'reference': return REFERENCE_NOTE
    case 'state': return AGENTS[agentKey]?.note ?? null
    case 'forecast': return FORECAST_NOTE
    default: return null
  }
}

// A chip only for a reading that belongs to the spot (no chip for a distant gauge or an old reference reading).
export function agentChip(agentKey: string, detail?: SourceDetail): AgentFormat['chip'] | null {
  const a = AGENTS[agentKey]
  if (!a?.chip) return null
  if (a.chipOnlyNearby && provenance(agentKey, detail) !== 'nearby_gauge') return null
  return a.chip
}

export function agentKind(agentKey: string): AgentFormat['kind'] | 'unknown' {
  return AGENTS[agentKey]?.kind ?? 'unknown'
}

// Display text for one reading in the Signals tab. An index or an unlisted agent gets its number with a plain note
// that it has no unit, never a bare number.
export type Display = { primary: string; secondary?: string; unitless: boolean }

export function displayValue(agentKey: string, value: number, detail?: SourceDetail): Display {
  const a = AGENTS[agentKey]
  const legacy = provenance(agentKey, detail) === 'legacy'
  if (a?.format && !legacy) return { ...a.format(value, detail), unitless: false }
  if (a?.indexName && (a.kind === 'index' || legacy)) return { primary: `${fmt(value, 2)} ${a.indexName}`, unitless: true }
  return { primary: `${fmt(value, 2)} (unit not stated)`, unitless: true }
}

// ─── The brief prompt's line ─────────────────────────────────────────────────

function sourceLabel(agentKey: string, observed: boolean, detail?: SourceDetail): string {
  const p = provenance(agentKey, detail)
  if (!observed) return `${agentKey.startsWith('OUTDOOR_USGS') ? 'USGS ' : ''}estimated (a projection, not a measurement)`
  if (p === 'forecast') return FORECAST_SOURCE
  if (p === 'station') return detail?.station_id ? `NWS station ${detail.station_id} observation` : 'NWS station observation'
  const who = agentKey.startsWith('OUTDOOR_USGS') ? 'USGS ' : ''
  return observed ? `${who}observed` : `${who}estimated (a projection, not a measurement)`
}

export function readingLabel(agentKey: string, detail?: SourceDetail): string {
  return agentLabel(agentKey, detail)
}

// "Water temperature (USGS gauge Name, 3.2 mi from your spot): 45.5 F (7.5 C), USGS observed". Null when the number
// has no unit (an index, an old weather row, or an unlisted agent): a number the model cannot give a unit to is not
// handed over.
export function formatReading(agentKey: string, value: number, opts: { source?: string | null; recordedAt?: string | Date; detail?: SourceDetail } = {}): string | null {
  const a = AGENTS[agentKey]
  if (!a || !Number.isFinite(value)) return null
  const observed = opts.source !== 'estimated'
  const recordedAt = opts.recordedAt instanceof Date ? opts.recordedAt : new Date(opts.recordedAt ?? Date.now())
  const label = agentLabel(agentKey, opts.detail)
  if (a.kind === 'moon') return `${label}: ${describeMoon(value, recordedAt)}, ${sourceLabel(agentKey, observed, opts.detail)}`
  if (!a.format || provenance(agentKey, opts.detail) === 'legacy') return null
  const v = a.format(value, opts.detail)
  return `${label}: ${v.primary}${v.secondary ? ` ${v.secondary}` : ''}, ${sourceLabel(agentKey, observed, opts.detail)}`
}

// ─── Trend ───────────────────────────────────────────────────────────────────

// Newest first. An arrow only with two or more usable readings; the caller passes one agent's readings only.
export function trendArrow(valuesNewestFirst: number[]): '↑' | '↓' | '→' | '' {
  if (valuesNewestFirst.length < 2) return ''
  const newest = valuesNewestFirst[0]
  const oldest = valuesNewestFirst[valuesNewestFirst.length - 1]
  return newest > oldest ? '↑' : newest < oldest ? '↓' : '→'
}
