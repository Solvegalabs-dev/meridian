import { createServiceClient } from '@/lib/supabase/server'
import { getAnthropicClient } from '@/lib/anthropic/client'
import { getMacroContextForSnapshot } from './lookback'

export type REPortfolioSweepResult = {
  metricsId: string
  portfolioSweepId: string
  healthScore: number
  activeListings: number
  activeBuyers: number
  avgDOM: number | null
  domOver45: number
  domOver60: number
  rateLockExpired: number
  rateLockUnder14: number
  durationMs: number
}

type RECaseRow = {
  id: string
  loan_data: Record<string, unknown> | null
}

function inferCaseType(ld: Record<string, unknown>): 'listing' | 'buyer' | null {
  const explicit = ld.case_type as string | undefined
  if (explicit === 'listing') return 'listing'
  if (explicit === 'buyer') return 'buyer'
  if (ld.days_on_market !== undefined || ld.list_price !== undefined) return 'listing'
  if (ld.rate_lock_expires !== undefined) return 'buyer'
  return null
}

function normalizeHealthTrend(raw: string | null | undefined): 'improving' | 'stable' | 'deteriorating' {
  if (raw === 'improving') return 'improving'
  if (raw === 'deteriorating') return 'deteriorating'
  return 'stable'
}

export async function runREPortfolioSweep(institutionId: string): Promise<REPortfolioSweepResult> {
  const startMs = Date.now()
  const supabase = createServiceClient()

  const { data: casesData } = await supabase
    .from('enterprise_cases')
    .select('id, loan_data')
    .eq('institution_id', institutionId)
    .eq('in_scope', true)

  const cases: RECaseRow[] = casesData ?? []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // ── Aggregate RE portfolio metrics from loan_data ──
  let activeListings = 0
  let activeBuyers = 0
  let domSum = 0
  let domCount = 0
  let domOver45 = 0
  let domOver60 = 0
  let rateLockExpired = 0
  let rateLockUnder14 = 0

  let priceSum = 0
  let priceCount = 0
  const bandCounts = new Map<string, number>()
  const staleListingIds: string[] = []
  const rateLockRiskIds: string[] = []

  for (const c of cases) {
    const ld = (c.loan_data ?? {}) as Record<string, unknown>
    const caseType = inferCaseType(ld)

    if (caseType === 'listing') {
      activeListings++
      const domRaw = ld.days_on_market
      const dom =
        typeof domRaw === 'number' ? domRaw
        : typeof domRaw === 'string' ? Number(domRaw)
        : undefined
      if (dom !== undefined && !isNaN(dom)) {
        domSum += dom
        domCount++
        if (dom >= 45) { domOver45++; staleListingIds.push(c.id) }
        if (dom >= 60) domOver60++
      }
      const priceRaw = ld.list_price
      const price =
        typeof priceRaw === 'number' ? priceRaw
        : typeof priceRaw === 'string' ? Number(priceRaw)
        : undefined
      if (price !== undefined && !isNaN(price)) { priceSum += price; priceCount++ }
      const band = ld.price_band as string | undefined
      if (band) bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1)
    } else if (caseType === 'buyer') {
      activeBuyers++
      const rateLock = ld.rate_lock_expires as string | undefined
      if (rateLock) {
        const expiry = new Date(rateLock)
        expiry.setHours(0, 0, 0, 0)
        const daysUntil = Math.round((expiry.getTime() - today.getTime()) / 86400000)
        if (daysUntil < 0) { rateLockExpired++; rateLockRiskIds.push(c.id) }
        else if (daysUntil < 14) { rateLockUnder14++; rateLockRiskIds.push(c.id) }
        // daysUntil 14–29: within 30-day window — tracked via rateLockUnder30 in getREPortfolioMetrics; not needed here
      }
    }
  }

  const avgDOM = domCount > 0 ? Math.round(domSum / domCount) : null
  const avgListPrice = priceCount > 0 ? Math.round(priceSum / priceCount) : null
  const totalCases = cases.length

  // ── RE Health Score (0–100) ──
  // Base 80; penalise for stale listings and rate lock risk
  let healthScore = 80
  if (totalCases > 0) {
    const stalePct = domCount > 0 ? domOver45 / domCount : 0
    const rateLockRiskPct = activeBuyers > 0
      ? (rateLockExpired + rateLockUnder14) / activeBuyers
      : 0
    healthScore = Math.max(
      0,
      Math.min(100, Math.round(80 - stalePct * 40 - rateLockRiskPct * 30))
    )
  }
  // Health trend: compare to previous metric (stored as 0-1 fraction — scale back to 0-100 for delta)
  const { data: prevMetric } = await supabase
    .from('enterprise_portfolio_metrics')
    .select('portfolio_health_score')
    .eq('institution_id', institutionId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .single()

  const prevHealthPct = prevMetric?.portfolio_health_score != null
    ? prevMetric.portfolio_health_score * 100
    : null
  const rawTrend =
    prevHealthPct == null
      ? (healthScore >= 80 ? 'improving' : healthScore >= 50 ? 'stable' : 'deteriorating')
      : healthScore > prevHealthPct + 2 ? 'improving'
      : healthScore < prevHealthPct - 2 ? 'deteriorating'
      : 'stable'
  const healthTrend = normalizeHealthTrend(rawTrend)

  // Price band distribution (for cohort context)
  const BAND_ORDER = ['entry', 'entry-mid', 'mid', 'upper-mid', 'luxury']
  const priceBandDistribution = BAND_ORDER
    .filter(b => bandCounts.has(b))
    .map(b => ({ band: b, count: bandCounts.get(b)! }))

  // ── Macro context ──
  const macroEvents = await getMacroContextForSnapshot(new Date().toISOString(), 90, 'real_estate')

  // ── Claude portfolio narrative ──
  const narrativePrompt = RE_PORTFOLIO_NARRATIVE_PROMPT({
    totalCases,
    activeListings,
    activeBuyers,
    avgDOM,
    domOver45,
    domOver60,
    rateLockExpired,
    rateLockUnder14,
    healthScore,
    avgListPrice,
    priceBandDistribution,
    macroEvents: macroEvents.map(e =>
      `[Magnitude ${e.magnitude}/${e.direction}] ${e.event_name} (${e.event_date})`
    ),
  })

  let portfolioSummary =
    `${activeListings} active listings, ${activeBuyers} active buyers. ` +
    `${domOver45} listing(s) exceed 45 days on market. ` +
    `Portfolio health score: ${healthScore}/100.`
  let keyFindings: string[] = []

  try {
    const client = getAnthropicClient()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: narrativePrompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      portfolioSummary = parsed.portfolio_summary ?? portfolioSummary
      keyFindings = parsed.key_findings ?? []
    }
  } catch (err) {
    console.error('[RE-SWEEP-F1] Claude narrative error:', err instanceof Error ? err.message : String(err))
  }

  // ── Write enterprise_portfolio_metrics ──
  const { data: metricsRow, error: metricsErr } = await supabase
    .from('enterprise_portfolio_metrics')
    .insert({
      institution_id: institutionId,
      portfolio_health_score: healthScore / 100,   // stored as 0–1 fraction
      health_trend: healthTrend,
      portfolio_summary: portfolioSummary,
      key_findings: keyFindings,
      high_risk_cohorts: staleListingIds.length > 0
        ? [{ type: 'stale_listing', case_ids: staleListingIds, count: staleListingIds.length }]
        : [],
      projected_tier_changes: rateLockRiskIds.length > 0
        ? [{ type: 'rate_lock_risk', case_ids: rateLockRiskIds, count: rateLockRiskIds.length }]
        : [],
      concentration_flags: priceBandDistribution,
      delinquency_rate_pct: 0,   // not applicable for RE
      default_count: 0,
      charged_off_count: 0,
      total_cases: totalCases,
      critical_count: domOver60,
      alert_count: domOver45 - domOver60,
      stable_count: activeListings - domOver45,
      computed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (metricsErr || !metricsRow) {
    throw new Error(`RE portfolio metrics write failed: ${metricsErr?.message}`)
  }

  // ── Write enterprise_sweeps ──
  const { data: sweepRow, error: sweepError } = await supabase.from('enterprise_sweeps').insert({
    institution_id: institutionId,
    trigger_type: 'manual',
    status: 'complete',
    fork: 'portfolio',
    sweep_type: 'portfolio',
    cases_in_scope: totalCases,
    cases_swept: totalCases,
    signals_used: macroEvents.length,
    patterns_matched: staleListingIds.length + rateLockRiskIds.length,
    engine_version: 're-sweep-v1',
    started_at: new Date(startMs).toISOString(),
    completed_at: new Date().toISOString(),
  }).select('id').single()

  if (sweepError || !(sweepRow as { id?: string } | null)?.id) {
    console.error('[RE Sweep] Failed to capture sweep ID:', sweepError?.message)
  }
  const portfolioSweepId = (sweepRow as { id?: string } | null)?.id ?? crypto.randomUUID()

  return {
    metricsId: metricsRow.id as string,
    portfolioSweepId,
    healthScore,
    activeListings,
    activeBuyers,
    avgDOM,
    domOver45,
    domOver60,
    rateLockExpired,
    rateLockUnder14,
    durationMs: Date.now() - startMs,
  }
}

// ── RE Portfolio Narrative Prompt ─────────────────────────────────────────────

const RE_PORTFOLIO_NARRATIVE_PROMPT = (data: {
  totalCases: number
  activeListings: number
  activeBuyers: number
  avgDOM: number | null
  domOver45: number
  domOver60: number
  rateLockExpired: number
  rateLockUnder14: number
  healthScore: number
  avgListPrice: number | null
  priceBandDistribution: Array<{ band: string; count: number }>
  macroEvents: string[]
}): string => `You are a real estate portfolio intelligence analyst for Meridian Fusion.
Analyze the following brokerage portfolio data and return a JSON response only.

PORTFOLIO DATA:
- Total cases: ${data.totalCases}
- Active listings: ${data.activeListings}
- Active buyers: ${data.activeBuyers}
- Average days on market: ${data.avgDOM ?? 'N/A'}
- Listings over 45 days: ${data.domOver45}
- Listings over 60 days: ${data.domOver60}
- Rate locks expired: ${data.rateLockExpired}
- Rate locks expiring in <14 days: ${data.rateLockUnder14}
- Portfolio health score: ${data.healthScore}/100
- Average list price: ${data.avgListPrice ? `$${data.avgListPrice.toLocaleString()}` : 'N/A'}
- Price band distribution: ${JSON.stringify(data.priceBandDistribution)}
- Active macro signals (real estate): ${data.macroEvents.length > 0 ? data.macroEvents.join('; ') : 'None within last 90 days'}

Return ONLY valid JSON with no preamble or markdown:
{
  "portfolio_summary": "2-3 sentence plain English summary of brokerage portfolio health",
  "key_findings": [
    "Finding 1 — specific and data-grounded",
    "Finding 2",
    "Finding 3"
  ]
}

Rules:
- Every claim must reference specific data from the input
- portfolio_summary must be readable by a non-technical brokerage owner
- Do not invent statistics not present in the input
- key_findings must name specific counts, rates, or price points from the data`
