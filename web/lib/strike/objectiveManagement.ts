// Remove (soft archive), restore and edit for Strike objectives (FF-096).
//
// Remove is NOT the Arc abandon flow. It writes no outcome, episode, prediction or abandonment record,
// deletes nothing, and calls no abandon code. It flips two status columns and stamps the archive reason
// and date, so the objective disappears from the user's lists while its data stays for engine performance.
//
// Two-row convention (same as the OBJ-21 clean-up): objective_profiles.status and, when linked,
// objectives.status are both 'archived'. supabase-js has no cross-table transaction, so a failure on the
// second write puts the first one back.
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateProfileWindow, applyWindowLifecycle, isEndedState, PROFILE_WINDOW_COLUMNS, type ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'
import { localDateIn, parseCalendarDate } from '@/lib/objectives/windowState'
import { objectiveTimezone } from '@/lib/objectives/seasonMatcher'
import type { ObjectivePatch } from '@/lib/strike/objectivePatch'
import { isCampaignUnit } from '@/lib/strike/campaignUnit'

export { isCampaignUnit }

export { validateObjectivePatch, MAX_TITLE_LENGTH, MAX_NOTE_LENGTH } from '@/lib/strike/objectivePatch'
export type { ObjectivePatch, PatchValidation } from '@/lib/strike/objectivePatch'

export const REMOVED_REASON = 'Removed by owner'

export class ManagementError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'ManagementError'
  }
}

// Columns every management call needs from the profile (on top of the ownership columns).
export const MANAGEMENT_COLUMNS = [...PROFILE_WINDOW_COLUMNS.split(',').map(c => c.trim()), 'org_source']

export type ManagedProfile = ObjectiveWindowProfile & { org_source?: string | null }

const dateOnly = (now: Date) => now.toISOString().slice(0, 10)

async function setProfileStatus(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from('objective_profiles').update(patch).eq('id', id)
  return error
}

async function setObjectiveRow(db: SupabaseClient, objectiveId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('objectives').update(patch).eq('id', objectiveId)
  return error
}

export type ArchiveResult = { status: 'archived'; changed: boolean }

export async function archiveObjective(db: SupabaseClient, profile: ManagedProfile, now: Date = new Date()): Promise<ArchiveResult> {
  if (await isCampaignUnit(db, profile)) {
    throw new ManagementError('This objective is part of a campaign and cannot be removed here yet.', 409, 'campaign_unit')
  }

  if (profile.status === 'archived') {
    // Idempotent. Repair a half-finished earlier attempt: the linked row must be archived too.
    if (profile.objective_id) {
      const { data: row } = await db.from('objectives').select('status').eq('id', profile.objective_id).maybeSingle()
      if (row && row.status !== 'archived') {
        const err = await setObjectiveRow(db, profile.objective_id, {
          status: 'archived', archive_reason: REMOVED_REASON, archive_date: dateOnly(now),
        })
        if (err) throw new ManagementError('Could not remove the objective. Try again.', 500, 'write_failed')
      }
    }
    return { status: 'archived', changed: false }
  }

  const previousStatus = profile.status
  const profileErr = await setProfileStatus(db, profile.id, { status: 'archived' })
  if (profileErr) throw new ManagementError('Could not remove the objective. Try again.', 500, 'write_failed')

  if (profile.objective_id) {
    const objErr = await setObjectiveRow(db, profile.objective_id, {
      status: 'archived', archive_reason: REMOVED_REASON, archive_date: dateOnly(now),
    })
    if (objErr) {
      const rollbackErr = await setProfileStatus(db, profile.id, { status: previousStatus })
      if (rollbackErr) console.error('[strike/archive] rollback failed for profile', profile.id, rollbackErr.message)
      throw new ManagementError('Could not remove the objective. Try again.', 500, 'write_failed')
    }
  }
  return { status: 'archived', changed: true }
}

export type RestoreResult = { status: string; changed: boolean }

export async function restoreObjective(db: SupabaseClient, profile: ManagedProfile, now: Date = new Date()): Promise<RestoreResult> {
  // Only a removed objective is restored. Anything else is left exactly as it is.
  if (profile.status !== 'archived') return { status: profile.status, changed: false }

  // The lifecycle would complete it again on the next sweep, so say so now instead.
  const { evaluation } = await evaluateProfileWindow(db, profile, now)
  if (isEndedState(evaluation.state)) {
    throw new ManagementError(
      "This objective's trip window has ended, so it can't be restored. Create a new objective instead.",
      409,
      'window_ended',
    )
  }

  const previousEnd = { ended_at: profile.ended_at, ended_reason: profile.ended_reason }
  const profileErr = await setProfileStatus(db, profile.id, { status: 'active', ended_at: null, ended_reason: null })
  if (profileErr) throw new ManagementError('Could not restore the objective. Try again.', 500, 'write_failed')

  if (profile.objective_id) {
    const objErr = await setObjectiveRow(db, profile.objective_id, { status: 'active', archive_reason: null, archive_date: null })
    if (objErr) {
      const rollbackErr = await setProfileStatus(db, profile.id, { status: 'archived', ...previousEnd })
      if (rollbackErr) console.error('[strike/restore] rollback failed for profile', profile.id, rollbackErr.message)
      throw new ManagementError('Could not restore the objective. Try again.', 500, 'write_failed')
    }
  }
  return { status: 'active', changed: true }
}

// ─── Edit ────────────────────────────────────────────────────────────────────

function currentTiming(profile: ManagedProfile): Record<string, unknown> {
  const t = profile.timing
  return t && typeof t === 'object' && !Array.isArray(t) ? { ...(t as Record<string, unknown>) } : {}
}

export type UpdateResult = {
  title?: string
  note?: string | null
  timing: Record<string, unknown>
  reactivated: boolean
}

export async function updateObjective(
  db: SupabaseClient,
  profile: ManagedProfile,
  patch: ObjectivePatch,
  now: Date = new Date(),
): Promise<UpdateResult> {
  if (profile.status === 'archived') {
    throw new ManagementError('This objective was removed. Restore it to edit it.', 409, 'archived')
  }
  const touchesObjectiveRow = patch.title !== undefined || patch.note !== undefined
  if (touchesObjectiveRow && !profile.objective_id) {
    throw new ManagementError('This objective is not fully set up yet, so its title cannot be changed.', 409, 'not_linked')
  }

  // Merge into the existing timing so every other key (and any key we do not know about) survives.
  const previousTiming = currentTiming(profile)
  const timing = { ...previousTiming }
  for (const key of ['trip_start', 'trip_end'] as const) {
    if (!(key in patch)) continue
    const next = patch[key]
    if (next === null || next === undefined) delete timing[key]
    else timing[key] = next
  }

  const start = parseCalendarDate(timing.trip_start)
  const end = parseCalendarDate(timing.trip_end)
  if (start && end && end < start) {
    throw new ManagementError('The trip end cannot be before the trip start.', 400, 'invalid_dates')
  }

  // A trip end moved into the future reopens a hunt only if the lifecycle closed it (ended_at set).
  // One the owner closed by hand, or a missed one, stays closed: say so rather than look reopened.
  const closedByOwner = profile.status === 'missed' || (profile.status === 'completed' && !profile.ended_at)
  if (closedByOwner && 'trip_end' in patch && end) {
    const today = localDateIn(now, objectiveTimezone(profile))
    if (end >= today) {
      throw new ManagementError(
        'This objective was closed, so its dates cannot reopen it. Create a new objective instead.',
        409,
        'closed_by_owner',
      )
    }
  }

  const timingChanged = JSON.stringify(timing) !== JSON.stringify(previousTiming)
  if (timingChanged) {
    const err = await setProfileStatus(db, profile.id, { timing })
    if (err) throw new ManagementError('Could not save the changes. Try again.', 500, 'write_failed')
  }

  if (profile.objective_id && (touchesObjectiveRow || 'trip_end' in patch)) {
    const objectivePatch: Record<string, unknown> = {}
    if (patch.title !== undefined) objectivePatch.title = patch.title
    if (patch.note !== undefined) objectivePatch.notes = patch.note
    if ('trip_end' in patch) objectivePatch.target_date = end
    const objErr = await setObjectiveRow(db, profile.objective_id, objectivePatch)
    if (objErr) {
      if (timingChanged) {
        const rollbackErr = await setProfileStatus(db, profile.id, { timing: previousTiming })
        if (rollbackErr) console.error('[strike/edit] rollback failed for profile', profile.id, rollbackErr.message)
      }
      throw new ManagementError('Could not save the changes. Try again.', 500, 'write_failed')
    }
  }

  // The lifecycle reactivates only a profile it completed itself (ended_at set). Run it now rather than
  // waiting for the next sweep, so the owner sees the objective come back. Best effort: the sweep repeats it.
  let reactivated = false
  if (timingChanged && profile.status === 'completed' && profile.ended_at) {
    try {
      const updated: ManagedProfile = { ...profile, timing }
      const { evaluation } = await evaluateProfileWindow(db, updated, now)
      reactivated = (await applyWindowLifecycle(db, updated, evaluation, now)) === 'reactivated'
    } catch (err) {
      console.error('[strike/edit] lifecycle check failed:', err instanceof Error ? err.message : 'unknown')
    }
  }

  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    timing,
    reactivated,
  }
}
