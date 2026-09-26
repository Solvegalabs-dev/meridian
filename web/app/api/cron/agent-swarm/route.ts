import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agents/agentRunner';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveAgentParams } from '@/lib/agents/agentContextResolver';

export const maxDuration = 300;

type ObjectiveGeoProfile = {
  objective_id: string;
  assigned_agents: string[] | null;
  state: string | null;
  county: string | null;
};

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: agents } = await supabase
    .from('agent_configs')
    .select('agent_key, vertical, domain, geo_scope, source_url_template')
    .eq('is_active', true);

  if (!agents || agents.length === 0) {
    return NextResponse.json({ ran: 0 });
  }

  // FF-089: map each agent to the objective profiles that assign it, so each run
  // carries that objective's geography. runAgent() loads the profile's geo columns
  // (NWS grid, lat/lon, USGS gauges, SNOTEL stations, hunt unit) by objectiveId.
  const { data: profiles } = await supabase
    .from('objective_profiles')
    .select('objective_id, assigned_agents, state, county')
    .not('assigned_agents', 'is', null);

  const profilesByAgent = new Map<string, ObjectiveGeoProfile[]>();
  for (const p of (profiles ?? []) as ObjectiveGeoProfile[]) {
    if (!p.objective_id) continue;
    for (const key of p.assigned_agents ?? []) {
      const list = profilesByAgent.get(key) ?? [];
      list.push(p);
      profilesByAgent.set(key, list);
    }
  }

  // Sequential to avoid rate limiting on government APIs
  const results = [];
  for (const agent of agents) {
    const agentKey = agent.agent_key as string;
    const geoScope = agent.geo_scope as string[] | null;
    const agentInput = {
      source_url_template: agent.source_url_template as string,
      domain: agent.domain as string,
      geo_scope: geoScope,
    };

    // Agents assigned to no objective run once with the FF-071 fallback context (UT)
    const assigned: (ObjectiveGeoProfile | null)[] = profilesByAgent.get(agentKey) ?? [null];

    // One run per assigned objective, each with that objective's geographic parameters
    for (const profile of assigned) {
      const resolvedParams = resolveAgentParams(agentInput, {
        state: profile?.state ?? geoScope?.[0] ?? 'UT',
        county: profile?.county ?? geoScope?.[1] ?? '',
        domain: agent.domain as string,
      });

      const result = await runAgent(agentKey, {
        ...resolvedParams,
        ...(profile ? { objectiveId: profile.objective_id } : {}),
      });
      results.push(profile ? { ...result, objectiveId: profile.objective_id } : result);
    }
  }

  const hits = results.filter(r => r.result === 'hit').length;
  const errors = results.filter(r => r.result === 'error').length;

  console.log(`[AgentSwarm] ${results.length} agent runs · ${hits} hits · ${errors} errors`);

  return NextResponse.json({ ran: results.length, hits, errors, results });
}
