/**
 * FF-041 Phase 2 — Progressive Sweep Orchestrator
 *
 * The main Phase 2 engine. Orchestrates trigger identification,
 * cohort grouping, minimal sweep set calculation, signal propagation,
 * and propagated confidence updates.
 *
 * This does NOT replace the existing enterprise sweep execution
 * (FF-035 Two-Fork engine). It wraps it — deciding WHICH cases
 * to sweep and applying signals to cases that don't need a full sweep.
 */

import { createServiceClient } from '@/lib/supabase/server'

// TRIGGER TYPES — what causes a case to need attention
export type TriggerType =
  | 'payment_event'        // new payment, missed payment, DPD increase
  | 'macro_signal_match'   // a macro event matches this case's cohort
  | 'scheduled_review'     // periodic risk review (monthly/quarterly)
  | 'manual'               // explicitly triggered by an admin

export interface TriggerCaseResult {
  case_id: string
  case_ref: string
  trigger_types: TriggerType[]
  cohort_ids: string[]         // which cohorts this case belongs to
  priority_score: number       // higher = sweep first
}

// When a signal is propagated (not directly swept), apply this penalty
// to reflect that the case was inferred, not individually verified.
const PROPAGATION_CONFIDENCE_PENALTY = 4  // points

/**
 * Step 1 — Identify triggered cases for an institution.
 * Returns cases that need attention, with their trigger types
 * and cohort memberships.
 */
export async function identifyTriggeredCases(
  institutionId: string,
  options: {
    includeScheduled?: boolean   // include periodic review cases
    lookbackHours?: number       // how far back to look for payment events
    maxCases?: number            // cap trigger pool size
  } = {}
): Promise<TriggerCaseResult[]> {
  const supabase = createServiceClient()
  const lookbackHours = options.lookbackHours ?? 24
  const maxCases = options.maxCases ?? 500

  // Get cases with payment events (status change in lookback window)
  const { data: paymentCases } = await supabase
    .from('enterprise_cases')
    .select(`
      id, case_ref,
      enterprise_case_cohort_membership!inner(cohort_id)
    `)
    .eq('institution_id', institutionId)
    .eq('in_scope', true)
    .gt('updated_at', new Date(Date.now() - lookbackHours * 3600000).toISOString())
    .limit(maxCases)

  // Get cases matching active macro events from the last 7 days
  const { data: recentMacroEvents } = await supabase
    .from('enterprise_macro_events')
    .select('id, event_category, affected_regions, relevant_industries')
    .gte('event_date', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
    .order('event_date', { ascending: false })
    .limit(20)

  // Build trigger map
  const triggerMap = new Map<string, TriggerCaseResult>()

  // Add payment event cases
  for (const c of paymentCases ?? []) {
    const cohort_ids = (c.enterprise_case_cohort_membership as Array<{ cohort_id: string }>)
      .map(m => m.cohort_id)
    triggerMap.set(c.id, {
      case_id: c.id,
      case_ref: c.case_ref,
      trigger_types: ['payment_event'],
      cohort_ids,
      priority_score: 80,
    })
  }

  // Add macro signal matches — cases whose region matches recent events
  if (recentMacroEvents?.length) {
    const affectedRegions = new Set(recentMacroEvents.flatMap(e => e.affected_regions ?? []))

    if (affectedRegions.size > 0) {
      const { data: macroCases } = await supabase
        .from('enterprise_cases')
        .select(`
          id, case_ref,
          enterprise_case_cohort_membership!inner(cohort_id)
        `)
        .eq('institution_id', institutionId)
        .eq('in_scope', true)
        .in('region', Array.from(affectedRegions))
        .limit(maxCases)

      for (const c of macroCases ?? []) {
        const cohort_ids = (c.enterprise_case_cohort_membership as Array<{ cohort_id: string }>)
          .map(m => m.cohort_id)
        if (triggerMap.has(c.id)) {
          triggerMap.get(c.id)!.trigger_types.push('macro_signal_match')
          triggerMap.get(c.id)!.priority_score += 20
        } else {
          triggerMap.set(c.id, {
            case_id: c.id,
            case_ref: c.case_ref,
            trigger_types: ['macro_signal_match'],
            cohort_ids,
            priority_score: 60,
          })
        }
      }
    }
  }

  // Add scheduled review cases if requested
  if (options.includeScheduled) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: staleCases } = await supabase
      .from('enterprise_cases')
      .select(`
        id, case_ref,
        enterprise_case_cohort_membership!inner(cohort_id)
      `)
      .eq('institution_id', institutionId)
      .eq('in_scope', true)
      .or(`updated_at.lt.${thirtyDaysAgo},updated_at.is.null`)
      .limit(maxCases)

    for (const c of staleCases ?? []) {
      const cohort_ids = (c.enterprise_case_cohort_membership as Array<{ cohort_id: string }>)
        .map(m => m.cohort_id)
      if (!triggerMap.has(c.id)) {
        triggerMap.set(c.id, {
          case_id: c.id,
          case_ref: c.case_ref,
          trigger_types: ['scheduled_review'],
          cohort_ids,
          priority_score: 30,
        })
      }
    }
  }

  // Sort by priority score descending
  return Array.from(triggerMap.values())
    .sort((a, b) => b.priority_score - a.priority_score)
}

/**
 * Step 2 — Calculate the minimal set of cases to sweep.
 * Groups triggered cases by cohort. For each cohort, only ONE case
 * needs to be swept — signals propagate to the rest.
 *
 * Returns:
 * - caseIdsToSweep: the minimal set that covers all cohorts
 * - propagationMap: map from swept case_id → case_ids that receive propagated signals
 */
export function calculateMinimalSweepSet(
  triggeredCases: TriggerCaseResult[]
): {
  caseIdsToSweep: string[]
  propagationMap: Map<string, string[]>
} {
  const coveredCohorts = new Set<string>()
  const caseIdsToSweep: string[] = []
  const propagationMap = new Map<string, string[]>()
  const remainingCases = [...triggeredCases]

  // Greedy set cover: pick cases that cover the most uncovered cohorts first
  while (remainingCases.length > 0) {
    let bestCase = remainingCases[0]
    let bestNewCoverage = 0

    for (const c of remainingCases) {
      const newCoverage = c.cohort_ids.filter(id => !coveredCohorts.has(id)).length
      if (newCoverage > bestNewCoverage || (newCoverage === bestNewCoverage && c.priority_score > bestCase.priority_score)) {
        bestCase = c
        bestNewCoverage = newCoverage
      }
    }

    // If best case adds no new cohort coverage, all remaining cases
    // can receive propagated signals from already-swept cases
    if (bestNewCoverage === 0) break

    caseIdsToSweep.push(bestCase.case_id)
    propagationMap.set(bestCase.case_id, [])

    for (const cohortId of bestCase.cohort_ids) {
      coveredCohorts.add(cohortId)
    }

    const idx = remainingCases.indexOf(bestCase)
    remainingCases.splice(idx, 1)
  }

  // Build propagation targets for each swept case
  for (const unswept of remainingCases) {
    let bestSource: string | null = null
    let maxSharedCohorts = 0

    for (const sweptId of Array.from(propagationMap.keys())) {
      const sweptCase = triggeredCases.find(c => c.case_id === sweptId)
      if (!sweptCase) continue
      const shared = unswept.cohort_ids.filter(id => sweptCase.cohort_ids.includes(id)).length
      if (shared > maxSharedCohorts) {
        maxSharedCohorts = shared
        bestSource = sweptId
      }
    }

    if (bestSource) {
      propagationMap.get(bestSource)!.push(unswept.case_id)
    } else {
      // No cohort match found — this case needs a direct sweep
      caseIdsToSweep.push(unswept.case_id)
      propagationMap.set(unswept.case_id, [])
    }
  }

  return { caseIdsToSweep, propagationMap }
}

/**
 * Step 3 — Write signal cache entries from a completed sweep.
 * Called after each case sweep completes. Extracts signals and writes
 * them to enterprise_sweep_signals for propagation to cohort members.
 *
 * @param sweepId - The enterprise_sweeps.id that just completed
 * @param institutionId - Institution ID
 * @param sweepSignals - Array of signal bodies extracted from the sweep output
 * @param cohortIds - Cohort IDs this case belongs to (defines propagation scope)
 */
export async function writeSweepSignalCache(
  sweepId: string,
  institutionId: string,
  sweepSignals: Array<{
    signal_type: string
    signal_body: string
    magnitude: number
    direction: 'positive' | 'negative' | 'neutral'
    cohort_scoped: boolean  // false = applies to whole institution portfolio
  }>,
  cohortIds: string[]
): Promise<void> {
  if (!sweepSignals.length) return
  const supabase = createServiceClient()

  // Pull the field_combination for each cohort to build a merged cohort key
  const { data: cohortDefs } = await supabase
    .from('enterprise_cohort_definitions')
    .select('id, field_combination')
    .in('id', cohortIds)

  const cohortKey: Record<string, string> = {}
  for (const def of cohortDefs ?? []) {
    for (const { field, bucket_value } of def.field_combination as Array<{ field: string; bucket_value: string }>) {
      cohortKey[field] = bucket_value
    }
  }

  const rows = sweepSignals.map(sig => ({
    institution_id: institutionId,
    sweep_id: sweepId,
    signal_type: sig.signal_type,
    cohort_key: sig.cohort_scoped ? cohortKey : null,
    signal_body: sig.signal_body,
    magnitude: sig.magnitude,
    direction: sig.direction,
    expires_at: new Date(Date.now() + 48 * 3600000).toISOString(),
  }))

  const { error } = await supabase
    .from('enterprise_sweep_signals')
    .insert(rows)

  if (error) {
    console.error('[sweep-signals] Cache write error:', error)
  }
}

/**
 * Step 4 — Apply propagated signals to unswept cohort members.
 * Called after a swept case's signals are cached.
 * Finds matching cached signals and updates confidence on target cases
 * WITHOUT calling the Anthropic API.
 *
 * @param targetCaseIds - Cases to receive propagated signals
 * @param institutionId - Institution ID
 * @param sweepId - The sweep that generated the signals
 */
export async function propagateSignalsToCases(
  targetCaseIds: string[],
  institutionId: string,
  sweepId: string
): Promise<{ propagated: number; errors: number }> {
  if (!targetCaseIds.length) return { propagated: 0, errors: 0 }
  const supabase = createServiceClient()

  // Find active cached signals from this sweep
  const { data: signals } = await supabase
    .from('enterprise_sweep_signals')
    .select('id, signal_type, signal_body, magnitude, direction')
    .eq('institution_id', institutionId)
    .eq('sweep_id', sweepId)
    .gt('expires_at', new Date().toISOString())

  if (!signals?.length) return { propagated: 0, errors: 0 }

  const signalSummary = signals
    .map(s => `[PROPAGATED via cohort] ${s.signal_body}`)
    .join('\n')

  const netDirection = signals.reduce((acc, s) => {
    if (s.direction === 'negative') return acc - s.magnitude
    if (s.direction === 'positive') return acc + s.magnitude
    return acc
  }, 0)

  // Bulk-fetch case_refs (NOT NULL in enterprise_case_history)
  const { data: caseRows } = await supabase
    .from('enterprise_cases')
    .select('id, case_ref')
    .in('id', targetCaseIds)

  const caseRefMap = new Map((caseRows ?? []).map(r => [r.id, r.case_ref as string]))

  let propagated = 0
  let errors = 0

  for (const caseId of targetCaseIds) {
    // Get most recent history snapshot for drift_score/confidence baseline
    const { data: lastSnapshot } = await supabase
      .from('enterprise_case_history')
      .select('drift_score, drift_tier, confidence_pct')
      .eq('case_id', caseId)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .single()

    const baseDriftScore = lastSnapshot?.drift_score ?? 50
    const baseConfidence = lastSnapshot?.confidence_pct ?? 50

    // Apply signal delta with propagation penalty
    const driftDelta = Math.round(netDirection * 2)
    const newDriftScore = Math.max(0, Math.min(100, baseDriftScore + driftDelta))
    const confidenceDelta = Math.round(netDirection * 1.5) - PROPAGATION_CONFIDENCE_PENALTY
    const newConfidence = Math.max(0, Math.min(100, baseConfidence + confidenceDelta))

    // Determine new drift tier — must match DB check constraint values
    let drift_tier = 'STABLE'
    if (newDriftScore >= 75) drift_tier = 'CRITICAL'
    else if (newDriftScore >= 55) drift_tier = 'ALERT'
    else if (newDriftScore >= 40) drift_tier = 'CAUTION'

    const { error } = await supabase
      .from('enterprise_case_history')
      .insert({
        case_id: caseId,
        institution_id: institutionId,
        case_ref: caseRefMap.get(caseId) ?? '',
        snapshot_type: 'propagated',
        snapshot_at: new Date().toISOString(),
        drift_score: newDriftScore,
        drift_tier,
        confidence_pct: newConfidence,
        macro_event_ids: [],
        notes: signalSummary,
        prior_status: lastSnapshot?.drift_tier ?? 'STABLE',
      })

    if (error) {
      console.error('[propagate] History write error for case', caseId, error)
      errors++
    } else {
      propagated++
    }
  }

  return { propagated, errors }
}
