'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAgentCases } from '@/lib/supabase/queries/enterprise'
import { VerticalCaseCard } from '@/components/enterprise/vertical/VerticalCaseCard'
import type { VerticalConfig, EnterpriseCase, DriftTier } from '@/lib/vertical/verticalTypes'

// Client component — reads ?iid= from search params to scope institution.
// To avoid making this a full server component (which would need to re-fetch
// verticalConfig on every navigation), we fetch verticalConfig client-side.

type View = 'all' | 'by-agent'

interface AgentCase extends EnterpriseCase {
  agent_name: string | null
  agent_role: string | null
  drift_tier: DriftTier
  drift_score: number
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of arr) {
    const k = key(item)
    if (!result[k]) result[k] = []
    result[k].push(item)
  }
  return result
}

function TierPillRow({ cases }: { cases: Array<{ drift_tier: DriftTier }> }) {
  const counts: Record<DriftTier, number> = { CRITICAL: 0, ALERT: 0, CAUTION: 0, STABLE: 0 }
  for (const c of cases) counts[c.drift_tier]++
  const pills: Array<{ tier: DriftTier; cls: string }> = [
    { tier: 'CRITICAL', cls: 'bg-red-600 text-white' },
    { tier: 'ALERT',    cls: 'bg-amber-500 text-white' },
    { tier: 'CAUTION',  cls: 'bg-yellow-400 text-gray-900' },
    { tier: 'STABLE',   cls: 'bg-green-500 text-white' },
  ]
  return (
    <div className="flex gap-1">
      {pills.map(({ tier, cls }) =>
        counts[tier] > 0 ? (
          <span key={tier} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
            {counts[tier]} {tier}
          </span>
        ) : null
      )}
    </div>
  )
}

function EnterpriseCasesInner() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const iidParam = searchParams.get('iid')

  const [cases, setCases] = useState<AgentCase[]>([])
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [view, setView] = useState<View>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/login'; return }

      // Resolve institution: validate ?iid= membership, else first membership
      let iId: string | null = null

      if (iidParam) {
        const { data: membership } = await supabase
          .from('enterprise_members')
          .select('institution_id')
          .eq('institution_id', iidParam)
          .eq('user_id', user.id)
          .maybeSingle()
        iId = membership?.institution_id ?? null
      }

      if (!iId) {
        const { data: firstMember } = await supabase
          .from('enterprise_members')
          .select('institution_id')
          .eq('user_id', user.id)
          .order('invited_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        iId = firstMember?.institution_id ?? null
      }

      const resolvedIId = iId ?? 'a1b2c3d4-0000-0000-0000-000000000001'
      // Get member role
      const { data: member } = await supabase
        .from('enterprise_members')
        .select('role')
        .eq('institution_id', resolvedIId)
        .eq('user_id', user.id)
        .maybeSingle()
      setUserRole(member?.role ?? null)

      // Get vertical config
      const { data: vc } = await supabase
        .from('vertical_config')
        .select('id, institution_id, vertical_type, case_schema, objective_templates, signal_sources, ui_theme, pricing_model, macro_event_categories')
        .eq('institution_id', resolvedIId)
        .maybeSingle()
      setVerticalConfig(vc ?? null)

      // Get cases with agents and drift tiers
      const casesData = await getAgentCases(supabase as Parameters<typeof getAgentCases>[0], resolvedIId)
      setCases(casesData as AgentCase[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load cases')
    } finally {
      setLoading(false)
    }
  }, [supabase, iidParam])

  useEffect(() => { loadAll() }, [loadAll])

  const canToggleByAgent = userRole === 'broker_owner' || userRole === 'admin'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading cases...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
      </div>
    )
  }

  // Group cases by agent for by-agent view
  const grouped = groupBy(cases, c => c.agent_id ?? '__unassigned__')
  const agentEntries = Object.entries(grouped).sort(([aId, aCases], [bId, bCases]) => {
    if (aId === '__unassigned__') return 1
    if (bId === '__unassigned__') return -1
    const aName = (aCases[0] as AgentCase).agent_name ?? ''
    const bName = (bCases[0] as AgentCase).agent_name ?? ''
    return aName.localeCompare(bName)
  })

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Nav */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/enterprise" className="text-sm text-gray-400 hover:text-gray-200">← Portal</Link>
        <span className="text-gray-700">/</span>
        <span className="text-sm text-gray-200 font-medium">Cases</span>
      </div>

      {/* Header + view toggle */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Cases</h1>
          <p className="text-sm text-gray-400 mt-0.5">{cases.length} in-scope</p>
        </div>
        {canToggleByAgent && (
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setView('all')}
              className={`text-sm px-3 py-1.5 rounded-md transition-colors ${view === 'all' ? 'bg-blue-700 text-white font-semibold' : 'text-gray-400 hover:text-gray-200'}`}
            >
              All Cases
            </button>
            <button
              onClick={() => setView('by-agent')}
              className={`text-sm px-3 py-1.5 rounded-md transition-colors ${view === 'by-agent' ? 'bg-blue-700 text-white font-semibold' : 'text-gray-400 hover:text-gray-200'}`}
            >
              By Agent
            </button>
          </div>
        )}
      </div>

      {view === 'by-agent' ? (
        /* By-agent view */
        <div className="space-y-8">
          {agentEntries.map(([agentId, agentCases]) => {
            const typedCases = agentCases as AgentCase[]
            const agentName = typedCases[0].agent_name ?? 'Unassigned'
            return (
              <section key={agentId}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="font-semibold text-gray-100">{agentName}</h3>
                  <TierPillRow cases={typedCases} />
                  <span className="text-xs text-gray-500 ml-auto">
                    {typedCases.length} case{typedCases.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {typedCases.map(c => (
                    <VerticalCaseCard
                      key={c.id}
                      case={c}
                      verticalConfig={verticalConfig}
                      driftTier={c.drift_tier}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        /* All cases grid */
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cases.map(c => (
            <VerticalCaseCard
              key={c.id}
              case={c}
              verticalConfig={verticalConfig}
              driftTier={c.drift_tier}
            />
          ))}
          {cases.length === 0 && (
            <div className="col-span-full text-center text-gray-500 py-16">
              No cases found for this institution.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function EnterpriseCasesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <EnterpriseCasesInner />
    </Suspense>
  )
}
