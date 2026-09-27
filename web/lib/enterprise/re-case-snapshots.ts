import { createServiceClient } from '@/lib/supabase/server'

// ── RE Signal Taxonomy ────────────────────────────────────────────────────────

type RESignal = {
  signal_id: string
  label: string
  source: string
  magnitude: string
  direction_score: number
  score_contribution: number
}

type RECaseRow = {
  id: string
  case_ref: string
  loan_data: Record<string, unknown>
}

function inferCaseType(ld: Record<string, unknown>): 'listing' | 'buyer' | null {
  const explicit = ld.case_type as string | undefined
  if (explicit === 'listing') return 'listing'
  if (explicit === 'buyer') return 'buyer'
  if (ld.days_on_market !== undefined || ld.list_price !== undefined) return 'listing'
  if (ld.rate_lock_expires !== undefined) return 'buyer'
  return null
}

function buildRESignals(
  loanData: Record<string, unknown>,
  caseType: 'listing' | 'buyer' | null
): RESignal[] {
  const signals: RESignal[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (caseType === 'listing') {
    const domRaw = loanData.days_on_market
    const dom =
      typeof domRaw === 'number' ? domRaw
      : typeof domRaw === 'string' ? Number(domRaw)
      : undefined

    if (dom !== undefined && !isNaN(dom) && dom >= 25) {
      const magnitude = dom >= 45 ? 'SEVERE' : dom >= 35 ? 'SIGNIFICANT' : 'MODERATE'
      signals.push({
        signal_id: 'RE:DOM_THRESHOLD',
        label: `Days on market: ${dom}d (${dom >= 45 ? 'past' : 'approaching'} 45-day threshold)`,
        source: 'PORTFOLIO',
        magnitude,
        direction_score: dom >= 45 ? -3 : dom >= 35 ? -2 : -1,
        score_contribution: dom >= 45 ? 25 : dom >= 35 ? 15 : 8,
      })
    }

    const priceBand = loanData.price_band as string | undefined
    if (dom !== undefined && !isNaN(dom) && dom >= 25 && priceBand) {
      signals.push({
        signal_id: 'RE:PRICE_BAND_STALL',
        label: `${priceBand} price band stalling at ${dom}d DOM`,
        source: 'PORTFOLIO',
        magnitude: 'MODERATE',
        direction_score: -1,
        score_contribution: 5,
      })
    }

    const listPriceRaw = loanData.list_price
    const lastSalePriceRaw = loanData.last_sale_price
    if (typeof listPriceRaw === 'number' && typeof lastSalePriceRaw === 'number' && lastSalePriceRaw > 0) {
      const delta = (listPriceRaw - lastSalePriceRaw) / lastSalePriceRaw
      if (delta > 0.15) {
        signals.push({
          signal_id: 'RE:LIST_PRICE_PREMIUM',
          label: `List price ${Math.round(delta * 100)}% above last sale`,
          source: 'PORTFOLIO',
          magnitude: delta > 0.25 ? 'SIGNIFICANT' : 'MODERATE',
          direction_score: -1,
          score_contribution: delta > 0.25 ? 10 : 5,
        })
      }
    }
  }

  if (caseType === 'buyer') {
    const rateLock = loanData.rate_lock_expires as string | undefined
    if (rateLock) {
      const daysUntil = Math.ceil(
        (new Date(rateLock).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )

      if (daysUntil <= 21) {
        const expired = daysUntil <= 0
        const magnitude = (expired || daysUntil <= 7) ? 'SEVERE' : daysUntil <= 14 ? 'SIGNIFICANT' : 'MODERATE'
        signals.push({
          signal_id: 'RE:RATE_LOCK_EXPIRY',
          label: expired
            ? `Rate lock expired ${Math.abs(daysUntil)} days ago`
            : `Rate lock expires in ${daysUntil} days`,
          source: 'PORTFOLIO',
          magnitude,
          direction_score: (expired || daysUntil <= 7) ? -3 : daysUntil <= 14 ? -2 : -1,
          score_contribution: (expired || daysUntil <= 7) ? 20 : daysUntil <= 14 ? 12 : 6,
        })
      }
    }

    const budgetRaw = loanData.buyer_budget ?? loanData.max_budget
    const listPriceRaw = loanData.list_price
    if (typeof budgetRaw === 'number' && typeof listPriceRaw === 'number' && listPriceRaw > budgetRaw) {
      const gap = ((listPriceRaw - budgetRaw) / budgetRaw) * 100
      signals.push({
        signal_id: 'RE:BUDGET_GAP',
        label: `List price ${Math.round(gap)}% above buyer budget`,
        source: 'PORTFOLIO',
        magnitude: gap > 10 ? 'SIGNIFICANT' : 'MODERATE',
        direction_score: -2,
        score_contribution: gap > 10 ? 15 : 8,
      })
    }
  }

  return signals
}

function computeREDriftScore(
  loanData: Record<string, unknown>,
  caseType: 'listing' | 'buyer' | null
): { drift_score: number; drift_direction: string } {
  let score = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (caseType === 'listing') {
    const domRaw = loanData.days_on_market
    const dom =
      typeof domRaw === 'number' ? domRaw
      : typeof domRaw === 'string' ? Number(domRaw)
      : 0
    if (dom >= 45) score += 40
    else if (dom >= 35) score += 25
    else if (dom >= 25) score += 10
  }

  if (caseType === 'buyer') {
    const rateLock = loanData.rate_lock_expires as string | undefined
    if (rateLock) {
      const daysUntil = Math.ceil(
        (new Date(rateLock).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
      // daysUntil <= 0 means expired — treat as maximum urgency
      if (daysUntil <= 0) score += 40
      else if (daysUntil <= 7) score += 40
      else if (daysUntil <= 14) score += 25
      else if (daysUntil <= 21) score += 10
    }
  }

  const direction =
    score >= 40 ? 'ALERT' :
    score >= 20 ? 'CAUTION' :
    score >= 10 ? 'WATCH' : 'STABLE'

  return { drift_score: Math.min(score, 100), drift_direction: direction }
}

function computeRECaseConfidence(
  loanData: Record<string, unknown>,
  activeSignals: RESignal[],
  objectiveCount: number
): number {
  let score = 40

  // Data completeness
  if (loanData.days_on_market !== undefined) score += 10
  if (loanData.price_band) score += 8
  if (loanData.list_price) score += 6
  if (loanData.neighborhood) score += 4
  // Buyer-specific fields
  if (loanData.rate_lock_expires) score += 10
  if (loanData.buyer_budget ?? loanData.max_budget) score += 5

  // Signal and objective coverage bonuses
  if (activeSignals.length >= 2) score += 5
  if (objectiveCount >= 1) score += 5
  if (objectiveCount >= 3) score += 7

  return Math.min(score, 100)
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function writeRECaseSnapshots(
  institutionId: string,
  sweepId: string,
  caseObjectiveIds: Record<string, string[]>   // case_ref → objective UUID[]
): Promise<{ written: number; error: string | null }> {
  const supabase = createServiceClient()

  const { data: casesData } = await supabase
    .from('enterprise_cases')
    .select('id, case_ref, loan_data')
    .eq('institution_id', institutionId)

  const cases: RECaseRow[] = (casesData ?? []).map(c => ({
    id: c.id as string,
    case_ref: (c.case_ref as string) ?? (c.id as string),
    loan_data: (c.loan_data as Record<string, unknown>) ?? {},
  }))

  if (cases.length === 0) return { written: 0, error: null }

  const sweepTimestamp = new Date().toISOString()

  // One row per case per objective — also capture one score per case for history write
  const snapshotInserts: object[] = []
  type CaseScore = { drift_score: number; drift_direction: string; confidence_pct: number; case_ref: string }
  const caseLevelScores = new Map<string, CaseScore>()

  for (const ec of cases) {
    const objectiveIds = caseObjectiveIds[ec.case_ref] ?? []
    if (objectiveIds.length === 0) continue   // skip cases not referenced by any objective

    const ld = ec.loan_data
    const caseType = inferCaseType(ld)
    const activeSignals = buildRESignals(ld, caseType)
    const { drift_score, drift_direction } = computeREDriftScore(ld, caseType)
    const confidence_pct = computeRECaseConfidence(ld, activeSignals, objectiveIds.length)

    caseLevelScores.set(ec.id, { drift_score, drift_direction, confidence_pct, case_ref: ec.case_ref })

    for (const objectiveId of objectiveIds) {
      snapshotInserts.push({
        case_id: ec.id,
        institution_id: institutionId,
        objective_id: objectiveId,
        sweep_id: sweepId,
        sweep_timestamp: sweepTimestamp,
        active_signals: activeSignals,
        pattern_matches: [],
        drift_score,
        drift_direction,
        top_signal_1: activeSignals[0]?.label ?? null,
        top_signal_2: activeSignals[1]?.label ?? null,
        top_signal_3: activeSignals[2]?.label ?? null,
        collateral_risk: null,
        income_stress: null,
        recommended_action: null,
        confidence_pct,
        engine_version: 're-sweep-v2',
      })
    }
  }

  if (snapshotInserts.length === 0) return { written: 0, error: null }

  const { error: snapshotErr } = await supabase
    .from('case_signal_snapshots')
    .insert(snapshotInserts)

  if (snapshotErr) {
    console.error('[FF-062] case_signal_snapshots write failed:', snapshotErr.message)
    return { written: 0, error: snapshotErr.message }
  }

  // ── Step 3b: Write enterprise_case_history (mirrors auto-finance sweep pattern) ──
  // One row per case so the report client reads drift_score + drift_tier correctly.
  // WATCH has no equivalent in the Dir type — map it to CAUTION.
  if (caseLevelScores.size > 0) {
    const historyInserts = Array.from(caseLevelScores.entries()).map(([caseId, s]) => ({
      case_id: caseId,
      institution_id: institutionId,
      case_ref: s.case_ref,
      snapshot_type: 'sweep',
      snapshot_at: sweepTimestamp,
      drift_score: s.drift_score,
      drift_tier: s.drift_direction === 'ALERT' ? 'ALERT'
        : (s.drift_direction === 'CAUTION' || s.drift_direction === 'WATCH') ? 'CAUTION'
        : 'STABLE',
      confidence_pct: s.confidence_pct,
      macro_event_ids: [],
      notes: `re-sweep-${sweepId.slice(0, 8)}`,
      prior_status: null,
    }))
    const { error: histErr } = await supabase
      .from('enterprise_case_history')
      .insert(historyInserts)
    if (histErr) console.error('[FF-062] enterprise_case_history write failed:', histErr.message)
    else console.log('[FF-062] enterprise_case_history written:', historyInserts.length, 'rows')
  }

  // ── Step 4: Update portfolio_metrics stoplight from actual drift_direction counts ──
  const since = new Date(Date.now() - 60000).toISOString()
  const { data: snapshots } = await supabase
    .from('case_signal_snapshots')
    .select('drift_direction')
    .eq('institution_id', institutionId)
    .gte('sweep_timestamp', since)

  if (snapshots && snapshots.length > 0) {
    const tierCounts = {
      critical_count: snapshots.filter(s => s.drift_direction === 'CRITICAL').length,
      alert_count:    snapshots.filter(s => s.drift_direction === 'ALERT').length,
      caution_count:  snapshots.filter(s => s.drift_direction === 'CAUTION' || s.drift_direction === 'WATCH').length,
      stable_count:   snapshots.filter(s => s.drift_direction === 'STABLE').length,
    }

    const { data: latestMetric } = await supabase
      .from('enterprise_portfolio_metrics')
      .select('id')
      .eq('institution_id', institutionId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single()

    if (latestMetric?.id) {
      await supabase
        .from('enterprise_portfolio_metrics')
        .update(tierCounts)
        .eq('id', (latestMetric as { id: string }).id)
    }
  }

  return { written: snapshotInserts.length, error: null }
}
