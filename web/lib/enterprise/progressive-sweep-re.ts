/**
 * FF-042 — Progressive Sweep (Real Estate vertical)
 *
 * RE-specific trigger thresholds: DOM ≥ 30 (not 45) and rate lock < 30 days
 * (not yet expired). Operates at the OBJECTIVE level — decides which objectives
 * have triggered cases in scope, sweeps only those, and propagates carry-forward
 * snapshots for objectives that have no triggered cases this cycle.
 *
 * No Anthropic calls in planProgressiveSweepRE — safe to use in dry-run checks.
 * executeProgressiveSweepRE calls runREObjectiveSweep (which calls Claude) only
 * for triggered objectives.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { runREObjectiveSweep } from './sweep-fork2-re'
import type { ObjectiveSweepResult } from './sweep-fork2'

// FF-042 trigger thresholds (more aggressive than Fork2-RE production values)
const TRIGGER_DOM_DAYS = 30
const TRIGGER_RATE_LOCK_DAYS = 30

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProgressiveSweepREPlan = {
  institutionId: string
  triggeredListings: number
  triggeredBuyers: number
  totalTriggered: number
  objectivesToSweep: Array<{
    id: string
    obj_id: string
    title: string
    case_scope: string
    trigger_reason: string
  }>
  objectivesToSkip: Array<{
    id: string
    obj_id: string
    title: string
    case_scope: string
  }>
  plannedAt: string
}

export type ProgressiveSweepREResult = {
  plan: ProgressiveSweepREPlan
  swept: ObjectiveSweepResult[]
  skipped: number
  propagated: number
  errors: string[]
  durationMs: number
}

// ── Trigger helpers ───────────────────────────────────────────────────────────

function inferCaseType(ld: Record<string, unknown>): 'listing' | 'buyer' | null {
  const explicit = ld.case_type as string | undefined
  if (explicit === 'listing') return 'listing'
  if (explicit === 'buyer') return 'buyer'
  if (ld.days_on_market !== undefined || ld.list_price !== undefined) return 'listing'
  if (ld.rate_lock_expires !== undefined) return 'buyer'
  return null
}

function isTriggeredListing(ld: Record<string, unknown>): boolean {
  if (inferCaseType(ld) !== 'listing') return false
  const domRaw = ld.days_on_market
  const dom =
    typeof domRaw === 'number' ? domRaw
    : typeof domRaw === 'string' ? Number(domRaw)
    : undefined
  return dom !== undefined && !isNaN(dom) && dom >= TRIGGER_DOM_DAYS
}

function isTriggeredBuyer(ld: Record<string, unknown>, today: Date): boolean {
  if (inferCaseType(ld) !== 'buyer') return false
  const rateLock = ld.rate_lock_expires as string | undefined
  if (!rateLock) return false
  const expiry = new Date(rateLock)
  expiry.setHours(0, 0, 0, 0)
  const daysUntil = Math.round((expiry.getTime() - today.getTime()) / 86400000)
  // Trigger if expired OR within TRIGGER_RATE_LOCK_DAYS of expiry
  return daysUntil < TRIGGER_RATE_LOCK_DAYS
}

// Does this objective's case_scope include triggered cases of the given types?
function objectiveIsTriggerred(
  caseScope: string,
  hasTriggeredListings: boolean,
  hasTriggeredBuyers: boolean
): { triggered: boolean; reason: string } {
  switch (caseScope) {
    case 'stale_listings':
      if (hasTriggeredListings) return { triggered: true, reason: `listings DOM ≥ ${TRIGGER_DOM_DAYS}d` }
      break
    case 'rate_lock_at_risk':
      if (hasTriggeredBuyers) return { triggered: true, reason: `rate lock < ${TRIGGER_RATE_LOCK_DAYS}d` }
      break
    case 'listings_only':
      if (hasTriggeredListings) return { triggered: true, reason: `listings DOM ≥ ${TRIGGER_DOM_DAYS}d` }
      break
    case 'buyers_only':
      if (hasTriggeredBuyers) return { triggered: true, reason: `rate lock < ${TRIGGER_RATE_LOCK_DAYS}d` }
      break
    case 'all_active':
    case 'all':
      if (hasTriggeredListings && hasTriggeredBuyers)
        return { triggered: true, reason: `listings DOM ≥ ${TRIGGER_DOM_DAYS}d + rate lock < ${TRIGGER_RATE_LOCK_DAYS}d` }
      if (hasTriggeredListings) return { triggered: true, reason: `listings DOM ≥ ${TRIGGER_DOM_DAYS}d` }
      if (hasTriggeredBuyers) return { triggered: true, reason: `rate lock < ${TRIGGER_RATE_LOCK_DAYS}d` }
      break
  }
  return { triggered: false, reason: '' }
}

// ── Plan — no Anthropic calls ─────────────────────────────────────────────────

export async function planProgressiveSweepRE(
  institutionId: string
): Promise<ProgressiveSweepREPlan> {
  const supabase = createServiceClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Load cases + active objectives in parallel
  const [{ data: casesData }, { data: objectivesData }] = await Promise.all([
    supabase
      .from('enterprise_cases')
      .select('id, loan_data')
      .eq('institution_id', institutionId)
      .eq('in_scope', true),
    supabase
      .from('enterprise_objectives')
      .select('id, obj_id, title, case_scope, objective_state')
      .eq('institution_id', institutionId)
      .eq('status', 'active')
      .in('objective_state', ['focus', 'monitoring_lite'])
      .order('objective_order'),
  ])

  // Classify triggered cases
  let triggeredListings = 0
  let triggeredBuyers = 0

  for (const c of casesData ?? []) {
    const ld = (c.loan_data ?? {}) as Record<string, unknown>
    if (isTriggeredListing(ld)) triggeredListings++
    else if (isTriggeredBuyer(ld, today)) triggeredBuyers++
  }

  const hasTriggeredListings = triggeredListings > 0
  const hasTriggeredBuyers = triggeredBuyers > 0

  // Partition objectives
  const objectivesToSweep: ProgressiveSweepREPlan['objectivesToSweep'] = []
  const objectivesToSkip: ProgressiveSweepREPlan['objectivesToSkip'] = []

  for (const obj of objectivesData ?? []) {
    const scope = (obj.case_scope as string) ?? 'all'
    const { triggered, reason } = objectiveIsTriggerred(scope, hasTriggeredListings, hasTriggeredBuyers)
    if (triggered) {
      objectivesToSweep.push({
        id: obj.id as string,
        obj_id: obj.obj_id as string,
        title: obj.title as string,
        case_scope: scope,
        trigger_reason: reason,
      })
    } else {
      objectivesToSkip.push({
        id: obj.id as string,
        obj_id: obj.obj_id as string,
        title: obj.title as string,
        case_scope: scope,
      })
    }
  }

  return {
    institutionId,
    triggeredListings,
    triggeredBuyers,
    totalTriggered: triggeredListings + triggeredBuyers,
    objectivesToSweep,
    objectivesToSkip,
    plannedAt: new Date().toISOString(),
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeProgressiveSweepRE(
  institutionId: string
): Promise<ProgressiveSweepREResult> {
  const startMs = Date.now()
  const supabase = createServiceClient()

  const plan = await planProgressiveSweepRE(institutionId)

  // Sweep triggered objectives concurrently
  // metricsId is not consumed in this path — pass empty string, runREObjectiveSweep
  // uses void portfolioMetricsId internally (interface parity retained for fork2-re)
  const sweepSettled = await Promise.allSettled(
    plan.objectivesToSweep.map(obj =>
      runREObjectiveSweep(institutionId, obj.id, '')
    )
  )

  const swept: ObjectiveSweepResult[] = []
  const errors: string[] = []

  for (let i = 0; i < sweepSettled.length; i++) {
    const result = sweepSettled[i]
    const obj = plan.objectivesToSweep[i]
    if (result.status === 'fulfilled') {
      swept.push(result.value)
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors.push(`${obj.obj_id}: ${msg}`)
      console.error(`[progressive-sweep-re] ${obj.obj_id} (${obj.id}) failed:`, msg)
    }
  }

  // Carry-forward propagated snapshot for skipped objectives' cases
  let propagated = 0

  if (plan.objectivesToSkip.length > 0) {
    // Build a brief note summarising why this cycle was skipped
    const skipNote =
      `[FF-042 carry-forward] No RE triggers this cycle ` +
      `(DOM ≥ ${TRIGGER_DOM_DAYS} listings: ${plan.triggeredListings}, ` +
      `rate lock < ${TRIGGER_RATE_LOCK_DAYS}d buyers: ${plan.triggeredBuyers}). ` +
      `Signals carried from last sweep.`

    // Gather all in-scope case IDs; carry-forward applies to the full portfolio
    // since we cannot cheaply re-run filterRECasesByScope per objective here
    const { data: allInScopeCases } = await supabase
      .from('enterprise_cases')
      .select('id')
      .eq('institution_id', institutionId)
      .eq('in_scope', true)

    // For each skipped case, copy drift state from last history entry and write propagated snapshot
    const skippedCaseIds = (allInScopeCases ?? []).map(c => c.id as string)
    const { data: caseRefs } = await supabase
      .from('enterprise_cases')
      .select('id, case_ref')
      .in('id', skippedCaseIds)

    const caseRefMap = new Map((caseRefs ?? []).map(r => [r.id as string, r.case_ref as string]))

    for (const caseId of skippedCaseIds) {
      const { data: lastSnap } = await supabase
        .from('enterprise_case_history')
        .select('drift_score, drift_tier, confidence_pct')
        .eq('case_id', caseId)
        .order('snapshot_at', { ascending: false })
        .limit(1)
        .single()

      const { error } = await supabase
        .from('enterprise_case_history')
        .insert({
          case_id: caseId,
          institution_id: institutionId,
          case_ref: caseRefMap.get(caseId) ?? '',
          snapshot_type: 'propagated',
          snapshot_at: new Date().toISOString(),
          drift_score: lastSnap?.drift_score ?? 50,
          drift_tier: lastSnap?.drift_tier ?? 'STABLE',
          confidence_pct: lastSnap?.confidence_pct ?? 50,
          macro_event_ids: [],
          notes: skipNote,
          prior_status: lastSnap?.drift_tier ?? 'STABLE',
        })

      if (!error) propagated++
    }
  }

  return {
    plan,
    swept,
    skipped: plan.objectivesToSkip.length,
    propagated,
    errors,
    durationMs: Date.now() - startMs,
  }
}
