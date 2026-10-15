// "Plan again for next year" (FF-106 Stage 2 Part B): a finished Strike objective (focus 'ended')
// spawns a NEW objective for the same user, one calendar year out, with the same spots. It copies
// no briefs, notes, readings or confidence history, and leaves the source exactly as it is.
//
// Deliberately does NOT use objectives.parent_objective_id to link the two: the abandon route
// cascades on that column, and a "planned again" objective must never be swept up by it. No
// lineage between the old and new objective is recorded anywhere.
import type { SupabaseClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { evaluateProfileWindow } from '@/lib/objectives/objectiveWindow'
import { localDateIn, parseCalendarDate } from '@/lib/objectives/windowState'
import { objectiveTimezone } from '@/lib/objectives/seasonMatcher'
import { focusState } from '@/lib/strike/focusState'
import { isCampaignUnit } from '@/lib/strike/campaignUnit'
import { ManagementError, type ManagedProfile } from '@/lib/strike/objectiveManagement'
import { strikeSlots, categoryFor, type StrikeCategory } from '@/lib/strike/limits'
import { createLinkedObjective, LinkedObjectiveError } from '@/lib/objectives/linkedObjective'
import { createSpot } from '@/lib/spots/spotService'
import { resolveAgentBundle } from '@/lib/swarm/objectiveRouter'
import { runAgentsForObjective } from '@/lib/agents/runAgentsForObjective'

// Same month and day, one year later. 29 Feb moves to 28 Feb (the next year is never the same
// leap year), by clamping to that year's last day of the month.
export function shiftTripYearDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const nextYear = y + 1
  const lastDayOfMonth = new Date(Date.UTC(nextYear, m, 0)).getUTCDate()
  const day = Math.min(d, lastDayOfMonth)
  return `${nextYear}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Shifts trip_start/trip_end one year forward. Any other timing key, and a source with no dates
// at all, is left as-is (empty in, empty out).
export function shiftTimingOneYear(timing: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const start = parseCalendarDate(timing?.trip_start)
  const end = parseCalendarDate(timing?.trip_end)
  if (start) out.trip_start = shiftTripYearDate(start)
  if (end) out.trip_end = shiftTripYearDate(end)
  return out
}

// Thrown when the Strike-friend category or total slot cap is full. Carries the same shape
// the new-objective intake route already returns, so the client's existing limitReachedMessage() applies.
export class LimitReachedError extends Error {
  constructor(readonly category: StrikeCategory | 'total', readonly max: number) {
    super('objective_limit_reached')
    this.name = 'LimitReachedError'
  }
}

type SourceSpot = { name: string; lat: number; lon: number; is_active: boolean }

async function loadSourceSpots(db: SupabaseClient, objectiveId: string | null): Promise<SourceSpot[]> {
  if (!objectiveId) return []
  const { data, error } = await db
    .from('objective_spots')
    .select('name, lat, lon, is_active')
    .eq('objective_id', objectiveId)
  if (error) {
    console.error('[plan-again] source spot read failed:', error.message)
    return []
  }
  return (data ?? []) as SourceSpot[]
}

export type PlanAgainResult = { objectiveId: string; profileId: string }

export async function planAgainForNextYear(
  db: SupabaseClient,
  profile: ManagedProfile,
  now: Date = new Date(),
): Promise<PlanAgainResult> {
  if (await isCampaignUnit(db, profile)) {
    throw new ManagementError('This objective is part of a campaign and cannot be planned again here yet.', 409, 'campaign_unit')
  }

  const { evaluation } = await evaluateProfileWindow(db, profile, now)
  const today = localDateIn(now, objectiveTimezone(profile))
  if (focusState(evaluation, profile.status, today) !== 'ended') {
    throw new ManagementError('This objective is not finished yet, so it cannot be planned again.', 409, 'not_finished')
  }

  const { data: extra, error: extraErr } = await db
    .from('objective_profiles')
    .select('geo, priority_stack')
    .eq('id', profile.id)
    .maybeSingle()
  if (extraErr || !extra) throw new ManagementError('Could not read the objective. Try again.', 500, 'write_failed')
  const geo = (extra.geo ?? {}) as Record<string, unknown>

  const category = categoryFor({ domain: profile.domain, taxonomy_key: profile.taxonomy_key })
  const slots = await strikeSlots(db, profile.user_id as string)
  const categorySlot = slots[category]
  if (categorySlot.used >= categorySlot.max) throw new LimitReachedError(category, categorySlot.max)
  if (slots.total.used >= slots.total.max) throw new LimitReachedError('total', slots.total.max)

  const timing = shiftTimingOneYear(profile.timing)
  const { agents, buildStatus } = await resolveAgentBundle(profile.taxonomy_key ?? '', {
    state: profile.state ?? undefined,
    unit: profile.hunt_code ?? undefined,
  })

  let created
  try {
    created = await createLinkedObjective(db as Parameters<typeof createLinkedObjective>[0], {
      ownerUserId: profile.user_id as string,
      taxonomyKey: profile.taxonomy_key ?? '',
      huntCode: profile.hunt_code ?? null,
      timing,
      profile: {
        org_source: 'strike',
        partner_id: null,
        partner_user_ref: null,
        domain: profile.domain,
        taxonomy_key: profile.taxonomy_key,
        geo,
        priority_stack: extra.priority_stack ?? [],
        timing,
        assigned_agents: agents,
        agent_build_status: buildStatus === 'ready' ? 'ready' : buildStatus === 'partial' ? 'building' : 'queued',
        status: 'active',
        ...(profile.state ? { state: profile.state } : {}),
        ...(profile.hunt_code ? { hunt_code: profile.hunt_code } : {}),
        ...(profile.hunt_unit_id ? { hunt_unit_id: profile.hunt_unit_id } : {}),
      },
    })
  } catch (err) {
    const message = err instanceof LinkedObjectiveError ? err.cause_message ?? err.message : 'unknown'
    console.error('[plan-again] create failed:', message)
    throw new ManagementError('Could not create the new objective. Try again.', 500, 'write_failed')
  }

  // The active spot is copied first, so it is the one auto-activated when it becomes the first
  // spot on the new objective; every other spot is created explicitly inactive.
  const sourceSpots = await loadSourceSpots(db, profile.objective_id)
  const ordered = [...sourceSpots].sort((a, b) => Number(b.is_active) - Number(a.is_active))
  for (const spot of ordered) {
    try {
      await createSpot(db, {
        objectiveId: created.objectiveId,
        userId: profile.user_id as string,
        name: spot.name,
        lat: spot.lat,
        lon: spot.lon,
        makeActive: spot.is_active === true,
      })
    } catch (err) {
      console.error('[plan-again] spot copy failed:', err instanceof Error ? err.message : 'unknown')
    }
  }

  // FF-105B pattern: the new objective's own first collection run, after the response is sent.
  waitUntil(
    runAgentsForObjective(db, created.objectiveId).catch(e =>
      console.error('[plan-again] first collection run failed:', e)
    )
  )

  return { objectiveId: created.objectiveId, profileId: created.profileId }
}
