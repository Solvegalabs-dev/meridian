// DB side of the window evaluator: loads an objective's profile and season rows,
// evaluates its state, and applies the one-time lifecycle transition.
//
// Transitions (never deletes rows):
//   ended (season_closed | trip_ended):
//     objective_profiles.status -> 'completed', ended_at / ended_reason set
//     campaign_units.status 'active' -> 'expired'   ('missed' is left alone)
//     hunt_campaigns.status -> 'closed' once no unit is still 'active'
//   reactivated (state no longer ended, and the profile was ended by this code):
//     reverse all of the above; ended_at / ended_reason cleared
//
// Profiles that were completed by hand (ended_at null) are never reactivated here.
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateWindowState, localDateIn, type WindowEvaluation, type TripTiming } from './windowState'
import { findSeasonRows, matchSeasonRows, objectiveTimezone, parseTaxonomyKey, seasonYearsFor, type HuntSeasonRow } from './seasonMatcher'

export type EndedReason = 'trip_ended' | 'season_closed'

export type ObjectiveWindowProfile = {
  id: string
  objective_id: string
  user_id: string
  status: string
  timing: TripTiming
  taxonomy_key: string | null
  state: string | null
  lat: number | null
  lon: number | null
  hunt_unit_id: string | null
  hunt_code?: string | null
  domain: string | null
  ended_at: string | null
  ended_reason: EndedReason | null
}

export const PROFILE_WINDOW_COLUMNS =
  'id, objective_id, user_id, status, timing, taxonomy_key, state, lat, lon, hunt_unit_id, hunt_code, domain, ended_at, ended_reason'

export function isEndedState(state: WindowEvaluation['state']): boolean {
  return state === 'season_closed' || state === 'trip_ended'
}

function endedReasonFor(state: WindowEvaluation['state']): EndedReason | null {
  if (state === 'season_closed') return 'season_closed'
  if (state === 'trip_ended') return 'trip_ended'
  return null
}

// Evaluates a profile row as it stands now. Read-only.
export async function evaluateProfileWindow(
  supabase: SupabaseClient,
  profile: ObjectiveWindowProfile,
  now: Date = new Date()
): Promise<{ evaluation: WindowEvaluation; tz: string; today: string }> {
  const tz = objectiveTimezone(profile)
  const today = localDateIn(now, tz)
  const seasonRows = await findSeasonRows(supabase, profile, today)
  const evaluation = evaluateWindowState({
    timing: profile.timing,
    seasonRows,
    today,
    tz,
  })
  return { evaluation, tz, today }
}

export async function loadObjectiveWindow(
  supabase: SupabaseClient,
  objectiveId: string,
  now: Date = new Date()
): Promise<{ profile: ObjectiveWindowProfile; evaluation: WindowEvaluation } | null> {
  const { data } = await supabase
    .from('objective_profiles')
    .select(PROFILE_WINDOW_COLUMNS)
    .eq('objective_id', objectiveId)
    .maybeSingle()
  if (!data) return null
  const profile = data as unknown as ObjectiveWindowProfile
  const { evaluation } = await evaluateProfileWindow(supabase, profile, now)
  return { profile, evaluation }
}

// Batch form of evaluateProfileWindow for list views. One hunt_seasons query for
// the whole set (not one per profile). Keyed by objective_id. Read-only.
// A failed season read fails open: profiles fall back to their trip window.
export async function evaluateProfilesWindow(
  supabase: SupabaseClient,
  profiles: ObjectiveWindowProfile[],
  now: Date = new Date()
): Promise<Map<string, WindowEvaluation>> {
  const result = new Map<string, WindowEvaluation>()
  if (profiles.length === 0) return result

  const local = profiles.map(profile => {
    const tz = objectiveTimezone(profile)
    const today = localDateIn(now, tz)
    return { profile, tz, today, year: Number(today.slice(0, 4)) }
  })

  const states = Array.from(new Set(local.map(l => l.profile.state?.toUpperCase()).filter((s): s is string => !!s)))
  const species = Array.from(new Set(local.map(l => parseTaxonomyKey(l.profile.taxonomy_key)?.species).filter((s): s is string => !!s)))
  // Both season years for every profile's today (see seasonYearsFor).
  const years = Array.from(new Set(local.flatMap(l => seasonYearsFor(l.today))))

  let rows: HuntSeasonRow[] = []
  if (states.length > 0 && species.length > 0) {
    const { data, error } = await supabase
      .from('hunt_seasons')
      .select('*')
      .in('state', states)
      .in('species', species)
      .in('season_year', years)
    if (error) console.error('[seasonMatcher] hunt_seasons batch read failed:', error.message)
    else rows = (data ?? []) as HuntSeasonRow[]
  }

  for (const l of local) {
    const seasonRows = matchSeasonRows(l.profile, rows, l.year, l.today)
    result.set(l.profile.objective_id, evaluateWindowState({
      timing: l.profile.timing,
      seasonRows,
      today: l.today,
      tz: l.tz,
    }))
  }
  return result
}

// Applies the transition for one profile. Returns what changed.
export async function applyWindowLifecycle(
  supabase: SupabaseClient,
  profile: ObjectiveWindowProfile,
  evaluation: WindowEvaluation,
  now: Date = new Date()
): Promise<'ended' | 'reactivated' | null> {
  const nowIso = now.toISOString()
  const reason = endedReasonFor(evaluation.state)

  if (reason) {
    const profileChanged = profile.status !== 'completed' || profile.ended_reason !== reason
    if (profileChanged) {
      const { error } = await supabase
        .from('objective_profiles')
        .update({
          status: 'completed',
          ended_at: profile.ended_at ?? nowIso,
          ended_reason: reason,
        })
        .eq('id', profile.id)
      if (error) throw new Error(`objective_profiles end failed: ${error.message}`)
    }

    // Cascade is idempotent: it only touches units still 'active'.
    const campaignIds = await expireActiveUnits(supabase, profile.objective_id)
    await closeFinishedCampaigns(supabase, campaignIds)
    return profileChanged ? 'ended' : null
  }

  // Not ended. Only undo a transition this code made.
  if (profile.status === 'completed' && profile.ended_at !== null) {
    const { error } = await supabase
      .from('objective_profiles')
      .update({ status: 'active', ended_at: null, ended_reason: null })
      .eq('id', profile.id)
    if (error) throw new Error(`objective_profiles reactivate failed: ${error.message}`)

    const campaignIds = await reactivateExpiredUnits(supabase, profile.objective_id)
    await reopenCampaigns(supabase, campaignIds)
    return 'reactivated'
  }

  return null
}

async function expireActiveUnits(supabase: SupabaseClient, objectiveId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaign_units')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('objective_id', objectiveId)
    .eq('status', 'active')
    .select('campaign_id')
  if (error) throw new Error(`campaign_units expire failed: ${error.message}`)
  return Array.from(new Set((data ?? []).map(r => r.campaign_id as string)))
}

async function reactivateExpiredUnits(supabase: SupabaseClient, objectiveId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaign_units')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('objective_id', objectiveId)
    .eq('status', 'expired')
    .select('campaign_id')
  if (error) throw new Error(`campaign_units reactivate failed: ${error.message}`)
  return Array.from(new Set((data ?? []).map(r => r.campaign_id as string)))
}

// A campaign closes when none of its units is still 'active' (every unit is expired or missed).
async function closeFinishedCampaigns(supabase: SupabaseClient, campaignIds: string[]): Promise<void> {
  for (const campaignId of campaignIds) {
    const { count, error } = await supabase
      .from('campaign_units')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'active')
    if (error) throw new Error(`campaign_units count failed: ${error.message}`)
    if ((count ?? 0) === 0) {
      const { error: updErr } = await supabase
        .from('hunt_campaigns')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('status', 'active')
      if (updErr) throw new Error(`hunt_campaigns close failed: ${updErr.message}`)
    }
  }
}

async function reopenCampaigns(supabase: SupabaseClient, campaignIds: string[]): Promise<void> {
  for (const campaignId of campaignIds) {
    const { error } = await supabase
      .from('hunt_campaigns')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'closed')
    if (error) throw new Error(`hunt_campaigns reopen failed: ${error.message}`)
  }
}

// Sweep entry point. Evaluates every Strike profile for the user (active and
// previously ended, so reactivation can happen), applies transitions, and returns
// the objective ids that are ended. The caller skips those for sweeps and briefs.
// Per-profile failures are logged and do not stop the rest.
export async function applyWindowLifecycleForUser(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<Set<string>> {
  const ended = new Set<string>()
  const { data: profiles, error } = await supabase
    .from('objective_profiles')
    .select(PROFILE_WINDOW_COLUMNS)
    .eq('user_id', userId)
    .eq('org_source', 'strike')
    .in('status', ['active', 'completed'])
    .not('objective_id', 'is', null)
  if (error) {
    console.error('[lifecycle] profile load failed:', error.message)
    return ended
  }

  for (const row of (profiles ?? []) as unknown as ObjectiveWindowProfile[]) {
    try {
      const { evaluation } = await evaluateProfileWindow(supabase, row, now)
      // Added before the write, so a failed transition still keeps the hunt out of the sweep.
      if (isEndedState(evaluation.state)) ended.add(row.objective_id)
      const change = await applyWindowLifecycle(supabase, row, evaluation, now)
      if (change) console.log(`[lifecycle] ${row.objective_id} ${change} (${evaluation.state}, ${evaluation.detail.code})`)
    } catch (err) {
      console.error(`[lifecycle] ${row.objective_id} failed:`, err)
    }
  }
  return ended
}
