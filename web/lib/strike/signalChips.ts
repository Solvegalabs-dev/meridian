// Signal chips for a Strike objective (FF-099 Part 4). Each chip is the latest REAL reading of one agent, worded
// by the shared signalFormat table. The old chips were hard-coded placeholder text ("Waning 34%", "D2-D3") shown
// only for agents whose threshold fired that day; these come from what the agents actually recorded. No chip
// text comes from the model. Pure apart from loadSignalChips, and client-safe (type-only supabase import).
import type { SupabaseClient } from '@supabase/supabase-js'
import { agentChip, agentKind, displayValue, isPlaceholderReading, moonDirection, type Reading } from './signalFormat'

export const MAX_CHIPS = 5
// Older readings are not "the latest" of anything: same window the brief evidence uses.
export const CHIP_WINDOW_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

export type SignalChip = {
  label: string
  value: string
  status: 'ok' | 'warn' | 'critical'
  // The reading's own time, for a tap or long press. Shown in the viewer's timezone by the component.
  recorded_at: string
  // Set on the moon chip so the component can draw the picture.
  moon?: { percent: number; waxing: boolean }
}

// Newest usable reading per agent, newest chip first, at most MAX_CHIPS. An agent with no usable reading (all
// placeholders), an agent with no chip (an index), and an empty list give no chip at all.
export function buildSignalChips(readings: Reading[], now: Date = new Date()): SignalChip[] {
  const byAgent = new Map<string, Reading[]>()
  for (const r of readings) {
    const t = Date.parse(r.recorded_at)
    if (Number.isNaN(t) || now.getTime() - t > CHIP_WINDOW_DAYS * DAY_MS || isPlaceholderReading(r)) continue
    const list = byAgent.get(r.agent_key) ?? []
    list.push(r)
    byAgent.set(r.agent_key, list)
  }

  const chips: SignalChip[] = []
  for (const [agentKey, list] of Array.from(byAgent.entries())) {
    const def = agentChip(agentKey)
    if (!def) continue
    const sorted = list.slice().sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
    const latest = sorted[0]
    const value = Number(latest.observed_value)
    if (agentKind(agentKey) === 'moon') {
      const previous = sorted[1] ? Number(sorted[1].observed_value) : null
      const waxing = moonDirection(value, new Date(latest.recorded_at), previous)
      chips.push({
        label: def.label, value: `${Math.round(value)}% ${waxing ? 'waxing' : 'waning'}`, status: 'ok',
        recorded_at: latest.recorded_at, moon: { percent: value, waxing },
      })
      continue
    }
    chips.push({
      label: def.label, value: def.text ? def.text(value) : displayValue(agentKey, value).primary, status: 'ok',
      recorded_at: latest.recorded_at,
    })
  }
  return chips
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
    .slice(0, MAX_CHIPS)
}

export async function loadSignalChips(supabase: SupabaseClient, objectiveId: string, now: Date = new Date()): Promise<SignalChip[]> {
  const { data } = await supabase
    .from('agent_signal_history')
    .select('agent_key, observed_value, source, recorded_at')
    .eq('objective_id', objectiveId)
    .order('recorded_at', { ascending: false })
    .limit(80)
  return buildSignalChips((data ?? []) as Reading[], now)
}
