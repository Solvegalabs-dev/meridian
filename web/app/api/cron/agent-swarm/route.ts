import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agents/agentRunner';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveAgentParams } from '@/lib/agents/agentContextResolver';
import { selectAgentSwarmProfiles } from '@/lib/strike/sweepSelectors';
import { evaluateProfilesWindow, type ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow';
import { objectiveTimezone } from '@/lib/objectives/seasonMatcher';
import { localDateIn, type WindowEvaluation } from '@/lib/objectives/windowState';
import { focusState } from '@/lib/strike/focusState';
import { shouldCollectThisCycle } from '@/lib/strike/collectionCadence';

export const maxDuration = 300;

type ObjectiveGeoProfile = ObjectiveWindowProfile & {
  assigned_agents: string[] | null;
  county: string | null;
  org_source: string | null;
};

// FF-106 Stage 2 Part A: whether a Strike objective's focus allows collection this cycle.
// Every non-Strike profile (partner, MIP, Arc, …) is untouched and always runs.
// A missing evaluation (batch failure, or no entry for this objective) fails open: run as today.
function shouldRunProfile(
  profile: ObjectiveGeoProfile,
  evaluations: Map<string, WindowEvaluation>,
  now: Date,
  tally: { ran: number; skippedRadar: number; skippedNextYear: number; skippedEnded: number },
): boolean {
  if (profile.org_source !== 'strike') return true

  const evaluation = evaluations.get(profile.objective_id as string)
  if (evaluation === undefined) {
    console.error('[agent-swarm] focus evaluation failed, running profile as today:', profile.objective_id)
    tally.ran++
    return true
  }

  const tz = objectiveTimezone(profile)
  const today = localDateIn(now, tz)
  const focus = focusState(evaluation, profile.status, today)
  const collect = shouldCollectThisCycle(focus, now)

  if (collect) tally.ran++
  else if (focus === 'radar') tally.skippedRadar++
  else if (focus === 'next_year') tally.skippedNextYear++
  else if (focus === 'ended') tally.skippedEnded++

  return collect
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

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
  const { data: profilesRaw } = await selectAgentSwarmProfiles(supabase);
  const profiles = (profilesRaw ?? []) as unknown as ObjectiveGeoProfile[];

  // FF-106 Stage 2 Part A: one batched window read for every Strike profile with an objective,
  // same evaluator the home page uses. Fails open on error: the catch leaves evaluations empty,
  // so every Strike profile below is treated as "no evaluation" and runs as today.
  const strikeProfiles = profiles.filter(p => p.org_source === 'strike' && !!p.objective_id);
  let evaluations = new Map<string, WindowEvaluation>();
  try {
    evaluations = await evaluateProfilesWindow(supabase, strikeProfiles, now);
  } catch (err) {
    console.error('[agent-swarm] focus evaluation failed', err instanceof Error ? err.message : 'unknown');
  }

  const tally = { ran: 0, skippedRadar: 0, skippedNextYear: 0, skippedEnded: 0 };
  // Decided once per profile (not per agent), so a profile assigned to several agents is gated consistently.
  const collectThisCycle = new Map<string, boolean>();
  for (const p of profiles) {
    if (!p.objective_id) continue;
    collectThisCycle.set(p.objective_id, shouldRunProfile(p, evaluations, now, tally));
  }

  console.log(
    `[agent-swarm] cadence: ran ${tally.ran} · skipped radar ${tally.skippedRadar} · ` +
    `skipped next_year ${tally.skippedNextYear} · skipped ended ${tally.skippedEnded}`
  );

  const profilesByAgent = new Map<string, ObjectiveGeoProfile[]>();
  for (const p of profiles) {
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

    // Agents assigned to no objective ever run once with the FF-071 fallback context (UT).
    // An agent that DOES have assigned objectives, but every one of them is gated out this
    // cycle, is simply skipped: it does not fall back to the [null] context either.
    const allAssigned = profilesByAgent.get(agentKey);
    let assigned: (ObjectiveGeoProfile | null)[];
    if (allAssigned === undefined) {
      assigned = [null];
    } else {
      assigned = allAssigned.filter(p => collectThisCycle.get(p.objective_id as string) !== false);
      if (assigned.length === 0) continue;
    }

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

  return NextResponse.json({
    ran: results.length,
    hits,
    errors,
    results,
    skipped: { radar: tally.skippedRadar, next_year: tally.skippedNextYear, ended: tally.skippedEnded },
  });
}
