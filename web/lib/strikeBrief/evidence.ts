// Evidence for a Strike brief (FF-098 Part 2). What the model may state as confirmed fact comes from here and
// only here: agent readings (agent_signal_history) and signals tagged to the objective in the last 14 days.
// Readings are handed over as labeled values with units, never as bare numbers.
//
// The unit table and formatReading live in lib/strike/signalFormat.ts (FF-099) so the Signals tab, the chips and
// this prompt show the same text. They are re-exported here so existing imports keep working.
import type { SupabaseClient } from '@supabase/supabase-js'
import { isUsableReading, isSpotLevel, formatReading, readingLabel, type Reading } from '@/lib/strike/signalFormat'

export const EVIDENCE_WINDOW_DAYS = 14

// Fixed first line of a brief written with no evidence at all.
export const ZERO_EVIDENCE_BANNER = 'No data collected yet. This is typical for the season, not confirmed. Tap Run Sweep to get intel.'

const DAY_MS = 24 * 60 * 60 * 1000

export type { Reading } from '@/lib/strike/signalFormat'
export { isUsableReading, describeMoon, formatReading, readingLabel } from '@/lib/strike/signalFormat'

export type TaggedSignal = { id?: string; created_at: string }

function withinWindow(iso: string, now: Date): boolean {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return now.getTime() - t <= EVIDENCE_WINDOW_DAYS * DAY_MS && t <= now.getTime() + DAY_MS
}

// Data categories a brief should say are missing when they have no reading for THIS spot, by domain. `keys` are
// the agents that can supply it, and only a reading from a gauge near the spot counts (FF-100): a distant gauge, the
// old fixed reference gauge or a state-wide list does not cover the category.
const EXPECTED: Record<string, Array<{ keys: string[]; name: string }>> = {
  fishing: [
    { keys: ['OUTDOOR_USGS_WATER_TEMP'], name: 'water temperature reading for this water' },
    { keys: ['OUTDOOR_USGS_STREAMFLOW_NEAR'], name: 'streamflow reading for this water' },
  ],
}

export type Evidence = {
  // Spot-level readings plus tagged signals in the window. Reference-gauge and state-level readings are handed to
  // the model as labeled lines but are not counted. Zero means the brief has nothing to confirm.
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
    const text = formatReading(agentKey, Number(r.observed_value), { source: r.source, recordedAt: r.recorded_at, detail: r.source_detail })
    if (text) lines.push(`${text}, recorded ${ageText(new Date(r.recorded_at), now)}`)
    else withoutUnit.push(readingLabel(agentKey, r.source_detail))
  }
  if (withoutUnit.length > 0) {
    lines.push(`Also recorded, value not shown because its unit is not available: ${withoutUnit.join(', ')}`)
  }

  const expected = EXPECTED[input.domain ?? ''] ?? []
  // A category is covered only by the newest reading of an agent in its list, and only when that reading is
  // spot-level (a nearby gauge): a distant gauge, a reference gauge or a state-wide list does not cover it.
  const covered = (keys: string[]) => keys.some(key => { const r = latest.get(key); return !!r && isSpotLevel(key, r.source_detail) })
  const missing = expected.filter(e => !covered(e.keys)).map(e => e.name)

  const spotReadings = usable.filter(r => isSpotLevel(r.agent_key, r.source_detail))
  return { count: spotReadings.length + signals.length, lines, missing }
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
      .select('agent_key, observed_value, source, recorded_at, source_detail')
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
