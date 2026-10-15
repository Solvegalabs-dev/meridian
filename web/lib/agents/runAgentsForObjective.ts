// FF-105B: runs one objective's own assigned agents once, right after it is created, so its
// Intel and Signals tabs have something before the next 6-hourly swarm
// (app/api/cron/agent-swarm/route.ts) reaches it. Strike session objectives only — the caller
// decides that; this file just runs whatever assigned_agents the profile already carries.
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAgent } from './agentRunner'
import { resolveAgentParams } from './agentContextResolver'

export async function runAgentsForObjective(supabase: SupabaseClient, objectiveId: string): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('objective_profiles')
      .select('assigned_agents, state, county')
      .eq('objective_id', objectiveId)
      .maybeSingle()

    const assignedAgents = (profile?.assigned_agents ?? []) as string[]
    if (assignedAgents.length === 0) return

    const { data: agents } = await supabase
      .from('agent_configs')
      .select('agent_key, domain, geo_scope, source_url_template')
      .eq('is_active', true)
      .in('agent_key', assignedAgents)

    // Sequential, same pacing as the swarm cron, to avoid rate limiting on government APIs.
    for (const agent of agents ?? []) {
      const agentKey = agent.agent_key as string
      const geoScope = agent.geo_scope as string[] | null
      const resolvedParams = resolveAgentParams(
        { source_url_template: agent.source_url_template as string, domain: agent.domain as string, geo_scope: geoScope },
        {
          state: (profile?.state as string | null) ?? geoScope?.[0] ?? 'UT',
          county: (profile?.county as string | null) ?? geoScope?.[1] ?? '',
          domain: agent.domain as string,
        },
      )
      await runAgent(agentKey, { ...resolvedParams, objectiveId })
    }
  } catch (err) {
    console.error('[runAgentsForObjective] failed', err instanceof Error ? err.message : err)
  }
}
