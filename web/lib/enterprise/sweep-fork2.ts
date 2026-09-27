import { createServiceClient } from '@/lib/supabase/server'
import { getAnthropicClient } from '@/lib/anthropic/client'
import { getCaseRiskNarrative, getMacroContextForSnapshot } from './lookback'
import { OBJECTIVE_SWEEP_PROMPT } from './sweep-prompts'
import type { CohortPattern, TierChangeProjection } from './sweep-prompts'
import { sendWatchAlert } from '@/lib/email/sendWatchAlert'
import { sendSmsAlert } from '@/lib/watchlist/sendSmsAlert'

export type ObjectiveSweepResult = {
  resultId: string
  objectiveId: string
  objId: string
  sweepType: 'full' | 'lite'
  affectingIt: string
  implies: string
  signals: string
  whatToDo: string
  casesAnalyzed: number
  keySignals: string[]
  confidenceScore: number
  alertTriggered: boolean
  durationMs: number
}

type ObjectiveRow = {
  id: string
  obj_id: string
  title: string
  statement: string
  case_scope: string
  objective_state: string
  alert_threshold: Record<string, unknown>
  fusion_sources: string[]
}

type CaseRow = {
  id: string
  case_ref: string
  region: string
  fico_band: string
  loan_status: string
  ltv_ratio: number
  dti_ratio: number
  current_balance: number
}

type PortfolioMetricsRow = {
  portfolio_health_score: number | null
  high_risk_cohorts: CohortPattern[]
  projected_tier_changes: TierChangeProjection[]
  concentration_flags: unknown[]
}

// ── Case scope filtering ───────────────────────────────────────────────────

const DELINQUENT_STATUSES = new Set(['30dpd', '60dpd', '90dpd', 'default', 'charged_off'])

function filterCasesByScope(cases: CaseRow[], scope: string): CaseRow[] {
  switch (scope) {
    case 'delinquent_and_default':
      return cases.filter(c => DELINQUENT_STATUSES.has(c.loan_status))
    case 'boundary_analysis':
      // Cases near the approval boundary: FICO 660-699, currently performing
      return cases.filter(c =>
        (c.fico_band === '660-679' || c.fico_band === '680-699') &&
        c.loan_status === 'current'
      )
    case 'approved_not_closed':
    case 'all_active':
    case 'all':
    default:
      return cases
  }
}

// ── Claude call with optional retry ───────────────────────────────────────

type PosResult = {
  affecting_it: string
  implies: string
  signals: string
  what_to_do: string
  key_case_refs: string[]
  confidence_score: number
  finding_type: string
}

async function callClaude(prompt: string, attempt: number): Promise<PosResult | null> {
  try {
    const client = getAnthropicClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as PosResult
  } catch (err) {
    console.error(`[FF-035-B] Fork 2 Claude attempt ${attempt} error:`, err instanceof Error ? err.message : String(err))
    return null
  }
}

// ── Alert threshold evaluation ─────────────────────────────────────────────

function evaluateAlertThreshold(
  threshold: Record<string, unknown>,
  posResult: PosResult,
  cases: CaseRow[],
  portfolioMetrics: PortfolioMetricsRow
): { triggered: boolean; reason: string } {
  const metric = threshold.metric as string | undefined
  if (!metric) return { triggered: false, reason: '' }

  // E-01: new_account_in_delinquent_cohort — any delinquent case in the target cohort
  if (metric === 'new_account_in_delinquent_cohort') {
    const cohortRegion = (threshold.cohort as Record<string, string> | undefined)?.region
    const cohortFico = (threshold.cohort as Record<string, string> | undefined)?.fico_band
    const match = cases.find(c =>
      DELINQUENT_STATUSES.has(c.loan_status) &&
      (!cohortRegion || c.region === cohortRegion) &&
      (!cohortFico || c.fico_band === cohortFico)
    )
    if (match) {
      return { triggered: true, reason: `Delinquent account ${match.case_ref} found in ${cohortRegion ?? 'any'} / ${cohortFico ?? 'any FICO'} cohort` }
    }
  }

  // E-02: region_concentration_pct — concentration exceeds threshold
  if (metric === 'region_concentration_pct') {
    const targetRegion = threshold.dimension as string | undefined
    const thresholdPct = threshold.threshold as number | undefined
    const flags = portfolioMetrics.concentration_flags as Array<{ dimension: string; value: string; pct_of_balance: number }> | undefined
    const flag = flags?.find(f => f.dimension === 'region' && f.value === targetRegion)
    if (flag && thresholdPct && flag.pct_of_balance >= thresholdPct) {
      return { triggered: true, reason: `${targetRegion} region represents ${(flag.pct_of_balance * 100).toFixed(1)}% of outstanding balance (threshold: ${(thresholdPct * 100).toFixed(0)}%)` }
    }
  }

  // E-05: macro_condition_shift — any positive macro conditions projecting into scope
  if (metric === 'macro_condition_shift') {
    const projections = portfolioMetrics.projected_tier_changes ?? []
    if (projections.length > 0) {
      return { triggered: true, reason: `${projections.length} account(s) projected for tier deterioration — review decline criteria` }
    }
  }

  // Generic: confidence_score above threshold (catchall for other objectives)
  if (posResult.confidence_score >= 0.80 && (threshold.threshold_pp != null || threshold.threshold != null)) {
    return { triggered: false, reason: '' }
  }

  return { triggered: false, reason: '' }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function runObjectiveSweep(
  institutionId: string,
  objectiveId: string,
  portfolioMetricsId: string
): Promise<ObjectiveSweepResult> {
  const startMs = Date.now()
  const supabase = createServiceClient()

  // ── Step 1: Load objective + Fork 1 context ──
  const [{ data: objData }, { data: metricsData }, { data: allCasesData }, { data: institutionData }] = await Promise.all([
    supabase
      .from('enterprise_objectives')
      .select('id, obj_id, title, statement, case_scope, objective_state, alert_threshold, fusion_sources')
      .eq('id', objectiveId)
      .single(),
    supabase
      .from('enterprise_portfolio_metrics')
      .select('portfolio_health_score, high_risk_cohorts, projected_tier_changes, concentration_flags')
      .eq('id', portfolioMetricsId)
      .single(),
    supabase
      .from('enterprise_cases')
      .select('id, case_ref, region, fico_band, loan_status, ltv_ratio, dti_ratio, current_balance')
      .eq('institution_id', institutionId),
    supabase
      .from('enterprise_institutions')
      .select('name, alert_phone')
      .eq('id', institutionId)
      .single(),
  ])

  if (!objData) throw new Error(`Objective ${objectiveId} not found`)

  const objective = objData as ObjectiveRow
  const portfolioMetrics: PortfolioMetricsRow = metricsData ?? {
    portfolio_health_score: null,
    high_risk_cohorts: [],
    projected_tier_changes: [],
    concentration_flags: [],
  }
  const allCases: CaseRow[] = allCasesData ?? []

  // ── Step 2: Select cases in scope ──
  const scopedCases = filterCasesByScope(allCases, objective.case_scope)

  const scopeNote = objective.case_scope === 'approved_not_closed'
    ? '\n[NOTE: No lost-deal data in system yet — analysis is based on all approved cases as a proxy]'
    : ''

  // Build case narratives in parallel (max 10 concurrent to avoid rate limits)
  const narratives: string[] = []
  const NARRATIVE_BATCH = 5
  for (let i = 0; i < scopedCases.length; i += NARRATIVE_BATCH) {
    const batch = scopedCases.slice(i, i + NARRATIVE_BATCH)
    const batchNarratives = await Promise.all(
      batch.map(c => getCaseRiskNarrative(c.id, institutionId))
    )
    narratives.push(...batchNarratives)
  }

  if (scopeNote) narratives.push(scopeNote)

  // ── Step 3: Get macro context (last 90 days, auto_finance) ──
  const macroEvents = await getMacroContextForSnapshot(new Date().toISOString(), 90, 'auto_finance')

  // ── Step 4: Claude API call ──
  const highRiskCohorts: CohortPattern[] = (portfolioMetrics.high_risk_cohorts as CohortPattern[]) ?? []
  const projectedChanges: TierChangeProjection[] = (portfolioMetrics.projected_tier_changes as TierChangeProjection[]) ?? []

  const prompt = OBJECTIVE_SWEEP_PROMPT({
    objectiveStatement: objective.statement,
    objId: objective.obj_id,
    caseNarratives: narratives,
    highRiskCohorts,
    macroEvents,
    projectedChanges,
  })

  let posResult = await callClaude(prompt, 1)

  // Retry with simplified prompt if first attempt fails to parse
  if (!posResult) {
    const retryPrompt = `${prompt}\n\nCRITICAL: You must respond with ONLY a valid JSON object. No preamble, no markdown, no explanation. Start your response with { and end with }.`
    posResult = await callClaude(retryPrompt, 2)
  }

  // Fallback if both attempts fail
  if (!posResult) {
    posResult = {
      affecting_it: `[Sweep engine error — unable to generate analysis for ${objective.obj_id}. Data was loaded but Claude API response could not be parsed.]`,
      implies: '',
      signals: '',
      what_to_do: 'Re-run this objective sweep manually.',
      key_case_refs: [],
      confidence_score: 0,
      finding_type: 'known_unknown',
    }
    console.error(`[FF-035-B] Fork 2 ${objective.obj_id} (${objectiveId}): both Claude attempts failed, writing error result`)
  }

  // ── Step 5: Alert threshold evaluation ──
  const { triggered: alertTriggered, reason: alertReason } = evaluateAlertThreshold(
    objective.alert_threshold,
    posResult,
    scopedCases,
    portfolioMetrics
  )

  // ── Step 6: Write to Supabase ──
  const sweepType: 'full' | 'lite' = objective.objective_state === 'monitoring_lite' ? 'lite' : 'full'

  const { data: sweepRow, error: sweepErr } = await supabase
    .from('enterprise_sweeps')
    .insert({
      institution_id: institutionId,
      objective_id: objectiveId,
      trigger_type: 'manual',
      status: 'complete',
      fork: 'objective',
      sweep_type: sweepType,
      cases_in_scope: allCases.length,
      cases_swept: scopedCases.length,
      signals_used: macroEvents.length,
      patterns_matched: highRiskCohorts.length,
      engine_version: 'ff-035b-v1',
      started_at: new Date(startMs).toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (sweepErr || !sweepRow) {
    throw new Error(`Fork 2 sweep write failed for ${objective.obj_id}: ${sweepErr?.message}`)
  }
  const sweepId = sweepRow.id as string

  const { data: resultRow, error: resultErr } = await supabase
    .from('enterprise_objective_results')
    .insert({
      institution_id: institutionId,
      objective_id: objectiveId,
      sweep_id: sweepId,
      sweep_type: sweepType,
      affecting_it: posResult.affecting_it,
      implies: posResult.implies,
      signals: posResult.signals,
      what_to_do: posResult.what_to_do,
      cases_analyzed: scopedCases.length,
      key_case_refs: posResult.key_case_refs,
      confidence_score: posResult.confidence_score,
      portfolio_health_at_sweep: portfolioMetrics.portfolio_health_score,
      high_risk_cohorts_at_sweep: highRiskCohorts,
      projected_changes_at_sweep: projectedChanges,
      alert_triggered: alertTriggered,
      alert_reason: alertReason || null,
      escalated_to_focus: false,
      // Lite sweep compact fields for monitoring_lite objectives
      ...(sweepType === 'lite' ? {
        lite_metric_1_label: 'Cases analyzed',
        lite_metric_1_value: String(scopedCases.length),
        lite_metric_2_label: 'Confidence',
        lite_metric_2_value: `${Math.round(posResult.confidence_score * 100)}%`,
        lite_trend: posResult.confidence_score >= 0.6 ? 'stable' : 'deteriorating',
        lite_summary: posResult.affecting_it?.slice(0, 200) ?? '',
      } : {}),
    })
    .select('id')
    .single()

  if (resultErr || !resultRow) {
    throw new Error(`Fork 2 result write failed for ${objective.obj_id}: ${resultErr?.message}`)
  }
  const resultId = resultRow.id as string

  // Escalate monitoring_lite objective to focus if alert triggered
  if (alertTriggered && objective.objective_state === 'monitoring_lite') {
    const escalatedAt = new Date().toISOString()
    await supabase
      .from('enterprise_objectives')
      .update({ objective_state: 'focus', last_focus_sweep_at: escalatedAt, escalated_at: escalatedAt })
      .eq('id', objectiveId)

    await supabase
      .from('enterprise_objective_results')
      .update({ escalated_to_focus: true })
      .eq('id', resultId)

    // Best-effort internal ops alert — never blocks the sweep. SMS "to" is
    // per-institution (alert_phone) with an env fallback, per FF-035D.
    const institutionName = (institutionData as { name?: string } | null)?.name ?? 'Institution'
    const smsTo = (institutionData as { alert_phone?: string | null } | null)?.alert_phone
      || process.env.ADMIN_ALERT_PHONE
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://meridianarc.ai'}/enterprise`
    const objectiveTitle = `${institutionName} — ${objective.title}`
    const signalSummary = alertReason || `${objective.title} crossed its alert threshold.`
    const actionText = posResult.what_to_do || 'Review the escalated objective in the portal.'

    await Promise.allSettled([
      sendWatchAlert({
        to: process.env.ADMIN_ALERT_EMAIL || 'jason@solvega.ai',
        objectiveTitle,
        signalSummary,
        actionText,
        directUrl: portalUrl,
      }),
      ...(smsTo
        ? [sendSmsAlert({ to: smsTo, objectiveTitle, signalSummary, actionText, directUrl: portalUrl })]
        : []),
    ])
  }

  return {
    resultId,
    objectiveId,
    objId: objective.obj_id,
    sweepType,
    affectingIt: posResult.affecting_it,
    implies: posResult.implies,
    signals: posResult.signals,
    whatToDo: posResult.what_to_do,
    casesAnalyzed: scopedCases.length,
    keySignals: posResult.key_case_refs,
    confidenceScore: posResult.confidence_score,
    alertTriggered,
    durationMs: Date.now() - startMs,
  }
}
