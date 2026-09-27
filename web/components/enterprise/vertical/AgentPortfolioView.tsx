import { createClient } from '@/lib/supabase/server';
import { getAgentCases } from '@/lib/supabase/queries/enterprise';
import type { VerticalConfig, DriftTier } from '@/lib/vertical/verticalTypes';
import { VerticalCaseCard } from './VerticalCaseCard';

interface Props {
  institutionId: string;
  verticalConfig: VerticalConfig | null;
}

function TierPillRow({ cases }: { cases: Array<{ drift_tier: DriftTier }> }) {
  const counts: Record<DriftTier, number> = { CRITICAL: 0, ALERT: 0, CAUTION: 0, STABLE: 0 };
  for (const c of cases) counts[c.drift_tier]++;

  const pills: Array<{ tier: DriftTier; color: string }> = [
    { tier: 'CRITICAL', color: 'bg-red-600 text-white' },
    { tier: 'ALERT',    color: 'bg-amber-500 text-white' },
    { tier: 'CAUTION',  color: 'bg-yellow-400 text-gray-900' },
    { tier: 'STABLE',   color: 'bg-green-500 text-white' },
  ];

  return (
    <div className="flex gap-1">
      {pills.map(({ tier, color }) =>
        counts[tier] > 0 ? (
          <span key={tier} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${color}`}>
            {counts[tier]} {tier}
          </span>
        ) : null
      )}
    </div>
  );
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}

export async function AgentPortfolioView({ institutionId, verticalConfig }: Props) {
  const supabase = createClient();
  let cases: Awaited<ReturnType<typeof getAgentCases>> = [];

  try {
    cases = await getAgentCases(supabase, institutionId);
  } catch (err) {
    console.error('[AgentPortfolioView] getAgentCases error:', err);
  }

  if (cases.length === 0) {
    return (
      <div className="text-center text-gray-400 text-sm py-12">
        No cases found for this institution.
      </div>
    );
  }

  const grouped = groupBy(cases, (c: Record<string, unknown>) => (c.agent_id as string) ?? '__unassigned__');

  // Sort: assigned agents first (alphabetically by name), unassigned last
  const entries = Object.entries(grouped).sort(([aId, aCases], [bId, bCases]) => {
    if (aId === '__unassigned__') return 1;
    if (bId === '__unassigned__') return -1;
    const aName = (aCases[0] as Record<string, unknown>).agent_name as string ?? '';
    const bName = (bCases[0] as Record<string, unknown>).agent_name as string ?? '';
    return aName.localeCompare(bName);
  });

  return (
    <div className="space-y-8">
      {entries.map(([agentId, agentCases]) => {
        const typedCases = agentCases as Array<Record<string, unknown> & { drift_tier: DriftTier }>;
        const agentName = (typedCases[0].agent_name as string) ?? 'Unassigned';
        return (
          <section key={agentId}>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="font-semibold text-gray-800">{agentName}</h3>
              <TierPillRow cases={typedCases} />
              <span className="text-xs text-gray-400 ml-auto">{typedCases.length} case{typedCases.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {typedCases.map(c => (
                <VerticalCaseCard
                  key={c.id as string}
                  case={c as unknown as Parameters<typeof VerticalCaseCard>[0]['case']}
                  verticalConfig={verticalConfig}
                  driftTier={c.drift_tier}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
