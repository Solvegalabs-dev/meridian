import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getVerticalConfig } from '@/lib/vertical/getVerticalConfig'
import EnterpriseReportClient from './EnterpriseReportClient'

export const metadata = { title: 'Sweep Intelligence Report — Meridian Arc' }

export default async function EnterpriseReportPage({
  searchParams,
}: {
  searchParams?: { highlight?: string; iid?: string }
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

  let institutionName = 'Unknown Institution'
  if (institutionId) {
    const { data: inst } = await supabase
      .from('enterprise_institutions')
      .select('name')
      .eq('id', institutionId)
      .maybeSingle()
    institutionName = inst?.name ?? 'Unknown Institution'
  }

  const resolvedInstitutionId = institutionId ?? 'a1b2c3d4-0000-0000-0000-000000000001'

  const highlight = searchParams?.highlight ?? null
  const verticalConfig = await getVerticalConfig(resolvedInstitutionId)

  const { data: caseActionsRaw } = await supabase
    .from('enterprise_case_actions')
    .select('id, case_ref, objective_id, action_text, action_date, outcome, outcome_note, outcome_date, created_at')
    .eq('institution_id', resolvedInstitutionId)
    .order('action_date', { ascending: false })

  const caseActionsMap: Record<string, CaseAction[]> = {}
  for (const action of caseActionsRaw ?? []) {
    if (!caseActionsMap[action.case_ref]) caseActionsMap[action.case_ref] = []
    caseActionsMap[action.case_ref].push(action as CaseAction)
  }

  const { data: snapshotsRaw } = await supabase
    .from('case_signal_snapshots')
    .select('case_id, drift_score, drift_direction, confidence_pct')
    .eq('institution_id', resolvedInstitutionId)
    .order('sweep_timestamp', { ascending: false })

  const snapshotMap: Record<string, { drift_score: number; drift_direction: string; confidence_pct: number }> = {}
  for (const snap of snapshotsRaw ?? []) {
    if (!snapshotMap[snap.case_id as string]) {
      snapshotMap[snap.case_id as string] = {
        drift_score: (snap.drift_score as number) ?? 0,
        drift_direction: (snap.drift_direction as string) ?? 'STABLE',
        confidence_pct: (snap.confidence_pct as number) ?? 0,
      }
    }
  }

  return (
    <EnterpriseReportClient
      institutionId={resolvedInstitutionId}
      institutionName={institutionName}
      highlight={highlight}
      verticalConfig={verticalConfig}
      caseActionsMap={caseActionsMap}
      snapshotMap={snapshotMap}
    />
  )
}

export interface CaseAction {
  id: string
  case_ref: string
  objective_id: string | null
  action_type: string
  action_text: string
  action_date: string
  outcome: 'pending' | 'complete' | 'no_response' | 'abandoned'
  outcome_note: string | null
  outcome_date: string | null
  created_at: string
}
