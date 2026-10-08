// Profile selectors for the agent swarm and the sweep's Strike pass (FF-096). A removed Strike
// objective has objective_profiles.status 'archived' (and objectives.status 'archived'); neither
// path may pick it up. Kept as named helpers so the exclusion is tested once, not re-derived per caller.
import type { SupabaseClient } from '@supabase/supabase-js'

export const ARCHIVED_STATUS = 'archived'

// Profiles whose assigned agents the swarm cron runs. Ended hunts ('completed') and removed ones ('archived') are skipped.
export function selectAgentSwarmProfiles(db: SupabaseClient) {
  return db
    .from('objective_profiles')
    .select('objective_id, assigned_agents, state, county')
    .not('assigned_agents', 'is', null)
    // FF-089 P0: ended hunts (season closed / trip ended) are status 'completed'; no agent runs for them.
    .neq('status', 'completed')
    // FF-096: a removed objective never runs agents.
    .neq('status', ARCHIVED_STATUS)
}

// The user's Strike profiles the sweep binds agents to and writes briefs for. Ended hunts stay (they get
// their deterministic CLOSED brief); removed ones do not, even when they were lifecycle-ended before removal.
export function selectStrikeProfilesForSweep(db: SupabaseClient, userId: string) {
  return db
    .from('objective_profiles')
    .select('objective_id, user_id, domain')
    .eq('user_id', userId)
    .eq('org_source', 'strike')
    .neq('status', ARCHIVED_STATUS)
    .or('status.eq.active,ended_at.not.is.null')
    .not('objective_id', 'is', null)
}
