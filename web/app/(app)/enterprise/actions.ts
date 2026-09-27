'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runPortfolioSweep } from '@/lib/enterprise/sweep-fork1'
import { runObjectiveSweep } from '@/lib/enterprise/sweep-fork2'
import { runREPortfolioSweep } from '@/lib/enterprise/sweep-fork1-re'
import type { REPortfolioSweepResult } from '@/lib/enterprise/sweep-fork1-re'
import { runREObjectiveSweep } from '@/lib/enterprise/sweep-fork2-re'
import { writeRECaseSnapshots } from '@/lib/enterprise/re-case-snapshots'
import type { ObjectiveState } from '@/lib/enterprise/objectives-queries'

export async function updateObjectiveState(
  objectiveId: string,
  newState: ObjectiveState
): Promise<{ ok: boolean; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('enterprise_objectives')
    .update({ objective_state: newState })
    .eq('id', objectiveId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function runEnterpriseSweep(
  institutionId: string
): Promise<{ ok: boolean; error?: string; objectivesSwept?: number }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()

  const { data: institution } = await supabase
    .from('enterprise_institutions')
    .select('id, industry')
    .eq('id', institutionId)
    .single()

  if (!institution) return { ok: false, error: 'Institution not found' }

  const isRE = (institution as { industry?: string | null }).industry === 'real_estate'

  let fork1Result
  try {
    fork1Result = isRE
      ? await runREPortfolioSweep(institutionId)
      : await runPortfolioSweep(institutionId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Portfolio sweep failed: ${msg}` }
  }

  const { data: objectives } = await supabase
    .from('enterprise_objectives')
    .select('id, obj_id')
    .eq('institution_id', institutionId)
    .eq('status', 'active')
    .eq('objective_state', 'focus')
    .order('objective_order')

  const settled = await Promise.allSettled(
    (objectives ?? []).map(obj =>
      isRE
        ? runREObjectiveSweep(institutionId, obj.id as string, fork1Result.metricsId)
        : runObjectiveSweep(institutionId, obj.id as string, fork1Result.metricsId)
    )
  )

  const swept = settled.filter(r => r.status === 'fulfilled').length
  const failed = settled.filter(r => r.status === 'rejected').length

  if (failed > 0) {
    console.error(`[FF-035-C] ${failed} objective sweep(s) failed`)
  }

  if (isRE) {
    const reFork1 = fork1Result as REPortfolioSweepResult
    const fulfilledRE = settled.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runREObjectiveSweep>>> =>
        r.status === 'fulfilled'
    )

    console.log('[FF-062-SHAPE] fulfilledResults[0]:', JSON.stringify(fulfilledRE[0]?.value))

    // Read caseObjectiveIds directly from DB — avoids any shape ambiguity in result objects
    const since = new Date(Date.now() - 300000).toISOString() // last 5 min
    const { data: latestResults } = await supabase
      .from('enterprise_objective_results')
      .select('objective_id, key_case_refs')
      .eq('institution_id', institutionId)
      .gte('computed_at', since)

    const caseObjectiveIds: Record<string, string[]> = {}
    for (const row of latestResults ?? []) {
      if (!row.objective_id || !row.key_case_refs) continue
      const refs = Array.isArray(row.key_case_refs)
        ? (row.key_case_refs as string[])
        : (JSON.parse(row.key_case_refs as string) as string[])
      for (const caseRef of refs) {
        if (!caseObjectiveIds[caseRef]) caseObjectiveIds[caseRef] = []
        if (!caseObjectiveIds[caseRef].includes(row.objective_id as string)) {
          caseObjectiveIds[caseRef].push(row.objective_id as string)
        }
      }
    }

    console.log('[FF-062] caseObjectiveIds built:', Object.keys(caseObjectiveIds).length, 'cases')
    console.log('[FF-062] sample:', JSON.stringify(Object.entries(caseObjectiveIds).slice(0, 2)))
    console.log('[FF-062] sweepId:', reFork1.portfolioSweepId, 'fulfilledRE:', fulfilledRE.length)
    const snapshotResult = await writeRECaseSnapshots(institutionId, reFork1.portfolioSweepId, caseObjectiveIds)
    console.log('[FF-062] snapshot result:', snapshotResult)
  }

  return { ok: true, objectivesSwept: swept }
}

export async function updateSignalPreferences(
  institutionId: string,
  preferences: Record<string, boolean>
): Promise<{ ok: boolean; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()

  // Read current config, merge signal_preferences key, write back
  const { data: inst } = await supabase
    .from('enterprise_institutions')
    .select('config')
    .eq('id', institutionId)
    .single()

  const currentConfig = (inst?.config as Record<string, unknown>) ?? {}
  const { error } = await supabase
    .from('enterprise_institutions')
    .update({ config: { ...currentConfig, signal_preferences: preferences } })
    .eq('id', institutionId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── FF-042 + FF-043: Progressive RE sweep + portfolio signal pass ──────────
import { planProgressiveSweepRE, executeProgressiveSweepRE } from '@/lib/enterprise/progressive-sweep-re'
import type { ProgressiveSweepREPlan, ProgressiveSweepREResult } from '@/lib/enterprise/progressive-sweep-re'
import { runPortfolioSignalPass } from '@/lib/enterprise/portfolio-signal-pass'
import type { PortfolioSignalPassResult } from '@/lib/enterprise/portfolio-signal-pass'

// FF-042 — plan only, no Anthropic calls
export async function getProgressiveSweepPlan(
  institutionId: string
): Promise<{ ok: boolean; plan?: ProgressiveSweepREPlan; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()
  const { data: institution } = await supabase
    .from('enterprise_institutions')
    .select('id, industry')
    .eq('id', institutionId)
    .single()

  if (!institution) return { ok: false, error: 'Institution not found' }
  if ((institution as { industry?: string | null }).industry !== 'real_estate') {
    return { ok: false, error: 'getProgressiveSweepPlan is only available for real_estate institutions' }
  }

  try {
    const plan = await planProgressiveSweepRE(institutionId)
    return { ok: true, plan }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// FF-042 — execute (calls Anthropic only for triggered objectives)
export async function runProgressiveEnterpriseSweep(
  institutionId: string
): Promise<{ ok: boolean; result?: ProgressiveSweepREResult; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()
  const { data: institution } = await supabase
    .from('enterprise_institutions')
    .select('id, industry')
    .eq('id', institutionId)
    .single()

  if (!institution) return { ok: false, error: 'Institution not found' }
  if ((institution as { industry?: string | null }).industry !== 'real_estate') {
    return { ok: false, error: 'runProgressiveEnterpriseSweep is only available for real_estate institutions' }
  }

  try {
    const result = await executeProgressiveSweepRE(institutionId)
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// FF-043 — signal pass (any institution)
export async function runEnterpriseSignalPass(
  institutionId: string
): Promise<{ ok: boolean; result?: PortfolioSignalPassResult; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  try {
    const result = await runPortfolioSignalPass(institutionId)
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// ── FF-061E: Case action tracker ──────────────────────────────────────────
export async function logCaseAction(
  institutionId: string,
  caseRef: string,
  actionText: string,
  actionDate: string,
  objectiveId: string | null,
  actionType: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('enterprise_case_actions')
    .insert({
      institution_id: institutionId,
      case_ref: caseRef,
      action_text: actionText,
      action_date: actionDate,
      objective_id: objectiveId || null,
      action_type: actionType,
      outcome: 'pending',
      created_by: 'broker',
    })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateCaseActionOutcome(
  actionId: string,
  outcome: 'pending' | 'complete' | 'no_response' | 'abandoned',
  outcomeNote: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('enterprise_case_actions')
    .update({
      outcome,
      outcome_note: outcomeNote,
      outcome_date: outcome !== 'pending' ? new Date().toISOString().split('T')[0] : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── FF-061A: Case alias ────────────────────────────────────────────────────
export async function updateCaseAlias(
  institutionId: string,
  caseRef: string,
  alias: string
): Promise<{ ok: boolean; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('enterprise_cases')
    .update({ case_alias: alias.trim() || null })
    .eq('institution_id', institutionId)
    .eq('case_ref', caseRef)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── FF-061E: Close case ───────────────────────────────────────────────────
export async function closeCaseAction(
  caseRef: string,
  institutionId: string,
  closeOutcome: 'sold' | 'off_market' | 'relist' | 'other',
  closeNote: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('enterprise_cases')
    .update({
      closed_at: new Date().toISOString(),
      close_outcome: closeOutcome,
      close_note: closeNote,
      in_scope: false,
    })
    .eq('case_ref', caseRef)
    .eq('institution_id', institutionId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── FF-051: Per-case user feedback / confidence adjustment ─────────────────
export async function updateCaseFeedback(
  institutionId: string,
  caseId: string,
  feedback: {
    user_confidence?: number | null
    user_trend_override?: 'improving' | 'declining' | 'stable' | null
    user_action?: string | null
    user_status?: 'working_it' | 'escalated' | 'resolved' | 'monitoring' | null
  }
): Promise<{ ok: boolean; error?: string }> {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('enterprise_case_feedback')
    .upsert(
      {
        institution_id: institutionId,
        case_id: caseId,
        user_id: user.id,
        ...feedback,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'institution_id,case_id,user_id' }
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
