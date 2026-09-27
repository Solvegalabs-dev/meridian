/**
 * FF-043 — Portfolio Signal Pass
 *
 * Post-sweep classification of every case in an institution's portfolio.
 * Runs after FF-042 (or any sweep cycle) to map signal coverage state across
 * four tiers, then queues high-risk gaps for priority review.
 *
 * Coverage tiers:
 *   direct_sweep     — case was the subject of a completed sweep this cycle (< 24 h)
 *   propagated_signal — case received a propagated snapshot this cycle (< 48 h)
 *   stale_signal     — most recent snapshot is older than 48 h
 *   no_coverage      — no history snapshots at all
 *
 * High-risk gap: a case in stale_signal or no_coverage whose last known drift_tier
 * is ALERT or CRITICAL (or where drift_tier is unknown, conservatively flagged).
 */

import { createServiceClient } from '@/lib/supabase/server'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoverageClass =
  | 'direct_sweep'
  | 'propagated_signal'
  | 'stale_signal'
  | 'no_coverage'

export type HighRiskGap = {
  case_id: string
  case_ref: string
  drift_tier: string | null
  drift_score: number | null
  coverage: CoverageClass
  last_snapshot_at: string | null
}

export type PortfolioSignalPassResult = {
  institutionId: string
  totalCases: number
  direct_sweep: number
  propagated_signal: number
  stale_signal: number
  no_coverage: number
  highRiskGaps: HighRiskGap[]
  gapsCovered: number   // gaps flagged and written to enterprise_sweep_signals
  durationMs: number
}

// Coverage window constants (ms)
const DIRECT_SWEEP_WINDOW_MS  = 24 * 3600 * 1000  // 24 h
const PROPAGATED_WINDOW_MS    = 48 * 3600 * 1000  // 48 h

const HIGH_RISK_TIERS = new Set(['ALERT', 'CRITICAL'])

// ── Main export ───────────────────────────────────────────────────────────────

export async function runPortfolioSignalPass(
  institutionId: string
): Promise<PortfolioSignalPassResult> {
  const startMs = Date.now()
  const supabase = createServiceClient()
  const now = new Date()

  // Load all in-scope cases
  const { data: casesData } = await supabase
    .from('enterprise_cases')
    .select('id, case_ref')
    .eq('institution_id', institutionId)
    .eq('in_scope', true)

  const cases = casesData ?? []
  const totalCases = cases.length

  if (totalCases === 0) {
    return {
      institutionId,
      totalCases: 0,
      direct_sweep: 0,
      propagated_signal: 0,
      stale_signal: 0,
      no_coverage: 0,
      highRiskGaps: [],
      gapsCovered: 0,
      durationMs: Date.now() - startMs,
    }
  }

  const caseIds = cases.map(c => c.id as string)

  // Load most recent history entry per case in a single query (Postgres DISTINCT ON via RPC
  // is unavailable here; use ordered select + deduplicate client-side)
  const { data: historyData } = await supabase
    .from('enterprise_case_history')
    .select('case_id, snapshot_type, snapshot_at, drift_tier, drift_score')
    .in('case_id', caseIds)
    .order('snapshot_at', { ascending: false })

  // Build map: case_id → most recent history entry
  const latestSnap = new Map<string, {
    snapshot_type: string
    snapshot_at: string
    drift_tier: string | null
    drift_score: number | null
  }>()

  for (const row of historyData ?? []) {
    const caseId = row.case_id as string
    if (!latestSnap.has(caseId)) {
      latestSnap.set(caseId, {
        snapshot_type: row.snapshot_type as string,
        snapshot_at: row.snapshot_at as string,
        drift_tier: row.drift_tier as string | null,
        drift_score: row.drift_score as number | null,
      })
    }
  }

  // Classify each case
  let directSweepCount = 0
  let propagatedCount = 0
  let staleCount = 0
  let noCoverageCount = 0
  const highRiskGaps: HighRiskGap[] = []

  const caseRefMap = new Map(cases.map(c => [c.id as string, c.case_ref as string]))

  for (const caseId of caseIds) {
    const snap = latestSnap.get(caseId)
    let coverage: CoverageClass

    if (!snap) {
      coverage = 'no_coverage'
      noCoverageCount++
    } else {
      const ageMs = now.getTime() - new Date(snap.snapshot_at).getTime()
      if (snap.snapshot_type === 'sweep' && ageMs <= DIRECT_SWEEP_WINDOW_MS) {
        coverage = 'direct_sweep'
        directSweepCount++
      } else if (snap.snapshot_type === 'propagated' && ageMs <= PROPAGATED_WINDOW_MS) {
        coverage = 'propagated_signal'
        propagatedCount++
      } else {
        coverage = 'stale_signal'
        staleCount++
      }
    }

    // Flag high-risk gaps
    if (coverage === 'stale_signal' || coverage === 'no_coverage') {
      const tier = snap?.drift_tier ?? null
      const isHighRisk = tier === null || HIGH_RISK_TIERS.has(tier)
      if (isHighRisk) {
        highRiskGaps.push({
          case_id: caseId,
          case_ref: caseRefMap.get(caseId) ?? caseId,
          drift_tier: tier,
          drift_score: snap?.drift_score ?? null,
          coverage,
          last_snapshot_at: snap?.snapshot_at ?? null,
        })
      }
    }
  }

  // Write gap records to enterprise_sweep_signals so the progressive sweep engine
  // can pick them up in the next cycle as priority sweep candidates
  let gapsCovered = 0

  if (highRiskGaps.length > 0) {
    const gapRows = highRiskGaps.map(gap => ({
      institution_id: institutionId,
      sweep_id: null as string | null,
      signal_type: 'coverage_gap',
      cohort_key: null as Record<string, string> | null,
      signal_body: JSON.stringify({
        case_id: gap.case_id,
        case_ref: gap.case_ref,
        coverage: gap.coverage,
        drift_tier: gap.drift_tier,
        drift_score: gap.drift_score,
        last_snapshot_at: gap.last_snapshot_at,
        reason: 'FF-043 portfolio signal pass: high-risk gap detected',
      }),
      magnitude: gap.drift_tier === 'CRITICAL' ? 5 : 4,
      direction: 'negative' as const,
      applies_to_case_count: 1,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }))

    // Insert in batches of 50 to avoid oversized payloads
    for (let i = 0; i < gapRows.length; i += 50) {
      const batch = gapRows.slice(i, i + 50)
      const { error } = await supabase
        .from('enterprise_sweep_signals')
        .insert(batch)
      if (!error) gapsCovered += batch.length
      else console.error('[portfolio-signal-pass] Gap insert error:', error.message)
    }
  }

  return {
    institutionId,
    totalCases,
    direct_sweep: directSweepCount,
    propagated_signal: propagatedCount,
    stale_signal: staleCount,
    no_coverage: noCoverageCount,
    highRiskGaps,
    gapsCovered,
    durationMs: Date.now() - startMs,
  }
}
