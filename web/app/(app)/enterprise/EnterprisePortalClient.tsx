'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ObjectivesPanel } from '@/components/enterprise/ObjectivesPanel'
import { ObjectiveCard } from '@/components/enterprise/ObjectiveCard'
import { PortfolioMetricsPanel } from '@/components/enterprise/PortfolioMetricsPanel'
import { REPortfolioMetricsPanel } from '@/components/enterprise/REPortfolioMetricsPanel'
import { AskMeridianFusion } from '@/components/enterprise/AskMeridianFusion'
import { RecentlyViewedAccounts } from '@/components/enterprise/RecentlyViewedAccounts'
import { getObjectivesWithResults, getMacroEventLinkMap, getPortfolioMetrics, getREPortfolioMetrics } from '@/lib/enterprise/objectives-queries'
import { updateObjectiveState, runEnterpriseSweep, updateSignalPreferences } from './actions'
import type { ObjectiveWithResult, ObjectiveState, MacroEventLink, PortfolioMetricsData, REPortfolioMetricsData } from '@/lib/enterprise/objectives-queries'
import { InstitutionSwitcher } from '@/components/enterprise/InstitutionSwitcher'
import { ManageObjectivesPanel } from '@/components/enterprise/ManageObjectivesPanel'

interface Props {
  institutionId: string
  institutionName: string
  logoUrl?: string | null
  institutions: Array<{ id: string; name: string }>
  verticalType?: string
}

type DriftDirection = 'CRITICAL' | 'ALERT' | 'CAUTION' | 'STABLE'

interface Sweep {
  id: string
  status: string
  trigger_type: string
  cases_swept: number
  critical_count: number
  alert_count: number
  caution_count: number
  stable_count: number
  signals_used: number
  patterns_matched: number
  completed_at: string
  started_at: string
}

interface Signal {
  signal_id: string
  source: string
  direction_score: number
  direction: string
  magnitude: string
  event_text: string
  effective_date: string
}

const SIGNAL_CATEGORIES = [
  { key: 'fuel_prices',       label: 'Fuel Prices',        examples: 'National unleaded, Gulf Coast, East Coast, regional',                         defaultOn: true },
  { key: 'vehicle_market',    label: 'Vehicle Market',     examples: 'Manheim Used Vehicle Index, new vs used purchase variance, inventory levels',  defaultOn: true },
  { key: 'credit_conditions', label: 'Credit Conditions',  examples: 'National auto delinquency rate, SLOOS lending standards, consumer credit',     defaultOn: true },
  { key: 'monetary_policy',   label: 'Monetary Policy',    examples: 'Fed funds rate, FOMC decisions, rate trajectory',                              defaultOn: true },
  { key: 'labor_market',      label: 'Labor Market',       examples: 'Unemployment rate, job openings, regional employment by sector',               defaultOn: true },
  { key: 'inflation',         label: 'Inflation',          examples: 'CPI, PCE, consumer purchasing power',                                          defaultOn: true },
  { key: 'trade_tariffs',     label: 'Trade & Tariffs',    examples: 'Auto import tariffs, supply chain signals',                                    defaultOn: true },
  { key: 'cu_news',           label: 'Credit Union News',  examples: 'Industry publications, regulatory changes, member trends',                     defaultOn: false },
  { key: 'geopolitical',      label: 'Geopolitical',       examples: 'Supply chain disruptions, conflict signals, sanctions',                        defaultOn: false },
  { key: 'housing_market',    label: 'Housing Market',     examples: 'Mortgage rates, housing starts (affects consumer balance sheets)',             defaultOn: false },
]

const RE_SIGNAL_CATEGORIES = [
  { key: 'interest_rate',        label: 'Mortgage Rates',         examples: '30yr fixed, 15yr fixed, ARM rates, Fed rate decisions',                       defaultOn: true  },
  { key: 'housing_real_estate',  label: 'Housing Market',         examples: 'Housing inventory, days on market, median sale price, new listings',           defaultOn: true  },
  { key: 'regional_employment',  label: 'Regional Employment',    examples: 'Local unemployment, job openings, sector hiring in target markets',             defaultOn: true  },
  { key: 'inflation',            label: 'Inflation',              examples: 'CPI, PCE, purchasing power impact on buyers',                                   defaultOn: true  },
  { key: 'migration_population', label: 'Migration & Population', examples: 'Inbound migration trends, population growth, buyer demand signals',             defaultOn: true  },
  { key: 'energy_commodity',     label: 'Energy & Commodity',     examples: 'Construction materials, fuel costs affecting affordability and carrying costs', defaultOn: false },
  { key: 'regulatory_judicial',  label: 'Regulatory',            examples: 'Zoning changes, lending rule changes, title/escrow regulations',                defaultOn: false },
]

const DRIFT_COLORS: Record<DriftDirection, string> = {
  CRITICAL: '#ef4444',
  ALERT:    '#f97316',
  CAUTION:  '#f59e0b',
  STABLE:   '#10b981',
}

const DRIFT_BG: Record<DriftDirection, string> = {
  CRITICAL: 'rgba(239,68,68,.15)',
  ALERT:    'rgba(249,115,22,.15)',
  CAUTION:  'rgba(245,158,11,.15)',
  STABLE:   'rgba(16,185,129,.12)',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// SVG line chart for portfolio drift trend
function TrendChart({ sweeps }: { sweeps: Sweep[] }) {
  if (sweeps.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-600 text-sm gap-2">
        <div className="text-2xl">📈</div>
        <div>Trend data accumulates after 4+ weekly sweeps</div>
        <div className="text-xs text-gray-700">Chart will populate automatically each Monday</div>
      </div>
    )
  }

  const W = 560, H = 130, PL = 28, PR = 12, PT = 8, PB = 20
  const IW = W - PL - PR, IH = H - PT - PB
  const maxTotal = Math.max(...sweeps.map(s => s.cases_swept || 5), 1)

  const xScale = (i: number) => PL + (i / (sweeps.length - 1)) * IW
  const yScale = (v: number) => PT + IH - (v / maxTotal) * IH

  const series: Array<{ key: keyof Sweep; color: string; label: string }> = [
    { key: 'critical_count', color: '#ef4444', label: 'Critical' },
    { key: 'alert_count',    color: '#f97316', label: 'Alert' },
    { key: 'caution_count',  color: '#f59e0b', label: 'Caution' },
    { key: 'stable_count',   color: '#10b981', label: 'Stable' },
  ]

  const makePath = (key: keyof Sweep) =>
    sweeps.map((s, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(s[key] as number).toFixed(1)}`).join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
        {[0, 0.33, 0.67, 1].map(p => (
          <line key={p} x1={PL} x2={W - PR} y1={yScale(maxTotal * p)} y2={yScale(maxTotal * p)}
            stroke="#1f2937" strokeWidth="1" />
        ))}
        {series.map(s => (
          <path key={s.key} d={makePath(s.key)} fill="none" stroke={s.color} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map(s => sweeps.map((sw, i) => (
          <circle key={`${s.key}-${i}`} cx={xScale(i)} cy={yScale(sw[s.key] as number)} r="3.5"
            fill={s.color} stroke="#111827" strokeWidth="1.5" />
        )))}
        {sweeps.map((s, i) => (
          <text key={i} x={xScale(i)} y={H - 3} textAnchor="middle" fontSize="9" fill="#4b5563">
            {fmtShort(s.completed_at)}
          </text>
        ))}
      </svg>
      <div className="flex gap-4 mt-1 flex-wrap">
        {series.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded-full" style={{ background: s.color }} />
            <span className="text-xs text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Portfolio composition donut
function CompositionRing({ counts, total }: { counts: Record<DriftDirection, number>; total: number }) {
  if (!total) return <div className="text-gray-600 text-sm">No data</div>

  const segments = [
    { count: counts.CRITICAL, color: '#ef4444', label: 'Critical' },
    { count: counts.ALERT,    color: '#f97316', label: 'Alert' },
    { count: counts.CAUTION,  color: '#f59e0b', label: 'Caution' },
    { count: counts.STABLE,   color: '#10b981', label: 'Stable' },
  ]

  const R = 44, CX = 58, CY = 58, SW = 16
  const circ = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 116 116" style={{ width: 116, height: 116, flexShrink: 0 }}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1f2937" strokeWidth={SW} />
        {segments.map((seg, i) => {
          const dash = (seg.count / total) * circ
          const el = (
            <circle key={i} cx={CX} cy={CY} r={R} fill="none"
              stroke={seg.color} strokeWidth={SW}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          )
          offset += dash
          return el
        })}
        <text x={CX} y={CY - 5} textAnchor="middle" fontSize="22" fontWeight="800" fill="white">{total}</text>
        <text x={CX} y={CY + 11} textAnchor="middle" fontSize="8" fill="#6b7280" letterSpacing="1">ACCOUNTS</text>
      </svg>
      <div className="space-y-2.5 flex-1">
        {segments.map(seg => (
          <div key={seg.label}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: seg.color }} className="font-semibold">{seg.label}</span>
              <span className="text-gray-400 font-mono">{seg.count} · {total > 0 ? Math.round(seg.count / total * 100) : 0}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${(seg.count / total) * 100}%`, background: seg.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Parse signal into label / value / delta
function parseSignalDisplay(s: Signal): { label: string; value: string; delta: string; isNeg: boolean } {
  const text = s.event_text || ''
  const colon = text.indexOf(':')
  let label = colon > -1 ? text.slice(0, colon).trim() : s.signal_id.replace(/^(FRED|EIA|BLS|GDELT):/, '').replace(/_/g, ' ')
  const rest = colon > -1 ? text.slice(colon + 1).trim() : text
  if (label.length > 42) label = label.slice(0, 40) + '…'
  const parenMatch = rest.match(/^(.+?)\s*\((.+)\)/)
  const value = parenMatch ? parenMatch[1].trim() : rest.slice(0, 22)
  const delta = parenMatch ? parenMatch[2].trim() : s.magnitude || ''
  const isNeg = s.direction_score < 0
  const arrow = isNeg ? '▼' : s.direction_score > 0 ? '▲' : '→'
  return { label, value, delta: delta ? `${arrow} ${delta}` : `${arrow} Score: ${s.direction_score}`, isNeg }
}

function FusionCard({ signal }: { signal: Signal }) {
  const { label, value, delta, isNeg } = parseSignalDisplay(signal)
  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#8AB4D4', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#ffffff', fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 10, marginTop: 3, color: isNeg ? '#f87171' : '#34d399' }}>{delta}</div>
    </div>
  )
}

// Signal preferences modal
function CustomizeModal({
  prefs,
  onSave,
  onClose,
  categories,
}: {
  prefs: Record<string, boolean>
  onSave: (p: Record<string, boolean>) => void
  onClose: () => void
  categories: typeof SIGNAL_CATEGORIES
}) {
  const [local, setLocal] = useState<Record<string, boolean>>(prefs)

  const toggle = (key: string) =>
    setLocal(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="font-semibold text-white">Customize Signal Feed</div>
            <div className="text-xs text-gray-500 mt-0.5">Choose which signal categories appear in Live Fusion Data</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
          {categories.map(cat => (
            <label key={cat.key} className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={local[cat.key] ?? cat.defaultOn}
                onChange={() => toggle(cat.key)}
                className="mt-0.5 accent-blue-500 flex-shrink-0"
              />
              <div>
                <div className="text-sm font-medium text-gray-200 group-hover:text-white transition">{cat.label}</div>
                <div className="text-xs text-gray-600">{cat.examples}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-gray-800 flex gap-3 justify-end">
          <button onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition">
            Cancel
          </button>
          <button onClick={() => onSave(local)}
            className="text-sm px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-semibold transition">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default function EnterprisePortalClient({ institutionId, institutionName, logoUrl, institutions, verticalType = 'auto_finance' }: Props) {
  const isRE = verticalType === 'real_estate'
  const activeCategories = isRE ? RE_SIGNAL_CATEGORIES : SIGNAL_CATEGORIES

  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const iid = searchParams.get('iid')
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [sweepHistory, setSweepHistory] = useState<Sweep[]>([])
  const [liveCounts, setLiveCounts] = useState<Record<DriftDirection, number>>({ CRITICAL: 0, ALERT: 0, CAUTION: 0, STABLE: 0 })
  const [portalCases, setPortalCases] = useState<{ id: string; region: string; drift_tier: DriftDirection; drift_score: number }[]>([])
  const [keySignals, setKeySignals] = useState<Signal[]>([])
  const [objectives, setObjectives] = useState<ObjectiveWithResult[]>([])
  const [linkMap, setLinkMap] = useState<Map<string, MacroEventLink>>(new Map())
  const [portfolioMetrics, setPortfolioMetrics] = useState<PortfolioMetricsData | null>(null)
  const [rePortfolioMetrics, setREPortfolioMetrics] = useState<REPortfolioMetricsData | null>(null)
  const [signalPrefs, setSignalPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(activeCategories.map(c => [c.key, c.defaultOn]))
  )
  const [loading, setLoading] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<number>(30)
  const [portfolioTab, setPortfolioTab] = useState<'Overview' | 'Regions' | 'Cohorts'>('Overview')
  const [showCustomize, setShowCustomize] = useState(false)
  const [changingObjectiveId, setChangingObjectiveId] = useState<string | null>(null)
  // FF-050
  const [isAdmin, setIsAdmin] = useState(false)
  const [showManagePanel, setShowManagePanel] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Latest complete sweep
      const { data: sweeps } = await supabase
        .from('enterprise_sweeps')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('status', 'complete')
        .order('completed_at', { ascending: false })
        .limit(1)
      const latestSweep = sweeps?.[0] ?? null
      setSweep(latestSweep)

      // Trend history (up to 13 sweeps = ~quarter)
      const { data: hist } = await supabase
        .from('enterprise_sweeps')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('status', 'complete')
        .order('completed_at', { ascending: false })
        .limit(13)
      setSweepHistory([...(hist ?? [])].reverse())

      // Live tier counts: fetch cases directly (no agent join — agent_id is null
      // on demo cases and the broker_agents join would filter them out), then
      // read the latest drift_tier per case from enterprise_case_history.
      const { data: casesRaw } = await supabase
        .from('enterprise_cases')
        .select('id, region')
        .eq('institution_id', institutionId)
        .eq('in_scope', true)

      const casesList = casesRaw ?? []
      const caseIds = casesList.map((c: any) => c.id as string)

      const histMap = new Map<string, { drift_tier: string; drift_score: number }>()
      if (caseIds.length > 0) {
        const { data: histRaw } = await supabase
          .from('enterprise_case_history')
          .select('case_id, drift_tier, drift_score')
          .in('case_id', caseIds)
          .not('drift_tier', 'is', null)
          .order('snapshot_at', { ascending: false })
        for (const row of histRaw ?? []) {
          if (!histMap.has(row.case_id)) histMap.set(row.case_id, row as any)
        }
      }

      const counts: Record<DriftDirection, number> = { CRITICAL: 0, ALERT: 0, CAUTION: 0, STABLE: 0 }
      const enriched = casesList.map((c: any) => {
        const h = histMap.get(c.id)
        const tier = ((h?.drift_tier as string) ?? 'STABLE') as DriftDirection
        counts[tier]++
        return { id: c.id as string, region: (c.region as string) ?? 'Unknown', drift_tier: tier, drift_score: (h?.drift_score as number) ?? 0 }
      })
      setLiveCounts(counts)
      setPortalCases(enriched)

      // Key fusion signals: diverse sources, most negative first
      const since = new Date()
      since.setDate(since.getDate() - 60)
      const { data: sigs } = await supabase
        .from('market_signals')
        .select('signal_id, source, direction_score, direction, magnitude, event_text, effective_date')
        .gte('effective_date', since.toISOString().split('T')[0])
        .overlaps('sector_tags', [verticalType, 'all'])
        .order('direction_score', { ascending: true })
        .limit(200)

      const seen = new Map<string, Signal>()
      for (const s of (sigs ?? [])) {
        if (!seen.has(s.signal_id)) seen.set(s.signal_id, s)
      }

      const all = Array.from(seen.values()).sort((a, b) => a.direction_score - b.direction_score)
      const sourceSeen = new Set<string>()
      const top6: Signal[] = []
      for (const s of all) {
        if (top6.length >= 6) break
        if (!sourceSeen.has(s.source)) { top6.push(s); sourceSeen.add(s.source) }
      }
      for (const s of all) {
        if (top6.length >= 6) break
        if (!top6.includes(s)) top6.push(s)
      }
      setKeySignals(top6)

      // Objectives + latest results
      const objs = await getObjectivesWithResults(supabase, institutionId)
      setObjectives(objs ?? [])

      // Macro event link map for POS signal hyperlinks
      const lm = await getMacroEventLinkMap(supabase)
      setLinkMap(lm)

      // Portfolio health metrics panel — vertical-aware
      if (isRE) {
        const rpm = await getREPortfolioMetrics(supabase, institutionId)
        setREPortfolioMetrics(rpm)
      } else {
        const pm = await getPortfolioMetrics(supabase, institutionId)
        setPortfolioMetrics(pm)
      }

      // Institution signal preferences from config
      const { data: inst } = await supabase
        .from('enterprise_institutions')
        .select('config')
        .eq('id', institutionId)
        .single()
      const savedPrefs = (inst?.config as any)?.signal_preferences
      if (savedPrefs && typeof savedPrefs === 'object') {
        setSignalPrefs(prev => ({ ...prev, ...savedPrefs }))
      }

      // FF-050: admin check — drives "Manage Objectives" button visibility
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (currentUser) {
        const { data: member } = await supabase
          .from('enterprise_members')
          .select('role')
          .eq('institution_id', institutionId)
          .eq('user_id', currentUser.id)
          .single()
        setIsAdmin((member as { role?: string } | null)?.role === 'admin')
      }

    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [institutionId, supabase, isRE, verticalType])

  useEffect(() => { loadAll() }, [loadAll])

  const runSweep = async () => {
    setSweeping(true)
    setError(null)
    try {
      const result = await runEnterpriseSweep(institutionId)
      if (!result?.ok) throw new Error(result?.error ?? 'Sweep failed')
      await loadAll()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSweeping(false)
    }
  }

  const handleObjectiveStateChange = async (objectiveId: string, newState: ObjectiveState) => {
    setChangingObjectiveId(objectiveId)
    try {
      const result = await updateObjectiveState(objectiveId, newState)
      if (!result.ok) throw new Error(result.error ?? 'State change failed')
      await loadAll()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setChangingObjectiveId(null)
    }
  }

  const handleSavePrefs = async (prefs: Record<string, boolean>) => {
    setSignalPrefs(prefs)
    setShowCustomize(false)
    await updateSignalPreferences(institutionId, prefs)
  }

  // Regional movers: group enriched cases by region, rank by avg drift score
  const regionalData = (() => {
    const dirOrder: Record<DriftDirection, number> = { CRITICAL: 4, ALERT: 3, CAUTION: 2, STABLE: 1 }
    const map = new Map<string, { count: number; totalScore: number; worst: DriftDirection }>()
    for (const c of portalCases) {
      const region = c.region ?? 'Unknown'
      const cur = map.get(region) ?? { count: 0, totalScore: 0, worst: 'STABLE' as DriftDirection }
      map.set(region, {
        count: cur.count + 1,
        totalScore: cur.totalScore + c.drift_score,
        worst: dirOrder[c.drift_tier] > dirOrder[cur.worst] ? c.drift_tier : cur.worst,
      })
    }
    return Array.from(map.entries())
      .map(([region, d]) => ({ region, ...d, avgScore: Math.round(d.totalScore / d.count) }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 5)
  })()

  const liteObjs = objectives.filter(o => o.objective_state === 'monitoring_lite')
  const objTitleMap = new Map(objectives.map(o => [o.obj_id, o.title]))

  // Meridian Fusion Insight — AI-generated narrative stored by sweep engine (B1)
  // For RE: suppress auto-finance summary until an RE-aware sweep has run
  const fusionInsight = isRE ? null : (portfolioMetrics?.portfolioSummary ?? null)

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading intelligence portal...</p>
      </div>
    </div>
  )

  return (
    <div className="mx-auto px-4 py-6" style={{ maxWidth: '1680px' }}>
    <div className="flex gap-5 items-start">

      {/* LEFT RAIL — hidden below xl */}
      <aside className="hidden xl:flex flex-col gap-3 w-52 flex-shrink-0 sticky top-6">
        <RecentlyViewedAccounts />
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 min-w-0 space-y-5">

      {showCustomize && (
        <CustomizeModal
          prefs={signalPrefs}
          onSave={handleSavePrefs}
          onClose={() => setShowCustomize(false)}
          categories={activeCategories}
        />
      )}

      {/* FF-050: Manage Objectives slide-over */}
      <ManageObjectivesPanel
        open={showManagePanel}
        onClose={() => setShowManagePanel(false)}
        institutionId={institutionId}
        verticalType={verticalType}
        onObjectivesChanged={loadAll}
      />

      {/* HEADER — institution branding */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <Image src={logoUrl} alt={institutionName} width={80} height={40} className="h-10 w-auto object-contain flex-shrink-0" unoptimized />
          ) : (
            <div className="w-10 h-10 rounded-full bg-yellow-600 flex items-center justify-center flex-shrink-0 text-white font-black text-lg">
              {institutionName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">{institutionName}</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Meridian Fusion Intelligence Portal
              {sweep && ` · Last sweep ${fmtDate(sweep.completed_at)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}><InstitutionSwitcher institutions={institutions} /></Suspense>
          {/* FF-050: Manage Objectives — admin only */}
          {isAdmin && (
            <button
              onClick={() => setShowManagePanel(true)}
              className="text-sm font-medium text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 transition"
            >
              Manage Objectives
            </button>
          )}
          <button onClick={() => { router.refresh(); loadAll() }}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg px-3 py-1.5 transition">
            Refresh
          </button>
          <button onClick={runSweep} disabled={sweeping}
            className="text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-1.5 transition">
            {sweeping ? 'Running Sweep...' : 'Run Sweep Now'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {/* RISK SUMMARY CARDS — counts from enterprise_case_history, not stale sweep metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['CRITICAL','ALERT','CAUTION','STABLE'] as DriftDirection[]).map(d => {
          const subtitles = {
            CRITICAL: 'Loss mitigation now',
            ALERT: 'Outreach within 72hrs',
            CAUTION: 'Monitor weekly',
            STABLE: 'No action needed',
          }
          return (
            <div key={d} style={{ background: DRIFT_BG[d], borderColor: DRIFT_COLORS[d] + '55' }}
              className="rounded-xl border p-3 sm:p-5 text-center">
              <div className="text-3xl sm:text-5xl font-black leading-none" style={{ color: DRIFT_COLORS[d] }}>{liveCounts[d]}</div>
              <div className="text-xs font-bold tracking-widest mt-2" style={{ color: DRIFT_COLORS[d] }}>{d}</div>
              <div className="text-xs text-gray-500 mt-1">{subtitles[d]}</div>
            </div>
          )
        })}
      </div>

      {/* PORTFOLIO SECTION — tabbed */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="font-semibold text-sm text-white">Portfolio Intelligence</div>
          <div className="flex gap-1">
            {(['Overview', 'Regions', 'Cohorts'] as const).map(tab => (
              <button key={tab} onClick={() => setPortfolioTab(tab)}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${
                  portfolioTab === tab
                    ? 'bg-blue-900/60 text-blue-300 font-semibold'
                    : 'text-gray-500 hover:text-gray-300'
                }`}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        {portfolioTab === 'Overview' && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-gray-500">Account risk tier movement across sweep history</div>
                <div className="text-xs text-gray-600 font-mono">{sweepHistory.length} sweep{sweepHistory.length !== 1 ? 's' : ''}</div>
              </div>
              <TrendChart sweeps={sweepHistory} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-3">Current risk tier breakdown</div>
              {portalCases.length > 0
                ? <CompositionRing counts={liveCounts} total={portalCases.length} />
                : <div className="text-gray-600 text-sm text-center py-8">Run a sweep to see composition</div>}
            </div>
          </div>
        )}

        {portfolioTab === 'Regions' && (
          <div>
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
              <div className="text-xs text-gray-500">Regional Risk Movers — ranked by average drift score</div>
              <select value={timeRange} onChange={e => setTimeRange(Number(e.target.value))}
                className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-gray-300 outline-none">
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={45}>Last 45 days</option>
                <option value={60}>Last 60 days</option>
              </select>
            </div>
            <div className="divide-y divide-gray-800/50">
              {regionalData.map((r, i) => (
                <div key={r.region} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="text-2xl font-black text-gray-800 w-7 text-center">#{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-semibold text-gray-100 text-sm">{r.region}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{ background: DRIFT_BG[r.worst], color: DRIFT_COLORS[r.worst] }}>
                        {r.worst}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${r.avgScore}%`, background: DRIFT_COLORS[r.worst] }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: DRIFT_COLORS[r.worst] }}>
                        {r.avgScore}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 text-right">
                    {r.count} account{r.count !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
              {regionalData.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-600 text-sm">
                  Regional data appears after your first sweep
                </div>
              )}
            </div>
          </div>
        )}

        {portfolioTab === 'Cohorts' && (
          <div className="px-4 py-10 text-center text-gray-600 text-sm">
            <div className="text-2xl mb-2">🔬</div>
            <div className="font-semibold text-gray-500 mb-1">Cohort Pattern Analysis</div>
            <div className="text-xs">High-risk cohort data is written by the sweep engine — run a sweep to populate.</div>
          </div>
        )}
      </div>

      {/* MERIDIAN FUSION INSIGHT — above main grid */}
      {fusionInsight && (
        <div className="rounded-xl border border-blue-800/40 p-5"
          style={{ background: 'linear-gradient(135deg, rgba(30,58,138,.2) 0%, rgba(15,23,42,.4) 100%)' }}>
          <div className="flex items-start gap-4">
            <div className="text-blue-400 text-xl mt-0.5 flex-shrink-0">◈</div>
            <div>
              <div className="text-xs font-bold text-blue-400 tracking-widest mb-2">MERIDIAN FUSION INSIGHT</div>
              <p className="text-sm text-gray-100 leading-relaxed">{fusionInsight}</p>
            </div>
          </div>
        </div>
      )}

      {/* MAIN GRID — left: Focus objectives · right: Monitoring Lite + Live Fusion Data */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* LEFT — Focus objectives (Monitoring Lite hidden here, moved right) */}
        <ObjectivesPanel
          objectives={objectives}
          onStateChange={handleObjectiveStateChange}
          onSweepRequest={runSweep}
          sweepInProgress={sweeping}
          hideLite={true}
          linkMap={linkMap}
          objTitleMap={objTitleMap}
          lastSweepAt={objectives.flatMap(o => o.latest_result ? [o.latest_result.computed_at] : []).sort().at(-1) ?? null}
        />

        {/* RIGHT column */}
        <div className="flex flex-col gap-4">

          {/* Portfolio Health Metrics — vertical-aware */}
          {isRE
            ? rePortfolioMetrics && <REPortfolioMetricsPanel data={rePortfolioMetrics} />
            : portfolioMetrics && <PortfolioMetricsPanel data={portfolioMetrics} />
          }

          {/* Monitoring Lite */}
          {liteObjs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                <span className="text-xs font-bold text-blue-400 tracking-widest uppercase">Monitoring Lite ({liteObjs.length})</span>
              </div>
              <div className="p-4 space-y-3">
                {liteObjs.map(obj => (
                  <ObjectiveCard
                    key={obj.id}
                    objective={obj}
                    onStateChange={handleObjectiveStateChange}
                    changingState={changingObjectiveId === obj.id}
                    linkMap={linkMap}
                    objTitleMap={objTitleMap}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Live Fusion Data with Customize link */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#0D1B3E', border: '1px solid rgba(46,124,184,0.2)' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <div className="font-semibold text-sm" style={{ color: '#ffffff' }}>Live Fusion Data</div>
                <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {`${keySignals.length} active signal stream${keySignals.length !== 1 ? 's' : ''} · ${isRE ? 'Freddie Mac · NAR · FRED · MBA' : 'FRED · EIA · BLS · GDELT'}`}
                </div>
              </div>
              <button
                onClick={() => setShowCustomize(true)}
                className="text-xs font-semibold hover:underline"
                style={{ color: '#2D6BE4' }}
              >
                Customize →
              </button>
            </div>
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <>
                {keySignals.map(s => <FusionCard key={s.signal_id} signal={s} />)}
                {keySignals.length === 0 && (
                  <div style={{ gridColumn: '1/-1', padding: '24px 0', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    {isRE ? 'Mortgage rates, housing inventory & DOM signals will appear after the first RE sweep' : 'Signals ingest weekly — check back Monday'}
                  </div>
                )}
              </>
            </div>
          </div>

        </div>
      </div>

      {/* ASK MERIDIAN FUSION */}
      <AskMeridianFusion institutionId={institutionId} />

      {/* PORTFOLIO SWEEP INTELLIGENCE REPORT */}
      <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div>
          <div className="font-semibold text-sm text-white">Portfolio Sweep Intelligence Report</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Per-account risk flags · Fusion signal breakdown · Recommended actions
          </div>
        </div>
        <a href={`/enterprise/report${iid ? `?iid=${iid}` : ''}`}
          className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
          View Full Report →
        </a>
      </div>

      {/* FOOTER DISCLAIMER */}
      <div className="border-t border-gray-800 pt-3 pb-1 text-center">
        <p className="text-[11px] text-gray-700">
          Meridian Arc surfaces AI-generated insights — always use your own judgment for major decisions.
        </p>
      </div>

      </div>

      {/* RIGHT RAIL — hidden below xl */}
      <aside className="hidden xl:flex flex-col gap-1.5 w-40 flex-shrink-0 sticky top-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-800">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Quick Links</div>
          </div>
          <div className="p-2 flex flex-col gap-0.5">
            {[
              { label: 'Account',             href: '/settings' },
              { label: 'Settings',            href: '/settings' },
              { label: 'Terms & Conditions',  href: '/legal' },
              { label: 'Help',                href: '/faq' },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="text-[12px] text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors block text-center"
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </aside>

    </div>
    </div>
  )
}
