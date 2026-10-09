// What each Signals tab card shows (FF-099 Parts 1 to 3). Pure, so the grouping, the units, the "No data" rule and
// the trend can be tested without rendering. Wording and units come from signalFormat, the same table the chips
// and the brief prompt use.
import {
  agentGroup, agentKind, agentLabel, agentNote, displayValue, isPlaceholderReading, moonDisplay, trendArrow,
  provenance, type MoonDisplay, type SourceDetail,
} from './signalFormat'

export type Signal = {
  id: string
  agent_key: string
  objective_id: string
  observed_value: number | null
  source: string
  recorded_at: string
  // Where the reading came from (gauge name and distance, forecast, station). Null on old rows.
  source_detail?: SourceDetail
}

export type SignalGroup = { label: string; icon: string; signals: Signal[] }

// One card per group label. Readings keep the order they came in (newest first).
export function groupSignals(signals: Signal[]): SignalGroup[] {
  const map = new Map<string, SignalGroup>()
  for (const s of signals) {
    const { label, icon } = agentGroup(s.agent_key)
    if (!map.has(label)) map.set(label, { label, icon, signals: [] })
    map.get(label)!.signals.push(s)
  }
  return Array.from(map.values())
}

export const CFS_HELP = 'cfs = cubic feet per second'
export const HATCH_SCALE = 'Hatch score: Low under 0.34, Moderate 0.34 to 0.66, High 0.67 or more.'

export type Row = { id: string; at: string; text: string; secondary?: string; estimated: boolean; noData: boolean; source: string }

export type Header =
  | { kind: 'nodata' }
  | { kind: 'value'; primary: string; secondary?: string; estimated: boolean }
  | { kind: 'moon'; moon: MoonDisplay; estimated: boolean }

export type CardModel = {
  label: string
  icon: string
  // The full name of the reading, when the card heading alone is not enough ("State-level streamflow (not this water)").
  subtitle: string | null
  note: string | null
  help: string | null
  scale: string | null
  header: Header
  trend: '↑' | '↓' | '→' | ''
  // Oldest to newest, usable readings of the newest reading's agent only.
  spark: number[]
  rows: Row[]
  readingCount: number
}

const SHOWN = 5

export function cardModel(group: SignalGroup): CardModel {
  const signals = group.signals
  const latest = signals[0]
  const latestKey = latest?.agent_key ?? ''
  const kind = agentKind(latestKey)

  // Trend and sparkline use the same series as the headline value, usable readings only, so a placeholder zero,
  // another agent's number, or an old reading from a different gauge never draws a line.
  const sameSeries = (s: Signal) =>
    s.agent_key === latestKey
    && provenance(s.agent_key, s.source_detail) === provenance(latestKey, latest?.source_detail)
    && (s.source_detail?.site_no ?? null) === (latest?.source_detail?.site_no ?? null)
  const sameAgent = signals
    .filter(s => sameSeries(s) && !isPlaceholderReading(s))
    .slice(0, SHOWN)
  const newestFirst = sameAgent.map(s => Number(s.observed_value))

  const rows: Row[] = signals.slice(0, SHOWN).map((s, i) => {
    const base = { id: s.id, at: s.recorded_at, estimated: s.source === 'estimated', source: s.source }
    if (isPlaceholderReading(s)) return { ...base, text: 'No data', noData: true }
    const v = Number(s.observed_value)
    if (agentKind(s.agent_key) === 'moon') {
      const previous = signals.slice(i + 1).find(p => p.agent_key === s.agent_key && !isPlaceholderReading(p))
      const m = moonDisplay(v, new Date(s.recorded_at), previous ? Number(previous.observed_value) : null)
      return { ...base, text: m.headline, noData: false }
    }
    const d = displayValue(s.agent_key, v, s.source_detail)
    return { ...base, text: d.primary, secondary: d.secondary, noData: false }
  })

  let header: Header = { kind: 'nodata' }
  if (latest && !isPlaceholderReading(latest)) {
    const v = Number(latest.observed_value)
    const estimated = latest.source === 'estimated'
    if (kind === 'moon') {
      const previous = signals.slice(1).find(p => p.agent_key === latestKey && !isPlaceholderReading(p))
      header = { kind: 'moon', moon: moonDisplay(v, new Date(latest.recorded_at), previous ? Number(previous.observed_value) : null), estimated }
    } else {
      const d = displayValue(latestKey, v, latest.source_detail)
      header = { kind: 'value', primary: d.primary, secondary: d.secondary, estimated }
    }
  }

  const label = group.label
  const full = latestKey ? agentLabel(latestKey, latest?.source_detail) : ''
  const subtitle = full && full.toLowerCase() !== label.toLowerCase() && agentGroup(latestKey).label === label ? full : null

  return {
    label,
    icon: group.icon,
    subtitle,
    note: latestKey ? agentNote(latestKey, latest?.source_detail) : null,
    help: latestKey === 'OUTDOOR_USGS_STREAMFLOW_STATE' || latestKey === 'OUTDOOR_USGS_STREAMFLOW_NEAR' ? CFS_HELP : null,
    scale: latestKey === 'OUTDOOR_HATCH_WINDOW' ? HATCH_SCALE : null,
    header,
    trend: trendArrow(newestFirst),
    spark: newestFirst.slice().reverse(),
    rows,
    readingCount: signals.length,
  }
}
