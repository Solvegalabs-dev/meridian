// One place that says what each agent's stored number means and how to show it (FF-099). The Signals tab, the
// signal chips and the brief prompt (lib/strikeBrief/evidence.ts re-exports from here) all use this table, so
// they show the same text. Display only: stored values are never changed. Pure and client-safe.

export type Reading = {
  agent_key: string
  observed_value: number | string | null
  source: string | null
  recorded_at: string
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

type AgentFormat = {
  // The card heading for this agent.
  group: string
  icon: string
  // The label used in a brief line and as the card's full title.
  label: string
  // 'unit': a real measurement with a unit. 'score' and 'index': a number with no physical unit. 'moon': see moonDisplay.
  kind: 'unit' | 'score' | 'index' | 'moon'
  // Name of the scale for an index, shown beside the number.
  indexName?: string
  format?: (value: number) => Value
  // A line under the card heading, for readings that mean something other than what the heading suggests.
  note?: string
  // Short chip text, for agents that get a chip. No chip for an index (a number with no unit).
  chip?: { label: string; text?: (value: number) => string }
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

// Every agent that writes a signal reading, keyed on the FULL agent key. (Matching on pieces of the key put the
// hatch score under Wind because OUTDOOR_HATCH_WINDOW contains "WIND".) Units were checked against each agent's
// source URL and calculator: USGS reports water temperature in degrees Celsius; the NOAA anomaly agents use
// delta_pct on an endpoint that does not exist, so their stored numbers are not degrees or inches.
export const AGENTS: Record<string, AgentFormat> = {
  OUTDOOR_MOON_PHASE: { group: 'Moon Phase', icon: '🌙', label: 'Moon', kind: 'moon', chip: { label: 'Moon' } },
  OUTDOOR_USGS_WATER_TEMP: {
    group: 'Water temperature', icon: '🌡', label: 'Water temperature', kind: 'unit',
    format: v => ({ primary: `${fmt(v * 9 / 5 + 32)} F`, secondary: `(${fmt(v)} C)` }),
    chip: { label: 'Water', text: v => `${Math.round(v * 9 / 5 + 32)} F` },
  },
  OUTDOOR_NOAA_TEMP: { group: 'Air temperature', icon: '🌡', label: 'Air temperature', kind: 'index', indexName: 'change index' },
  OUTDOOR_USGS_STREAMFLOW_STATE: {
    group: 'Streamflow', icon: '💧', label: 'State-level streamflow (not this water)', kind: 'unit',
    format: v => ({ primary: `${grouped(v)} cfs` }),
    note: 'A state-wide reading, not the flow at your spot.',
    chip: { label: 'State flow' },
  },
  OUTDOOR_USGS_DISSOLVED_O2: { group: 'Dissolved oxygen', icon: '💧', label: 'Dissolved oxygen', kind: 'unit', format: v => ({ primary: `${fmt(v)} mg/L` }), chip: { label: 'Oxygen' } },
  OUTDOOR_HATCH_WINDOW: {
    group: 'Hatch window', icon: '🎣', label: 'Hatch window', kind: 'score',
    format: v => ({ primary: `${hatchBand(v)}, ${v.toFixed(2)}` }),
    chip: { label: 'Hatch', text: v => hatchBand(v) },
  },
  OUTDOOR_WINDY_API: { group: 'Wind', icon: '💨', label: 'Wind', kind: 'unit', format: v => ({ primary: `${fmt(v, 0)} mph` }), chip: { label: 'Wind' } },
  OUTDOOR_NOAA_PRECIP: { group: 'Precipitation', icon: '🌧', label: 'Precipitation', kind: 'index', indexName: 'change index' },
  OUTDOOR_NOAA_BAROMETRIC: { group: 'Barometric pressure', icon: '🌡', label: 'Barometric pressure', kind: 'index', indexName: 'change index' },
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

export function agentGroup(agentKey: string): { label: string; icon: string } {
  const a = AGENTS[agentKey]
  return a ? { label: a.group, icon: a.icon } : { label: cleanedKey(agentKey), icon: '📡' }
}

export function agentLabel(agentKey: string): string {
  return AGENTS[agentKey]?.label ?? cleanedKey(agentKey).toLowerCase()
}

export function agentNote(agentKey: string): string | null {
  return AGENTS[agentKey]?.note ?? null
}

export function agentChip(agentKey: string): AgentFormat['chip'] | null {
  return AGENTS[agentKey]?.chip ?? null
}

export function agentKind(agentKey: string): AgentFormat['kind'] | 'unknown' {
  return AGENTS[agentKey]?.kind ?? 'unknown'
}

// Display text for one reading in the Signals tab. Null for a placeholder (shown as "No data"). An index or an
// unlisted agent gets its number with a plain note that it has no unit, never a bare number.
export type Display = { primary: string; secondary?: string; unitless: boolean }

export function displayValue(agentKey: string, value: number): Display {
  const a = AGENTS[agentKey]
  if (a?.format) return { ...a.format(value), unitless: false }
  if (a?.kind === 'index') return { primary: `${fmt(value, 2)} ${a.indexName ?? 'index'}`, unitless: true }
  return { primary: `${fmt(value, 2)} (unit not stated)`, unitless: true }
}

// ─── The brief prompt's line ─────────────────────────────────────────────────

function sourceLabel(agentKey: string, observed: boolean): string {
  const who = agentKey.startsWith('OUTDOOR_USGS') ? 'USGS ' : ''
  return observed ? `${who}observed` : `${who}estimated (a projection, not a measurement)`
}

export function readingLabel(agentKey: string): string {
  return agentLabel(agentKey)
}

// "Water temperature: 45.5 F (7.5 C), USGS observed". Null when the number has no unit (an index, a score with no
// scale the model could misread, or an unlisted agent): a number the model cannot give a unit to is not handed over.
export function formatReading(agentKey: string, value: number, opts: { source?: string | null; recordedAt?: string | Date } = {}): string | null {
  const a = AGENTS[agentKey]
  if (!a || !Number.isFinite(value)) return null
  const observed = opts.source !== 'estimated'
  const recordedAt = opts.recordedAt instanceof Date ? opts.recordedAt : new Date(opts.recordedAt ?? Date.now())
  if (a.kind === 'moon') return `${a.label}: ${describeMoon(value, recordedAt)}, ${sourceLabel(agentKey, observed)}`
  if (!a.format) return null
  const v = a.format(value)
  return `${a.label}: ${v.primary}${v.secondary ? ` ${v.secondary}` : ''}, ${sourceLabel(agentKey, observed)}`
}

// ─── Trend ───────────────────────────────────────────────────────────────────

// Newest first. An arrow only with two or more usable readings; the caller passes one agent's readings only.
export function trendArrow(valuesNewestFirst: number[]): '↑' | '↓' | '→' | '' {
  if (valuesNewestFirst.length < 2) return ''
  const newest = valuesNewestFirst[0]
  const oldest = valuesNewestFirst[valuesNewestFirst.length - 1]
  return newest > oldest ? '↑' : newest < oldest ? '↓' : '→'
}
