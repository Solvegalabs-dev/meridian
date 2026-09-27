import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getVerticalConfig } from '@/lib/vertical/getVerticalConfig'
import { getCaseWithAgent } from '@/lib/supabase/queries/enterprise'
import { BenchmarkBadge } from '@/components/enterprise/vertical/BenchmarkBadge'
import type { CaseSchemaField, RealEstateLoanData, ListingLoanData, BuyerLoanData } from '@/lib/vertical/verticalTypes'

export const metadata = { title: 'Case Detail — Meridian Arc' }

function fmtFieldValue(value: unknown, fieldType: CaseSchemaField['field_type']): string {
  if (value == null) return '—'
  switch (fieldType) {
    case 'currency':
      return `$${Number(value).toLocaleString()}`
    case 'integer':
      return String(Math.round(Number(value)))
    case 'date':
      return new Date(String(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    default:
      return String(value)
  }
}

const TIER_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  ALERT: '#f97316',
  CAUTION: '#f59e0b',
  STABLE: '#10b981',
}

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { iid?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const paramIid = searchParams?.iid as string | undefined

  let institutionId: string | null = null

  if (paramIid) {
    const { data: membership } = await supabase
      .from('enterprise_members')
      .select('institution_id')
      .eq('institution_id', paramIid)
      .eq('user_id', user.id)
      .maybeSingle()
    institutionId = membership?.institution_id ?? null
  }

  if (!institutionId) {
    const { data: firstMember } = await supabase
      .from('enterprise_members')
      .select('institution_id')
      .eq('user_id', user.id)
      .order('invited_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    institutionId = firstMember?.institution_id ?? null
  }

  const resolvedInstitutionId = institutionId ?? 'a1b2c3d4-0000-0000-0000-000000000001'

  // Fetch case with agent
  let caseData: Awaited<ReturnType<typeof getCaseWithAgent>>
  try {
    caseData = await getCaseWithAgent(supabase, params.id)
  } catch {
    notFound()
  }

  // Confirm case belongs to this institution
  if ((caseData as Record<string, unknown>).institution_id !== resolvedInstitutionId) notFound()

  const verticalConfig = await getVerticalConfig(resolvedInstitutionId)

  // Latest drift tier from enterprise_case_history
  const { data: histRow } = await supabase
    .from('enterprise_case_history')
    .select('drift_tier, drift_score, snapshot_at')
    .eq('case_id', params.id)
    .not('drift_tier', 'is', null)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const driftTier = (histRow?.drift_tier as string) ?? 'STABLE'
  const driftScore = (histRow?.drift_score as number) ?? 0

  // Fetch latest objective results for this case (existing behavior)
  const { data: objResults } = await supabase
    .from('enterprise_objective_results')
    .select('affecting_it, implies, signals, what_to_do, computed_at, sweep_type, confidence_score')
    .eq('institution_id', resolvedInstitutionId)
    .order('computed_at', { ascending: false })
    .limit(3)

  const isRealEstate = verticalConfig?.vertical_type === 'real_estate'
  const loanData = (caseData as Record<string, unknown>).loan_data as RealEstateLoanData | null
  const agent = (caseData as Record<string, unknown>).broker_agents as { full_name: string; role: string; email: string } | null
  const tierColor = TIER_COLORS[driftTier] ?? TIER_COLORS.STABLE

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/enterprise" className="hover:text-gray-200">Portal</Link>
        <span>/</span>
        <Link href="/enterprise/cases" className="hover:text-gray-200">Cases</Link>
        <span>/</span>
        <span className="text-gray-200 font-medium">{(caseData as Record<string, unknown>).case_ref as string}</span>
      </div>

      {/* Case header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
        <div
          className="h-1.5"
          style={{ background: tierColor }}
        />
        <div className="px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-bold text-gray-900">
                  {isRealEstate && loanData?.case_type === 'listing'
                    ? (loanData as ListingLoanData).address
                    : isRealEstate && loanData?.case_type === 'buyer'
                    ? (loanData as BuyerLoanData).case_name
                    : (caseData as Record<string, unknown>).case_ref as string}
                </h1>
                <span
                  className="inline-flex items-center rounded px-2 py-0.5 text-xs font-bold text-white"
                  style={{ background: tierColor }}
                >
                  {driftTier}
                </span>
              </div>
              {isRealEstate && loanData?.bm && (
                <div className="mt-2">
                  <BenchmarkBadge bm={loanData.bm} />
                </div>
              )}
              {agent && (
                <p className="text-sm text-gray-500 mt-1">
                  Agent: <span className="font-medium text-gray-700">{agent.full_name}</span>
                  {agent.role === 'broker_owner' && <span className="ml-1 text-xs text-indigo-600">(Broker Owner)</span>}
                </p>
              )}
            </div>
            <div className="text-right text-sm text-gray-500">
              <div className="text-2xl font-black" style={{ color: tierColor }}>{driftScore}</div>
              <div className="text-xs">drift score</div>
            </div>
          </div>
        </div>
      </div>

      {/* Field grid — dynamic from vertical_config.case_schema for RE, or hardcoded for auto */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Case Details</h2>
        {isRealEstate && verticalConfig?.case_schema ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {verticalConfig.case_schema.map((field: CaseSchemaField) => {
              const rawValue = (loanData as Record<string, unknown> | null)?.[field.field_name]
              return (
                <div key={field.field_name}>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{field.display_label}</div>
                  <div className="text-sm font-medium text-gray-800">
                    {fmtFieldValue(rawValue, field.field_type)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* Auto-finance fields */
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {([
              ['Case Ref',  (caseData as Record<string, unknown>).case_ref,        'text'],
              ['Region',    (caseData as Record<string, unknown>).region,           'text'],
              ['FICO Band', (caseData as Record<string, unknown>).fico_band,        'text'],
              ['LTV',       (caseData as Record<string, unknown>).ltv_ratio,        'pct'],
              ['DTI',       (caseData as Record<string, unknown>).dti_ratio,        'pct'],
              ['Status',    (caseData as Record<string, unknown>).loan_status,      'text'],
            ] as [string, unknown, string][]).map(([label, value, fmt]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</div>
                <div className="text-sm font-medium text-gray-800">
                  {value == null ? '—' : fmt === 'pct' ? `${Math.round(Number(value))}%` : String(value)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Objective templates for real estate */}
      {isRealEstate && verticalConfig?.objective_templates && loanData?.case_type && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
            {loanData.case_type === 'listing' ? 'Listing' : 'Buyer'} Objectives
          </h2>
          <ul className="space-y-2">
            {(verticalConfig.objective_templates[loanData.case_type] ?? []).map((obj: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-blue-500 mt-0.5">◈</span>
                {obj}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sweep results (existing behavior — enterprise_objective_results) */}
      {objResults && objResults.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Latest Sweep Analysis</h2>
          <div className="space-y-4">
            {objResults.map((r, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">{new Date(r.computed_at).toLocaleDateString()}</span>
                  <span className="text-xs font-semibold text-blue-600">{Math.round((r.confidence_score ?? 0) * 100)}% confidence</span>
                </div>
                {r.affecting_it && <p className="text-sm text-gray-700 mb-1"><strong>Signal:</strong> {r.affecting_it}</p>}
                {r.implies && <p className="text-sm text-gray-700 mb-1"><strong>Implies:</strong> {r.implies}</p>}
                {r.what_to_do && <p className="text-sm text-gray-700"><strong>Action:</strong> {r.what_to_do}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
