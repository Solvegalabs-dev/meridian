import type { SupabaseClient } from '@supabase/supabase-js';

// Returns cases for an institution joined with their assigned agent's name,
// plus the latest drift_tier from enterprise_case_history.
export async function getAgentCases(supabase: SupabaseClient, institutionId: string) {
  // Step 1: fetch all in-scope cases with agent info
  const { data: cases, error: casesErr } = await supabase
    .from('enterprise_cases')
    .select(`
      id,
      case_ref,
      institution_id,
      agent_id,
      in_scope,
      loan_data,
      region,
      fico_band,
      vehicle_class,
      loan_status,
      ltv_ratio,
      dti_ratio,
      current_balance,
      payments_remaining,
      broker_agents!agent_id (
        id,
        full_name,
        role,
        email
      )
    `)
    .eq('institution_id', institutionId)
    .eq('in_scope', true);

  if (casesErr) throw casesErr;
  if (!cases || cases.length === 0) return [];

  // Step 2: get latest drift_tier per case from enterprise_case_history
  const caseIds = cases.map((c: { id: string }) => c.id);
  const { data: histRaw } = await supabase
    .from('enterprise_case_history')
    .select('case_id, drift_tier, drift_score')
    .in('case_id', caseIds)
    .not('drift_tier', 'is', null)
    .order('snapshot_at', { ascending: false });

  const histMap = new Map<string, { drift_tier: string; drift_score: number }>();
  for (const row of histRaw ?? []) {
    if (!histMap.has(row.case_id)) histMap.set(row.case_id, row as { drift_tier: string; drift_score: number });
  }

  // Step 3: merge
  return cases.map((c: Record<string, unknown>) => {
    const h = histMap.get(c.id as string);
    const agent = c.broker_agents as { id: string; full_name: string; role: string; email: string } | null;
    return {
      ...c,
      agent_name: agent?.full_name ?? null,
      agent_role: agent?.role ?? null,
      drift_tier: (h?.drift_tier ?? 'STABLE') as 'CRITICAL' | 'ALERT' | 'CAUTION' | 'STABLE',
      drift_score: h?.drift_score ?? 0,
    };
  });
}

export async function getCaseWithAgent(supabase: SupabaseClient, caseId: string) {
  const { data, error } = await supabase
    .from('enterprise_cases')
    .select(`
      *,
      broker_agents!agent_id (
        full_name,
        role,
        email
      )
    `)
    .eq('id', caseId)
    .single();
  if (error) throw error;
  return data;
}
