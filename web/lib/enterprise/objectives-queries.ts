import type { SupabaseClient } from '@supabase/supabase-js'

export type ObjectiveState = 'focus' | 'monitoring_lite' | 'paused'
export type LiteTrend = 'improving' | 'stable' | 'deteriorating' | 'unknown'

export type ObjectiveResult = {
  id: string
  sweep_type: 'full' | 'lite'
  confidence_score: number
  alert_triggered: boolean
  alert_reason: string | null
  affecting_it: string | null
  implies: string | null
  signals: string | null
  what_to_do: string | null
  lite_metric_1_label: string | null
  lite_metric_1_value: string | null
  lite_metric_2_label: string | null
  lite_metric_2_value: string | null
  lite_trend: LiteTrend | null
  lite_summary: string | null
  computed_at: string
}

export type ObjectiveWithResult = {
  id: string
  obj_id: string
  title: string
  statement: string
  objective_state: ObjectiveState
  objective_order: number
  lite_sweep_cadence_days: number | null
  last_focus_sweep_at: string | null
  last_lite_sweep_at: string | null
  escalated_at: string | null
  latest_result: ObjectiveResult | null
}

type RawObjective = {
  id: string
  obj_id: string
  title: string
  statement: string
  objective_state: ObjectiveState
  objective_order: number
  lite_sweep_cadence_days: number | null
  last_focus_sweep_at: string | null
  last_lite_sweep_at: string | null
  escalated_at: string | null
  enterprise_objective_results: ObjectiveResult[]
}

export type MacroEventLink = {
  url: string | null
  source: string | null
  date: string | null
  metric: string | null
}

export async function getObjectivesWithResults(
  supabase: SupabaseClient,
  institutionId: string
): Promise<ObjectiveWithResult[]> {
  const { data } = await supabase
    .from('enterprise_objectives')
    .select(`
      id, obj_id, title, statement, objective_state,
      objective_order, lite_sweep_cadence_days,
      last_focus_sweep_at, last_lite_sweep_at, escalated_at,
      enterprise_objective_results (
        id, sweep_type, confidence_score, alert_triggered, alert_reason,
        affecting_it, implies, signals, what_to_do,
        lite_metric_1_label, lite_metric_1_value,
        lite_metric_2_label, lite_metric_2_value,
        lite_trend, lite_summary, computed_at
      )
    `)
    .eq('institution_id', institutionId)
    .eq('status', 'active')
    .order('objective_order', { ascending: true })

  if (!data) return []

  return (data as RawObjective[]).map(obj => ({
    ...obj,
    enterprise_objective_results: undefined as unknown as ObjectiveResult[],
    latest_result: (obj.enterprise_objective_results ?? [])
      .sort((a, b) => new Date(b.computed_at).getTime() - new Date(a.computed_at).getTime())[0] ?? null,
  }))
}

export async function getMacroEventLinkMap(
  supabase: SupabaseClient
): Promise<Map<string, MacroEventLink>> {
  const { data } = await supabase
    .from('enterprise_macro_events')
    .select('event_name, source_url, source_name, event_date, metric_value, metric_unit')
    .not('event_name', 'is', null)

  const map = new Map<string, MacroEventLink>()
  for (const e of data ?? []) {
    if (e.event_name) {
      map.set(e.event_name as string, {
        url: (e.source_url as string | null) ?? null,
        source: (e.source_name as string | null) ?? null,
        date: (e.event_date as string | null) ?? null,
        metric: e.metric_value != null
          ? `${e.metric_value}${e.metric_unit ?? ''}`
          : null,
      })
    }
  }
  return map
}

export async function getLatestPortfolioMetrics(supabase: SupabaseClient, institutionId: string) {
  const { data } = await supabase
    .from('enterprise_portfolio_metrics')
    .select('portfolio_health_score, health_trend, key_findings, computed_at')
    .eq('institution_id', institutionId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .single()
  return data ?? null
}

const FICO_MIDPOINT: Record<string, number> = {
  '580-619': 600, '620-639': 630, '620-659': 640, '640-659': 650,
  '660-679': 670, '680-699': 690, '700-719': 710, '720-739': 730,
  '720-759': 740, '740+': 755,
}

export type PortfolioMetricsData = {
  total: number
  delinquencyRate: number
  repoRate: number
  avgLTV: number
  avgFICO: number
  approvalRate: null
  declineRate: null
  healthScore: number | null
  healthTrend: string | null
  portfolioSummary: string | null
  highRiskCohorts: unknown[]
  computedAt: string | null
  sparklines: {
    delinquency: Array<{ date: string; value: number }>
    health: Array<{ date: string; value: number }>
    repoRate: Array<{ date: string; value: number }>
  }
  vintageHeatmap: Array<{
    quarter: string
    sortKey: string
    current: number
    dpd30: number
    dpd60: number
    dpd90: number
    defaultCount: number
    chargedOff: number
    total: number
  }>
  driftHistory: Array<{
    computedAt: string
    healthScore: number
    delinquencyRate: number
    criticalCount: number
    alertCount: number
    stableCount: number
  }>
}

function originationQuarter(dateStr: string | null): { label: string; sortKey: string } | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const year = d.getFullYear()
  const q = Math.floor(d.getMonth() / 3) + 1
  return { label: `Q${q}'${String(year).slice(2)}`, sortKey: `${year}-Q${q}` }
}

export async function getPortfolioMetrics(
  supabase: SupabaseClient,
  institutionId: string
): Promise<PortfolioMetricsData | null> {
  const [metricsRes, historyRes, casesRes] = await Promise.all([
    supabase
      .from('enterprise_portfolio_metrics')
      .select('portfolio_health_score, health_trend, portfolio_summary, high_risk_cohorts, delinquency_rate_pct, default_count, charged_off_count, total_cases, computed_at, critical_count, alert_count, stable_count')
      .eq('institution_id', institutionId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single(),

    supabase
      .from('enterprise_portfolio_metrics')
      .select('delinquency_rate_pct, portfolio_health_score, default_count, charged_off_count, total_cases, critical_count, alert_count, stable_count, computed_at')
      .eq('institution_id', institutionId)
      .order('computed_at', { ascending: true })
      .limit(12),

    supabase
      .from('enterprise_cases')
      .select('loan_status, ltv_ratio, fico_band, origination_date')
      .eq('institution_id', institutionId),
  ])

  const metrics = metricsRes.data
  const history = historyRes.data ?? []
  const cases = casesRes.data ?? []

  const total = cases.length
  if (total === 0 && !metrics) return null

  const delinquentStatuses = new Set(['30dpd','60dpd','90dpd','default','charged_off'])
  const repoStatuses = new Set(['default','charged_off'])

  const delinquent = cases.filter(c => delinquentStatuses.has(c.loan_status)).length
  const repos = cases.filter(c => repoStatuses.has(c.loan_status)).length

  const ltvVals = cases.map(c => c.ltv_ratio ?? 0).filter(v => v > 0)
  const avgLTV = ltvVals.length > 0 ? ltvVals.reduce((s, v) => s + v, 0) / ltvVals.length : 0

  const avgFICO = total > 0
    ? cases.reduce((s, c) => s + (FICO_MIDPOINT[c.fico_band] ?? 680), 0) / total
    : 680

  // Sparklines from historical metrics rows
  const sparklines = {
    delinquency: history.map(r => ({
      date: r.computed_at as string,
      value: ((r.delinquency_rate_pct as number) ?? 0) * 100,
    })),
    health: history.map(r => ({
      date: r.computed_at as string,
      value: (r.portfolio_health_score as number) ?? 0,
    })),
    repoRate: history.map(r => {
      const tc = (r.total_cases as number) || 1
      const repos = ((r.default_count as number) ?? 0) + ((r.charged_off_count as number) ?? 0)
      return { date: r.computed_at as string, value: (repos / tc) * 100 }
    }),
  }

  // Vintage heatmap from cases
  const vintageMap = new Map<string, { label: string; sortKey: string; current: number; dpd30: number; dpd60: number; dpd90: number; defaultCount: number; chargedOff: number }>()
  for (const c of cases) {
    const q = originationQuarter(c.origination_date as string | null)
    if (!q) continue
    const entry = vintageMap.get(q.sortKey) ?? { label: q.label, sortKey: q.sortKey, current: 0, dpd30: 0, dpd60: 0, dpd90: 0, defaultCount: 0, chargedOff: 0 }
    switch (c.loan_status) {
      case 'current':      entry.current++; break
      case '30dpd':        entry.dpd30++;   break
      case '60dpd':        entry.dpd60++;   break
      case '90dpd':        entry.dpd90++;   break
      case 'default':      entry.defaultCount++; break
      case 'charged_off':  entry.chargedOff++; break
    }
    vintageMap.set(q.sortKey, entry)
  }

  const vintageHeatmap = Array.from(vintageMap.values())
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(v => ({
      quarter: v.label,
      sortKey: v.sortKey,
      current: v.current,
      dpd30: v.dpd30,
      dpd60: v.dpd60,
      dpd90: v.dpd90,
      defaultCount: v.defaultCount,
      chargedOff: v.chargedOff,
      total: v.current + v.dpd30 + v.dpd60 + v.dpd90 + v.defaultCount + v.chargedOff,
    }))

  const driftHistory = history.map(r => ({
    computedAt: r.computed_at as string,
    healthScore: (r.portfolio_health_score as number) ?? 0,
    delinquencyRate: ((r.delinquency_rate_pct as number) ?? 0) * 100,
    criticalCount: (r.critical_count as number) ?? 0,
    alertCount: (r.alert_count as number) ?? 0,
    stableCount: (r.stable_count as number) ?? 0,
  }))

  return {
    total: total || (metrics?.total_cases as number) || 0,
    delinquencyRate: total > 0 ? (delinquent / total) * 100 : ((metrics?.delinquency_rate_pct as number) ?? 0) * 100,
    repoRate: total > 0 ? (repos / total) * 100 : 0,
    avgLTV: Math.round(avgLTV * 10) / 10,
    avgFICO: Math.round(avgFICO),
    approvalRate: null,
    declineRate: null,
    healthScore: (metrics?.portfolio_health_score as number) ?? null,
    healthTrend: (metrics?.health_trend as string) ?? null,
    portfolioSummary: (metrics?.portfolio_summary as string | null) ?? null,
    highRiskCohorts: (metrics?.high_risk_cohorts as unknown[]) ?? [],
    computedAt: (metrics?.computed_at as string) ?? null,
    sparklines,
    vintageHeatmap,
    driftHistory,
  }
}

// ─── Real Estate Portfolio Metrics ────────────────────────────────────────────

export type REPortfolioMetricsData = {
  totalCases: number
  activeListings: number
  activeBuyers: number
  avgDOM: number | null
  domOver45: number
  domOver60: number
  rateLockUnder14: number
  rateLockUnder30: number
  rateLockExpired: number
  priceBandDistribution: Array<{ band: string; count: number }>
  avgListPrice: number | null
  portfolioSummary: string | null
  computedAt: string | null
}

export async function getREPortfolioMetrics(
  supabase: SupabaseClient,
  institutionId: string
): Promise<REPortfolioMetricsData | null> {
  const [casesRes, metricsRes] = await Promise.all([
    supabase
      .from('enterprise_cases')
      .select('loan_data')
      .eq('institution_id', institutionId)
      .eq('in_scope', true),
    supabase
      .from('enterprise_portfolio_metrics')
      .select('portfolio_summary, computed_at')
      .eq('institution_id', institutionId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  const cases = casesRes.data ?? []
  if (cases.length === 0) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let activeListings = 0
  let activeBuyers = 0
  let domSum = 0
  let domCount = 0
  let domOver45 = 0
  let domOver60 = 0
  let rateLockUnder14 = 0
  let rateLockUnder30 = 0
  let rateLockExpired = 0
  let priceSum = 0
  let priceCount = 0
  const bandCounts = new Map<string, number>()

  for (const c of cases) {
    const ld = (c.loan_data ?? {}) as Record<string, unknown>
    // Infer case type: explicit field takes priority; fall back to field-presence heuristic
    // (BrokerOne seed data omits case_type but has distinct fields per type)
    const caseType = (ld.case_type as string | undefined)
      ?? (ld.days_on_market !== undefined || ld.list_price !== undefined ? 'listing'
        : ld.rate_lock_expires !== undefined ? 'buyer'
        : undefined)

    if (caseType === 'listing') {
      activeListings++
      const domRaw = ld.days_on_market
      const dom = typeof domRaw === 'number' ? domRaw : typeof domRaw === 'string' ? Number(domRaw) : undefined
      if (dom !== undefined && !isNaN(dom)) {
        domSum += dom
        domCount++
        if (dom >= 45) domOver45++
        if (dom >= 60) domOver60++
      }
      const priceRaw = ld.list_price
      const price = typeof priceRaw === 'number' ? priceRaw : typeof priceRaw === 'string' ? Number(priceRaw) : undefined
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
        if (daysUntil < 0) rateLockExpired++
        else if (daysUntil < 14) rateLockUnder14++
        else if (daysUntil < 30) rateLockUnder30++
      }
    }
  }

  const BAND_ORDER = ['entry', 'entry-mid', 'mid', 'upper-mid', 'luxury']
  const priceBandDistribution = BAND_ORDER
    .filter(b => bandCounts.has(b))
    .map(b => ({ band: b, count: bandCounts.get(b)! }))

  return {
    totalCases: cases.length,
    activeListings,
    activeBuyers,
    avgDOM: domCount > 0 ? Math.round(domSum / domCount) : null,
    domOver45,
    domOver60,
    rateLockUnder14,
    rateLockUnder30,
    rateLockExpired,
    priceBandDistribution,
    avgListPrice: priceCount > 0 ? Math.round(priceSum / priceCount) : null,
    portfolioSummary: (metricsRes.data?.portfolio_summary as string | null) ?? null,
    computedAt: (metricsRes.data?.computed_at as string | null) ?? null,
  }
}
