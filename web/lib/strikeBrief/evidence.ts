// Evidence for a Strike brief (FF-098 Part 2). What the model may state as confirmed fact comes from here and
// only here: agent readings (agent_signal_history) and signals tagged to the objective in the last 14 days.
// Readings are handed over as labeled values with units, never as bare numbers.
//
// formatReading is the small shared helper for that. (FF-099 had not merged when this was written. If it adds its
// own helpers, point them here or fold the two together: the unit table below is the single place to edit.)
import type { SupabaseClient } from '@supabase/supabase-js'

export const EVIDENCE_WINDOW_DAYS = 14

// Fixed first line of a brief written with no evidence at all.
export const ZERO_EVIDENCE_BANNER = 'No data collected yet. This is typical for the season, not confirmed. Tap Run Sweep to get intel.'

const DAY_MS = 24 * 60 * 60 * 1000

export type Reading = {
  agent_key: string
  observed_value: number | string | null
  source: string | null
  recorded_at: string
}

export type TaggedSignal = { id?: string; created_at: string }

// An estimated reading of exactly 0 is the temperature agent's placeholder, not a measurement (FF-099).
// It is not evidence, and it is not counted.
export function isUsableReading(r: Reading): boolean {
  if (r.observed_value === null || r.observed_value === '') return false
  const value = Number(r.observed_value)
  if (!Number.isFinite(value)) return false
  if (r.source === 'estimated' && value === 0) return false
  return true
}

function withinWindow(iso: string, now: Date): boolean {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return now.getTime() - t <= EVIDENCE_WINDOW_DAYS * DAY_MS && t <= now.getTime() + DAY_MS
}

// ─── Moon ────────────────────────────────────────────────────────────────────

const SYNODIC_DAYS = 29.530588853
// A known new moon: 2000-01-06 18:14 UTC.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14)

function moonAgeDays(at: Date): number {
  const age = ((at.getTime() - NEW_MOON_EPOCH_MS) / DAY_MS) % SYNODIC_DAYS
  return age < 0 ? age + SYNODIC_DAYS : age
}

// The agent stores percent illuminated only, which cannot say waxing or waning. The direction and the days to the
// next new or full moon come from the calendar date, so the model is never left to guess them from a bare number.
export function describeMoon(percentIlluminated: number, at: Date): string {
  const age = moonAgeDays(at)
  const waxing = age < SYNODIC_DAYS / 2
  const pct = `${Math.round(percentIlluminated)}% illuminated`
  if (waxing) {
    const days = Math.max(0, Math.round(SYNODIC_DAYS / 2 - age))
    return `${pct}, waxing (full moon in about ${days} ${days === 1 ? 'day' : 'days'})`
  }
  const days = Math.max(0, Math.round(SYNODIC_DAYS - age))
  return `${pct}, waning (new moon in about ${days} ${days === 1 ? 'day' : 'days'})`
}

// ─── Readings with units ─────────────────────────────────────────────────────

const fmt = (n: number, digits = 1) => String(Number(n.toFixed(digits)))
const grouped = (n: number) => Math.round(n).toLocaleString('en-US')

type Formatter = (value: number, ctx: { observed: boolean; recordedAt: Date }) => string

// The one place that says what each agent's stored number means. An agent that is not listed has no known unit,
// so its number is never shown (see formatReading). USGS reports water temperature in degrees Celsius.
const FORMATTERS: Record<string, { label: string; format: Formatter }> = {
  OUTDOOR_MOON_PHASE: { label: 'Moon', format: (v, c) => describeMoon(v, c.recordedAt) },
  OUTDOOR_USGS_WATER_TEMP: {
    label: 'Water temperature',
    format: v => `${fmt(v * 9 / 5 + 32)} F (${fmt(v)} C)`,
  },
  OUTDOOR_USGS_STREAMFLOW_STATE: { label: 'Streamflow', format: v => `${grouped(v)} cfs` },
  OUTDOOR_USGS_DISSOLVED_O2: { label: 'Dissolved oxygen', format: v => `${fmt(v)} mg/L` },
  OUTDOOR_SALMON_PROGRESSION: { label: 'Salmon run progress', format: v => `${fmt(v, 0)}% of the annual run` },
  OUTDOOR_USACE_BONNEVILLE: { label: 'Bonneville fish count', format: v => `${grouped(v)} fish per day` },
  OUTDOOR_ADFG_SONAR: { label: 'ADF&G sonar count', format: v => `${grouped(v)} fish per day` },
}

function sourceLabel(agentKey: string, observed: boolean): string {
  const who = agentKey.startsWith('OUTDOOR_USGS') ? 'USGS ' : ''
  return observed ? `${who}observed` : `${who}estimated (a projection, not a measurement)`
}

export function readingLabel(agentKey: string): string {
  return FORMATTERS[agentKey]?.label ?? agentKey.replace(/^OUTDOOR_/, '').replace(/_/g, ' ').toLowerCase()
}

// "Water temperature: 45.5 F (7.5 C), USGS observed". Null when the agent has no known unit: a number the model
// cannot give a unit to is not handed over at all.
export function formatReading(agentKey: string, value: number, opts: { source?: string | null; recordedAt?: string | Date } = {}): string | null {
  const entry = FORMATTERS[agentKey]
  if (!entry || !Number.isFinite(value)) return null
  const observed = opts.source !== 'estimated'
  const recordedAt = opts.recordedAt instanceof Date ? opts.recordedAt : new Date(opts.recordedAt ?? Date.now())
  return `${entry.label}: ${entry.format(value, { observed, recordedAt })}, ${sourceLabel(agentKey, observed)}`
}

// Data categories a brief should say are missing when they have no reading, by domain.
const EXPECTED: Record<string, Array<{ key: string; name: string }>> = {
  fishing: [
    { key: 'OUTDOOR_USGS_WATER_TEMP', name: 'water temperature' },
    { key: 'OUTDOOR_USGS_STREAMFLOW_STATE', name: 'streamflow' },
  ],
}

export type Evidence = {
  // Usable readings plus tagged signals in the window. Zero means the brief has nothing to confirm.
  count: number
  // One labeled line per agent, newest reading, with its unit and age.
  lines: string[]
  // Expected categories with no usable reading, for the "say so in one clause" rule.
  missing: string[]
}

function ageText(recordedAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - recordedAt.getTime()) / DAY_MS)
  if (days <= 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

// Pure. Counts and formats what falls inside the window. Another objective's rows never reach here, but a row
// outside the window or an unusable one is dropped regardless of where it came from.
export function buildEvidence(input: { readings: Reading[]; signals: TaggedSignal[]; domain?: string | null; now?: Date }): Evidence {
  const now = input.now ?? new Date()
  const usable = input.readings.filter(r => withinWindow(r.recorded_at, now) && isUsableReading(r))
  const signals = input.signals.filter(s => withinWindow(s.created_at, now))

  // Newest reading per agent.
  const latest = new Map<string, Reading>()
  for (const r of usable) {
    const held = latest.get(r.agent_key)
    if (!held || Date.parse(r.recorded_at) > Date.parse(held.recorded_at)) latest.set(r.agent_key, r)
  }

  const lines: string[] = []
  const withoutUnit: string[] = []
  for (const [agentKey, r] of Array.from(latest.entries())) {
    const text = formatReading(agentKey, Number(r.observed_value), { source: r.source, recordedAt: r.recorded_at })
    if (text) lines.push(`${text}, recorded ${ageText(new Date(r.recorded_at), now)}`)
    else withoutUnit.push(readingLabel(agentKey))
  }
  if (withoutUnit.length > 0) {
    lines.push(`Also recorded, value not shown because its unit is not available: ${withoutUnit.join(', ')}`)
  }

  const expected = EXPECTED[input.domain ?? ''] ?? []
  const missing = expected.filter(e => !latest.has(e.key)).map(e => e.name)

  return { count: usable.length + signals.length, lines, missing }
}

// Loads the objective's own readings and tagged signals for the window. Both are scoped to this objective (and the
// signals to its owner); a failed read counts as no evidence for that source and is logged without any location data.
export async function loadEvidence(
  supabase: SupabaseClient,
  input: { objectiveId: string; userId: string; domain?: string | null; now?: Date },
): Promise<Evidence> {
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * DAY_MS).toISOString()

  const [readingsResult, signalsResult] = await Promise.all([
    supabase
      .from('agent_signal_history')
      .select('agent_key, observed_value, source, recorded_at')
      .eq('objective_id', input.objectiveId)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: false })
      .limit(200),
    supabase
      .from('signals')
      .select('id, created_at')
      .eq('user_id', input.userId)
      .contains('objective_ids', [input.objectiveId])
      .gte('created_at', since)
      .limit(200),
  ])

  if (readingsResult.error) console.error('[evidence] readings read failed:', readingsResult.error.message)
  if (signalsResult.error) console.error('[evidence] signals read failed:', signalsResult.error.message)

  return buildEvidence({
    readings: (readingsResult.data ?? []) as Reading[],
    signals: (signalsResult.data ?? []) as TaggedSignal[],
    domain: input.domain,
    now,
  })
}
