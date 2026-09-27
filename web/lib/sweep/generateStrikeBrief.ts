import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicClient } from '@/lib/anthropic/client'

export interface StrikeBriefResult {
  objectiveId: string
  briefId: string | null
  skipped: boolean
  reason?: string
}

/**
 * Generates a Strike Brief for an objective that has active outdoor/hunt
 * agents bound to it via agent_objective_context.
 *
 * Queries the last 30 days of agent_run_log hits. Calls Claude Haiku to
 * synthesize a tactical brief. Writes to strike_briefs table.
 *
 * Non-fatal — returns skipped:true if no agents or no hits.
 */
export async function generateStrikeBrief(
  supabase: SupabaseClient,
  userId: string,
  objective: {
    id: string
    obj_id: string
    title: string
    category?: string | null
    context?: Record<string, unknown> | null
    target_date?: string | null
  }
): Promise<StrikeBriefResult> {
  const empty: StrikeBriefResult = { objectiveId: objective.id, briefId: null, skipped: false }

  try {
    // 1. Get the agent keys bound to this objective (outdoor/hunt domain agents)
    const { data: agentCtx } = await supabase
      .from('agent_objective_context')
      .select('agent_key')
      .eq('objective_id', objective.id)
      .eq('user_id', userId)

    if (!agentCtx || agentCtx.length === 0) {
      return { ...empty, skipped: true, reason: 'No agents bound to this objective' }
    }

    const boundAgentKeys = agentCtx.map(a => a.agent_key as string)

    // 2. Filter to outdoor/hunt domain agents only
    const { data: outdoorAgents } = await supabase
      .from('agent_configs')
      .select('agent_key, display_name, description, event_category, domain')
      .in('agent_key', boundAgentKeys)
      .in('domain', ['outdoor', 'universal'])

    if (!outdoorAgents || outdoorAgents.length === 0) {
      return { ...empty, skipped: true, reason: 'No outdoor/universal agents bound to this objective' }
    }

    const outdoorAgentKeys = outdoorAgents.map(a => a.agent_key as string)
    const agentInfoMap = new Map(
      outdoorAgents.map(a => [
        a.agent_key as string,
        { display_name: a.display_name as string, event_category: a.event_category as string | null },
      ])
    )

    // 3. Fetch recent agent hits for this objective's agents
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: agentHits } = await supabase
      .from('agent_run_log')
      .select('agent_key, result, threshold_value_observed, ran_at, geo_context')
      .eq('result', 'hit')
      .in('agent_key', outdoorAgentKeys)
      .gte('ran_at', thirtyDaysAgo.toISOString())
      .order('ran_at', { ascending: false })
      .limit(20)

    // 4. Fetch recent misses for context
    const { data: recentMisses } = await supabase
      .from('agent_run_log')
      .select('agent_key, result, ran_at')
      .in('result', ['miss', 'skip'])
      .in('agent_key', outdoorAgentKeys)
      .gte('ran_at', thirtyDaysAgo.toISOString())
      .order('ran_at', { ascending: false })
      .limit(10)

    if (!agentHits || agentHits.length === 0) {
      return { ...empty, skipped: true, reason: 'No agent hits in last 30 days' }
    }

    // 5. Build prompt context
    const hitSummary = agentHits.map(hit => {
      const info = agentInfoMap.get(hit.agent_key as string)
      const dateStr = new Date(hit.ran_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `- [${dateStr}] ${info?.display_name ?? hit.agent_key}: HIT${(hit.threshold_value_observed as number | null) !== null ? ` (value: ${hit.threshold_value_observed})` : ''}${info?.event_category ? ` [${info.event_category}]` : ''}`
    }).join('\n')

    const missSummary = (recentMisses ?? []).map(m => {
      const info = agentInfoMap.get(m.agent_key as string)
      return `- ${info?.display_name ?? m.agent_key}: ${(m.result as string).toUpperCase()}`
    }).join('\n') || 'None'

    const huntUnit = (objective.context as Record<string, string> | null)?.hunt_unit ?? null
    const targetDate = objective.target_date

    const prompt = `You are synthesizing a tactical Strike Brief for a hunter. The objective is: "${objective.title}".
${huntUnit ? `Hunt unit: ${huntUnit}` : ''}
${targetDate ? `Target date: ${targetDate}` : ''}

AGENT HITS (last 30 days — threshold crossed):
${hitSummary}

RECENT MISSES/SKIPS (no threshold crossed — monitoring continues):
${missSummary}

Generate a concise Strike Brief JSON with these exact fields:
- synthesis: 2-3 sentence tactical synthesis of what the agents are telling the hunter right now
- lead_signal: the single most important signal (1 sentence, e.g. "USGS streamflow at 340 CFS — fishable, declining toward seasonal low")
- go_no_go: "GO", "CONDITIONAL", or "WAIT" with a 1-sentence rationale
- condition_delta: how conditions have changed in the last 30 days (1 sentence)
- confidence_tier: "HIGH", "MEDIUM", or "LOW" based on signal density and recency
- time_window: the recommended action window (e.g. "Next 7-10 days", "Opening weekend", "Hold 2-3 weeks")

Respond ONLY with valid JSON, no markdown fences.`

    const msg = await getAnthropicClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned) as {
      synthesis?: string
      lead_signal?: string
      go_no_go?: string
      condition_delta?: string
      confidence_tier?: string
      time_window?: string
    }

    // 6. Write to strike_briefs
    const { data: brief } = await supabase
      .from('strike_briefs')
      .insert({
        objective_id: objective.id,
        user_id: userId,
        brief_date: new Date().toISOString().split('T')[0],
        time_window: parsed.time_window ?? 'Unknown',
        domain: 'outdoor',
        synthesis: parsed.synthesis ?? 'No synthesis available',
        lead_signal: parsed.lead_signal ?? null,
        go_no_go: parsed.go_no_go ?? null,
        condition_delta: parsed.condition_delta ?? null,
        confidence_tier: parsed.confidence_tier ?? null,
        agent_hits: agentHits.map(h => ({
          agent_key: h.agent_key,
          ran_at: h.ran_at,
          threshold_value_observed: h.threshold_value_observed,
          geo_context: h.geo_context,
        })),
      })
      .select('id')
      .single()

    console.log(
      `[strike-brief] Generated for objective ${objective.obj_id} ` +
      `go_no_go=${parsed.go_no_go} confidence=${parsed.confidence_tier} briefId=${brief?.id}`
    )

    return { objectiveId: objective.id, briefId: brief?.id ?? null, skipped: false }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[strike-brief] Failed for objective ${objective.obj_id}:`, msg)
    // Non-fatal — return without briefId
    return { ...empty }
  }
}
