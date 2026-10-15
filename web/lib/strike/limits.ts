// Strike-friend objective limits, by category (FF-106 Stage 1). A Strike friend may run up to
// 3 hunting and 3 fishing objectives at once, 5 total. An ended hunt frees its slot as soon as
// its window closes, even before the sweep flips objective_profiles.status to 'completed' — so
// slots are counted from the same live window evaluation the home page uses, not from stored status.
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateProfilesWindow, PROFILE_WINDOW_COLUMNS, type ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'
import { objectiveTimezone } from '@/lib/objectives/seasonMatcher'
import { localDateIn } from '@/lib/objectives/windowState'
import { focusState } from '@/lib/strike/focusState'
import { isFishingObjective } from '@/lib/strike/objectiveKind'
import { evaluationKey } from '@/lib/strike/otherObjectives'

export const STRIKE_LIMITS = { plan: 'strike_friend', hunt: 3, fish: 3, total: 5 } as const

export type StrikeCategory = 'hunt' | 'fish'

export type SlotCount = { used: number; max: number }

export type StrikeSlots = {
  hunt: SlotCount
  fish: SlotCount
  total: SlotCount
}

// The user's own active, not-yet-ended Strike objective_profiles rows, by category.
// Removed ('archived'), completed and missed rows are excluded by the status filter alone.
export async function strikeSlots(service: SupabaseClient, userId: string, now: Date = new Date()): Promise<StrikeSlots> {
  const { data, error } = await service
    .from('objective_profiles')
    .select(PROFILE_WINDOW_COLUMNS)
    .eq('user_id', userId)
    .eq('org_source', 'strike')
    .eq('status', 'active')
  if (error) throw new Error(`strikeSlots: profile read failed: ${error.message}`)

  const profiles = (data ?? []) as unknown as ObjectiveWindowProfile[]
  // Same remap the home page uses: an unlinked profile (objective_id null) is keyed by its own id.
  const keyed = profiles.map(p => ({ ...p, objective_id: evaluationKey(p) }))
  const evaluations = await evaluateProfilesWindow(service, keyed)

  let hunt = 0
  let fish = 0
  for (const p of profiles) {
    const evaluation = evaluations.get(evaluationKey(p)) ?? null
    const today = localDateIn(now, objectiveTimezone(p))
    if (focusState(evaluation, p.status, today) === 'ended') continue
    if (isFishingObjective(p)) fish++
    else hunt++
  }

  return {
    hunt: { used: hunt, max: STRIKE_LIMITS.hunt },
    fish: { used: fish, max: STRIKE_LIMITS.fish },
    total: { used: hunt + fish, max: STRIKE_LIMITS.total },
  }
}

// Which category a new objective belongs to, from the same request fields the intake route
// already has (domain, taxonomy_key) — never branching on domain directly.
export function categoryFor(input: { domain?: unknown; taxonomy_key?: unknown }): StrikeCategory {
  return isFishingObjective(input) ? 'fish' : 'hunt'
}
