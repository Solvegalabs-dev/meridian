import { createServiceClient } from '@/lib/supabase/server'
import { getAnthropicClient } from '@/lib/anthropic/client'
import { getMacroContextForSnapshot } from './lookback'
import { sendWatchAlert } from '@/lib/email/sendWatchAlert'
import { sendSmsAlert } from '@/lib/watchlist/sendSmsAlert'
import type { ObjectiveSweepResult } from './sweep-fork2'

type REObjectiveRow = {
  id: string
  obj_id: string
  title: string
  statement: string
  case_scope: string
  objective_state: string
  alert_threshold: Record<string, unknown>
  fusion_sources: string[]
}

type RECaseRow = {
  id: string
  case_ref: string
  loan_data: Record<string, unknown>
}

// ── Case type inference (mirrors objectives-queries.ts) ───────────────────────

function inferCaseType(ld: Record<string, unknown>): 'listing' | 'buyer' | null {
  const explicit = ld.case_type as string | undefined
  if (explicit === 'listing') return 'listing'
  if (explicit === 'buyer') return 'buyer'
  if (ld.days_on_market !== undefined || ld.list_price !== undefined) return 'listing'
  if (ld.rate_lock_expires !== undefined) return 'buyer'
  return null
}

// ── RE Case scope filtering ───────────────────────────────────────────────────

function filterRECasesByScope(cases: RECaseRow[], scope: string, today: Date): RECaseRow[] {
  return cases.filter(c => {
    const ld = c.loan_data
    const caseType = inferCaseType(ld)

    switch (scope) {
      case 'stale_listings': {
        if (caseType !== 'listing') return false
        const domRaw = ld.days_on_market
        const dom =
          typeof domRaw === 'number' ? domRaw
          : typeof domRaw === 'string' ? Number(domRaw)
          : undefined
        return dom !== undefined && !isNaN(dom) && dom >= 45
      }
      case 'rate_lock_at_risk': {
        if (caseType !== 'buyer') return false
        const rateLock = ld.rate_lock_expires as string | undefined
        if (!rateLock) return false
        const expiry = new Date(rateLock)
        expiry.setHours(0, 0, 0, 0)
        const daysUntil = Math.round((expiry.getTime() - today.getTime()) / 86400000)
        return daysUntil < 30
      }
      case 'listings_only':
        return caseType === 'listing'
      case 'buyers_only':
        return caseType === 'buyer'
      case 'all_active':
      case 'all':
      default:
        return true
    }
  })
}

// ── RE Case narrative builder ─────────────────────────────────────────────────

function buildRECaseNarrative(c: RECaseRow, today: Date): string {
  const ld = c.loan_data
  const caseType = inferCaseType(ld)

  if (caseType === 'listing') {
    const dom = ld.days_on_market
    const price = ld.list_price
    const band = (ld.price_band as string | undefined) ?? 'unknown'
    const area = (ld.neighborhood as string | undefined)
      ?? (ld.region as string | undefined)
      ?? 'unknown area'
    return `[${c.case_ref}] LISTING | DOM: ${dom ?? 'N/A'} days | List price: $${price ?? 'N/A'} | Band: ${band} | Area: ${area}`
  }

  if (caseType === 'buyer') {
    const rateLock = ld.rate_lock_expires as string | undefined
    let daysUntilExpiry: string = 'N/A'
    if (rateLock) {
      const expiry = new Date(rateLock)
      expiry.setHours(0, 0, 0, 0)
      const d = Math.round((expiry.getTime() - today.getTime()) / 86400000)
      daysUntilExpiry = d < 0 ? `EXPIRED ${Math.abs(d)}d ago` : `${d}d remaining`
    }
    const budget = (ld.max_budget as number | undefined) ?? (ld.budget as number | undefined)
    return `[${c.case_ref}] BUYER | Rate lock expires: ${rateLock ?? 'N/A'} (${daysUntilExpiry}) | Budget: ${budget ? `$${budget.toLocaleString()}` : 'N/A'}`
  }

  return `[${c.case_ref}] UNKNOWN TYPE | loan_data keys: ${Object.keys(ld).join(', ')}`
}

// ── RE Alert threshold evaluation ─────────────────────────────────────────────

function evaluateREAlertThreshold(
  threshold: Record<string, unknown>,
  allCases: RECaseRow[],
  today: Date
): { triggered: boolean; reason: string } {
  const metric = threshold.metric as string | undefined
  if (!metric) return { triggered: false, reason: '' }

  if (metric === 'dom_over_45_count') {
    const minCount = (threshold.threshold as number | undefined) ?? 1
    const staleCount = allCases.filter(c => {
      if (inferCaseType(c.loan_data) !== 'listing') return false
      const domRaw = c.loan_data.days_on_market
      const dom =
        typeof domRaw === 'number' ? domRaw
        : typeof domRaw === 'string' ? Number(domRaw)
        : undefined
      return dom !== undefined && !isNaN(dom) && dom >= 45
    }).length
    if (staleCount >= minCount) {
      return {
        triggered: true,
        reason: `${staleCount} listing(s) exceed 45 days on market (threshold: ${minCount})`,
      }
    }
  }

  if (metric === 'rate_lock_expired_count') {
    const minCount = (threshold.threshold as number | undefined) ?? 1
    const expiredCount = allCases.filter(c => {
      if (inferCaseType(c.loan_data) !== 'buyer') return false
      const rateLock = c.loan_data.rate_lock_expires as string | undefined
      if (!rateLock) return false
      const expiry = new Date(rateLock)
      expiry.setHours(0, 0, 0, 0)
      return expiry.getTime() < today.getTime()
    }).length
    if (expiredCount >= minCount) {
      return {
        triggered: true,
        reason: `${expiredCount} buyer(s) have expired rate locks (threshold: ${minCount})`,
      }
    }
  }

  if (metric === 'buyer_pipeline_days') {
    // Future: compute avg days from case creation → close; needs origination_date
    return { triggered: false, reason: '' }
  }

  return { triggered: false, reason: '' }
}

// ── Claude call with retry ────────────────────────────────────────────────────

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
    console.error(`[RE-SWEEP-F2] Claude attempt ${attempt} error:`, err instanceof Error ? err.message : String(err))
    return null
  }
}

// ── RE Objective Sweep Prompt ─────────────────────────────────────────────────

const RE_OBJECTIVE_SWEEP_PROMPT = (data: {
  objectiveStatement: string
  objId: string
  caseNarratives: string[]
  macroEvents: string[]
  brokerActionsBlock: string
}): string => `You are a real estate portfolio intelligence analyst for Meridian Fusion.
Answer the following business intelligence question using only the provided data.

BUSINESS QUESTION (${data.objId}):
${data.objectiveStatement}

CASE DATA (${data.caseNarratives.length} cases in scope):
${data.caseNarratives.join('\n')}

CURRENT MACRO CONDITIONS (last 90 days, real_estate):
${data.macroEvents.length > 0
  ? data.macroEvents.join('\n')
  : '- No macro events in last 90 days for real estate'}${data.brokerActionsBlock}

Return ONLY valid JSON with no preamble or markdown:
{
  "affecting_it": "What specific data patterns are driving the answer to this question",
  "implies": "What this means for the brokerage — operational and client impact",
  "signals": "Specific signals: case refs, DOM counts, rate lock windows, price points",
  "what_to_do": "Specific recommended actions for the broker — not generic advice",
  "key_case_refs": ["case_ref_1", "case_ref_2"],
  "confidence_score": 0.85,
  "finding_type": "known_unknown"
}

INFERENCE RULES (follow strictly):
R-1: Every claim in affecting_it must reference at least one specific case_ref or metric from the input
R-2: Do not assert causation — use "correlates with", "coincides with", "is associated with"
R-3: If data is insufficient to answer, say so in affecting_it and set confidence_score below 0.4
R-4: signals must cite specific case_refs, not just aggregate statistics
R-5: what_to_do must be actionable by a non-data person — name the listing or buyer where possible
R-6: Never fabricate data not present in the input
R-7: finding_type: known_unknown = confirmed what was suspected; unknown_unknown = surfaced something new; crystal_ball = forward projection`

// ── Main export ───────────────────────────────────────────────────────────────

export async function runREObjectiveSweep(
  institutionId: string,
  objectiveId: string,
  portfolioMetricsId: string   // reserved for future RE cohort context; not used in v1
): Promise<ObjectiveSweepResult> {
  void portfolioMetricsId   // not consumed in v1; retained for interface parity with AF fork
  const startMs = Date.now()
  const supabase = createServiceClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // ── Step 1: Load objective + all cases + institution ──
  const [{ data: objData }, { data: allCasesData }, { data: institutionData }] = await Promise.all([
    supabase
      .from('enterprise_objectives')
      .select('id, obj_id, title, statement, case_scope, objective_state, alert_threshold, fusion_sources')
      .eq('id', objectiveId)
      .single(),
    supabase
      .from('enterprise_cases')
      .select('id, case_ref, loan_data')
      .eq('institution_id', institutionId),
    supabase
      .from('enterprise_institutions')
      .select('name, alert_phone')
      .eq('id', institutionId)
      .single(),
  ])

  if (!objData) throw new Error(`Objective ${objectiveId} not found`)
  const objective = objData as REObjectiveRow

  const allCases: RECaseRow[] = (allCasesData ?? []).map(c => ({
    id: c.id as string,
    case_ref: (c.case_ref as string) ?? c.id,
    loan_data: ((c.loan_data ?? {}) as Record<string, unknown>),
  }))

  // ── Step 2: Filter cases by scope ──
  const scopedCases = filterRECasesByScope(allCases, objective.case_scope, today)

  // ── Step 3: Build case narratives ──
  const narratives = scopedCases.map(c => buildRECaseNarrative(c, today))

  // ── Step 4: Macro context (real_estate) ──
  const macroEvents = await getMacroContextForSnapshot(new Date().toISOString(), 90, 'real_estate')
  const macroStrings = macroEvents.slice(0, 5).map(e =>
    `- [Magnitude ${e.magnitude}/${e.direction}] ${e.event_name} (${e.event_date})`
  )

  // ── Step 4b: Broker actions context (FF-061E) ──
  const scopedRefs = scopedCases.map(c => c.case_ref)
  const { data: recentActions } = await supabase
    .from('enterprise_case_actions')
    .select('case_ref, action_type, action_text, action_date, outcome, outcome_note')
    .eq('institution_id', institutionId)
    .in('case_ref', scopedRefs.length > 0 ? scopedRefs : ['__none__'])
    .order('action_date', { ascending: false })
    .limit(20)

  const brokerActionsBlock = recentActions?.length
    ? `\n\n[BROKER ACTIONS — logged since last sweep]\n${recentActions.map(a =>
        `${a.action_date} [${a.case_ref}] [${a.action_type}]: ${a.action_text} — ${a.outcome}${a.outcome_note ? ` (${a.outcome_note})` : ''}`
      ).join('\n')}`
    : ''

  // ── Step 5: Claude API call ──
  const prompt = RE_OBJECTIVE_SWEEP_PROMPT({
    objectiveStatement: objective.statement,
    objId: objective.obj_id,
    caseNarratives: narratives,
    macroEvents: macroStrings,
    brokerActionsBlock,
  })

  let posResult = await callClaude(prompt, 1)
  if (!posResult) {
    const retryPrompt = `${prompt}\n\nCRITICAL: Respond with ONLY valid JSON. Start with { and end with }.`
    posResult = await callClaude(retryPrompt, 2)
  }
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
    console.error(`[RE-SWEEP-F2] ${objective.obj_id} (${objectiveId}): both Claude attempts failed, writing error result`)
  }

  // ── Step 6: Alert threshold evaluation (on all cases, not just scoped) ──
  const { triggered: alertTriggered, reason: alertReason } = evaluateREAlertThreshold(
    objective.alert_threshold,
    allCases,
    today
  )

  // ── Step 7: Write enterprise_sweeps ──
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
      patterns_matched: 0,
      engine_version: 're-sweep-v1',
      started_at: new Date(startMs).toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (sweepErr || !sweepRow) {
    throw new Error(`RE Fork 2 sweep write failed for ${objective.obj_id}: ${sweepErr?.message}`)
  }
  const sweepId = sweepRow.id as string

  // ── Step 8: Write enterprise_objective_results ──
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
      portfolio_health_at_sweep: null,
      high_risk_cohorts_at_sweep: [],
      projected_changes_at_sweep: [],
      alert_triggered: alertTriggered,
      alert_reason: alertReason || null,
      escalated_to_focus: false,
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
    throw new Error(`RE Fork 2 result write failed for ${objective.obj_id}: ${resultErr?.message}`)
  }
  const resultId = resultRow.id as string

  // ── Step 9: Escalate monitoring_lite → focus if alert triggered ──
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

    const institutionName = (institutionData as { name?: string } | null)?.name ?? 'Institution'
    const smsTo =
      (institutionData as { alert_phone?: string | null } | null)?.alert_phone
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
