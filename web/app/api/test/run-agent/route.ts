import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { runAgent } from '@/lib/agents/agentRunner';
import { resolveAgentParams } from '@/lib/agents/agentContextResolver';

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const agentKey = searchParams.get('agent_key');
  if (!agentKey) return NextResponse.json({ error: 'agent_key required' }, { status: 400 });

  const service = createServiceClient();

  const { data: agent, error } = await service
    .from('agent_configs')
    .select('agent_key, domain, geo_scope, source_url_template, is_active')
    .eq('agent_key', agentKey)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: `Agent not found: ${agentKey}` }, { status: 404 });
  }

  if (!agent.is_active) {
    return NextResponse.json({ error: `Agent is inactive: ${agentKey}` }, { status: 400 });
  }

  const resolvedParams = resolveAgentParams(
    {
      source_url_template: agent.source_url_template as string,
      domain: agent.domain as string,
      geo_scope: agent.geo_scope as string[] | null,
    },
    {
      state: (agent.geo_scope as string[] | null)?.[0] ?? 'UT',
      county: (agent.geo_scope as string[] | null)?.[1] ?? '',
      domain: agent.domain as string,
    }
  );

  const result = await runAgent(agentKey, resolvedParams);

  return NextResponse.json({
    agentKey: result.agentKey,
    result: result.result,
    durationMs: result.durationMs,
    thresholdValueObserved: result.thresholdValueObserved ?? null,
    eventId: result.eventId ?? null,
    errorMessage: result.errorMessage ?? null,
  });
}
