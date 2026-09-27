'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { formatLoanStatus } from '@/lib/enterprise/format-utils'
import { VerticalReportHeader } from '@/components/enterprise/vertical/VerticalReportHeader'
import type { VerticalConfig } from '@/lib/vertical/verticalTypes'
import { updateCaseFeedback, updateCaseAlias } from '../actions'
import { displayCase } from '@/lib/enterprise/displayUtils'
import { ExpandableSection } from '@/components/enterprise/ExpandableSection'
import type { CaseMap } from '@/components/enterprise/ExpandableSection'
import { CaseActionTracker } from '@/components/enterprise/CaseActionTracker'
import { InfoTooltip } from '@/components/enterprise/InfoTooltip'
import { CloseCaseModal } from '@/components/enterprise/CloseCaseModal'
import type { CaseAction } from './page'

interface SnapshotEntry {
  drift_score: number
  drift_direction: string
  confidence_pct: number
}

interface Props {
  institutionId: string
  institutionName: string
  highlight?: string | null
  verticalConfig?: VerticalConfig | null
  caseActionsMap?: Record<string, CaseAction[]>
  snapshotMap?: Record<string, SnapshotEntry>
}

type Dir = 'CRITICAL' | 'ALERT' | 'CAUTION' | 'STABLE'
type ForwardStatus = 'CRITICAL' | 'ALERT' | 'CAUTION' | 'WATCH' | 'STABLE'
type TrendDir = 'up' | 'down' | 'flat'
type PopupType = 'implies' | 'todo' | 'adjust'

// FF-061D: per-objective signal attached to a case (from caseObjectiveMap)
interface ObjectiveFlag {
  obj_id: string
  title: string
  confidence_score: number
  escalated_to_focus: boolean
}

// Raw row from enterprise_cases
interface CaseRow {
  id: string
  case_ref: string
  case_alias?: string | null
  case_type: string | null
  region: string
  fico_band: string
  vehicle_class: string
  loan_status: string
  ltv_ratio: number
  dti_ratio: number
  current_balance: number
  payments_remaining: number
  loan_data: any
}

// Supplementary fields from enterprise_predictions (optional — not all cases have preds)
interface PredExtra {
  top_signals: string[]
  recommended_action: string
  confidence_pct: number
}

// Per-case user feedback
interface CaseFeedback {
  id?: string
  user_confidence?: number | null
  user_trend_override?: 'improving' | 'declining' | 'stable' | null
  user_action?: string | null
  user_status?: 'working_it' | 'escalated' | 'resolved' | 'monitoring' | null
}

// Merged case: cases + latest history + optional prediction extras + FF-051 trend + feedback
interface EnrichedCase {
  id: string
  case_ref: string
  case_alias?: string | null
  case_type: string | null
  region: string
  fico_band: string
  vehicle_class: string
  ec_loan_status: string
  ltv_ratio: number
  dti_ratio: number
  current_balance: number
  payments_remaining: number
  loan_data: any
  drift_tier: Dir
  drift_score: number
  scored_status: string | null
  scored_dpd: number | null
  pred?: PredExtra
  // FF-051 additions
  trendDirection: TrendDir
  trendDelta: number        // drift_score change over last 5 snapshots (positive = worsening)
  trendPoints: number[]     // last 5 drift scores oldest→newest
  feedback?: CaseFeedback
}

const OUTCOME_TOOLTIP: Record<string, string> = {
  CRITICAL: 'High probability of loss event within 90 days based on signal fusion',
  ALERT:    'Elevated probability of delinquency progression within 60 days',
  CAUTION:  'Moderate early drift signals detected; monitoring recommended',
  STABLE:   'No significant risk signals detected in current sweep window',
}

interface Sweep {
  id: string
  completed_at: string
  cases_swept: number
  critical_count: number
  alert_count: number
  caution_count: number
  stable_count: number
  signals_used: number
}

interface Signal {
  signal_id: string
  source: string
  direction_score: number
  event_text: string
  effective_date: string
  magnitude: string
}

interface EnterpriseObjectiveResult {
  objective_id: string
  affecting_it: string | null
  implies: string | null
  what_to_do: string | null
  confidence_score: number | null
  escalated_to_focus: boolean | null
  computed_at: string
  key_case_refs: string[] | null
}

interface EnterpriseObjective {
  id: string
  obj_id: string
  title: string
  statement: string
  lifecycle_state: string
  objective_state: string | null
}

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  navy:     '#1B2A4A',
  blue:     '#2D6BE4',
  gold:     '#C8A84B',
  critical: '#C0392B',
  alert:    '#D35400',
  caution:  '#D4AC0D',
  watch:    '#D97706',
  stable:   '#1E8449',
  bg:       '#F0F3F8',
  card:     '#FFFFFF',
  text:     '#1A1A2E',
  muted:    '#6B7280',
  border:   '#DDE3EE',
  lightBlue:'#EAF0FB',
}

const DIR: Record<Dir, string> = {
  CRITICAL: C.critical, ALERT: C.alert, CAUTION: C.caution, STABLE: C.stable,
}

const FORWARD_DIR: Record<ForwardStatus, string> = {
  CRITICAL: C.critical, ALERT: C.alert, CAUTION: C.caution, WATCH: C.watch, STABLE: C.stable,
}

const USER_STATUS_LABELS: Record<string, string> = {
  working_it: 'Working It',
  escalated:  'Escalated',
  resolved:   'Resolved',
  monitoring: 'Monitoring',
}

const USER_STATUS_COLORS: Record<string, string> = {
  working_it: C.alert,
  escalated:  C.critical,
  resolved:   C.stable,
  monitoring: C.blue,
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtLTV(r: number | null) { return r ? `${Math.round(r)}%` : '—' }

function parseSignal(s: Signal): { label: string; value: string; delta: string; isNeg: boolean } {
  const text = s.event_text || ''
  const colon = text.indexOf(':')
  let label = colon > -1 ? text.slice(0, colon).trim() : s.signal_id
  const rest  = colon > -1 ? text.slice(colon + 1).trim() : text
  if (label.length > 40) label = label.slice(0, 38) + '…'
  const parenMatch = rest.match(/^(.+?)\s*\((.+)\)/)
  const value = parenMatch ? parenMatch[1].trim() : rest.slice(0, 20)
  const delta = parenMatch ? parenMatch[2].trim() : s.magnitude || ''
  const isNeg = s.direction_score < 0
  const arrow = isNeg ? '▼' : s.direction_score > 0 ? '▲' : '→'
  return { label, value, delta: delta ? `${arrow} ${delta}` : `${arrow} Score: ${s.direction_score}`, isNeg }
}

// ── FF-061D: Forward trajectory status ────────────────────────────────────
function computeForwardStatus(snapshotTier: string, objectiveFlags: ObjectiveFlag[]): ForwardStatus {
  if (snapshotTier === 'critical') return 'CRITICAL'
  if (snapshotTier === 'alert') return 'ALERT'
  const highUrgency = objectiveFlags.some(f => f.confidence_score >= 0.6 && f.escalated_to_focus === true)
  const mediumUrgency = objectiveFlags.some(f => f.confidence_score >= 0.4)
  if (highUrgency) return 'CAUTION'
  if (mediumUrgency) return 'WATCH'
  return snapshotTier === 'caution' ? 'CAUTION' : 'STABLE'
}

// ── 5-Day Trend helpers ────────────────────────────────────────────────────
function computeTrend(points: number[]): { direction: TrendDir; delta: number } {
  if (points.length < 2) return { direction: 'flat', delta: 0 }
  const delta = points[points.length - 1] - points[0]
  return {
    direction: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat',
    delta: Math.round(delta),
  }
}

// In context of drift: up = worsening (red), down = improving (green), flat = gray
function TrendArrow({ direction, delta }: { direction: TrendDir; delta: number }) {
  const TREND = {
    up:   { symbol: '↑', color: C.critical, label: `+${delta}` },
    down: { symbol: '↓', color: C.stable,   label: `${delta}`  },
    flat: { symbol: '→', color: C.muted,    label: '—'         },
  }
  const t = TREND[direction]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: t.color }}>{t.symbol}</span>
      <span style={{ fontSize: 9, color: t.color, fontWeight: 600 }}>{t.label}</span>
    </span>
  )
}

// ── "What this implies" derivation ────────────────────────────────────────
function buildImplies(ec: EnrichedCase, isRE: boolean): string {
  const ld = (ec.loan_data ?? {}) as Record<string, unknown>
  if (isRE) {
    const caseType = (ld.case_type as string) === 'buyer' ? 'buyer' : 'listing'
    const dom = typeof ld.days_on_market === 'number' ? ld.days_on_market : null
    const listPrice = typeof ld.list_price === 'number' ? `$${ld.list_price.toLocaleString()}` : null
    const rateLock = ld.rate_lock_expires as string | undefined
    if (caseType === 'listing') {
      if (ec.drift_tier === 'CRITICAL') {
        return `This listing${dom ? ` at ${dom} days on market` : ''} has crossed into critical territory — sustained time-on-market at this level statistically correlates with final sale prices 6–12% below original list price. Buyer pool attention is dropping as listings age past 60 days in most MLS systems, and the macro signal environment (rising average DOM, flat purchase index) is not providing a tailwind. A price repositioning or incentive strategy is needed within the next 7 days to avoid further erosion.`
      }
      if (ec.drift_tier === 'ALERT') {
        return `This listing${dom ? ` (${dom} days on market)` : ''} is approaching the threshold where algorithmic MLS deprioritization begins — most platforms reduce listing placement after 45 days. ${listPrice ? `At ${listPrice}, ` : ''}Fusion detects it is entering the price-band zone where buyer hesitation typically increases. This is an early-intervention window: action taken now prevents a costlier correction later.`
      }
      if (ec.drift_tier === 'CAUTION') {
        return `This listing is showing early drift signals but has not yet entered alert range. Day-on-market accumulation is the primary metric to watch. The external macro environment — ${ec.pred?.top_signals?.[0] ?? 'current rate environment'} — is creating moderate headwinds for the mid-market segment. Proactive seller communication and listing refresh activity is recommended at this stage.`
      }
      return `This listing is within normal market absorption range. Fusion signals for this price band and region are mixed but not showing concentrated headwinds. Standard monitoring applies — no immediate action required, but rate environment shifts should be tracked weekly.`
    } else {
      // buyer case
      const lockDate = rateLock ? new Date(rateLock).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
      if (ec.drift_tier === 'CRITICAL') {
        return `This buyer's rate lock${lockDate ? ` (expiring ${lockDate})` : ''} has either expired or expires within 14 days — placing them in the highest-risk category for transaction collapse. If the lock lapses without extension or close, the buyer faces current market rates which may disqualify them from the original price point. Fusion also detects that the purchase application index is declining, meaning fewer backup buyer options exist if this transaction falls through.`
      }
      if (ec.drift_tier === 'ALERT') {
        return `This buyer's rate lock is expiring soon${lockDate ? ` on ${lockDate}` : ''}, creating a hard deadline for closing or extension. The current rate environment means an unextended lock would expose the buyer to a higher rate, potentially affecting their DTI qualification. Time-sensitive coordination with the lender is required to secure an extension or accelerate the closing timeline.`
      }
      return `This buyer file is within normal processing windows. Rate lock timeline is not immediately at risk, and Fusion signals show no acute macro headwinds for this buyer profile. Standard transaction monitoring applies.`
    }
  }

  // Auto finance
  if (ec.drift_tier === 'CRITICAL') {
    return `This account is showing fusion signal patterns consistent with high-probability loss events within 90 days. The drift score of ${ec.drift_score}/100 reflects compounding risk across multiple dimensions — not a single payment miss, but a convergence of external signals (${ec.pred?.top_signals?.[0] ?? 'macro pressure'}) with deteriorating repayment trajectory. Standard delinquency monitoring would not have surfaced this yet — this is precisely the "known unknown" Fusion is designed to catch before it becomes visible in payment data.`
  }
  if (ec.drift_tier === 'ALERT') {
    return `This account's fusion signal stack is trending toward delinquency progression within 60 days. A drift score of ${ec.drift_score}/100 combined with ${ec.region} regional employment signals and the current collateral value environment creates compounding pressure that typically precedes 30-day delinquency by 45–60 days. This account is in the intervention window — action taken now is 4–6× more cost-effective than post-delinquency workout.`
  }
  if (ec.drift_tier === 'CAUTION') {
    return `Early-stage drift signals are present but have not reached alert thresholds. The fusion engine detects ${ec.pred?.top_signals?.[0] ?? 'external macro signals'} creating background pressure on this account's segment. Monitoring cadence should increase and proactive outreach is recommended to establish contact before any payment stress materializes.`
  }
  return `No significant risk signals detected in the current sweep window. This account has a drift score of ${ec.drift_score}/100, well within normal parameters. Fusion continues monitoring — any directional changes in the external signal environment will be reflected in the next scheduled sweep.`
}

// ── "What to Do" action list derivation ───────────────────────────────────
function buildToDo(ec: EnrichedCase, isRE: boolean): string[] {
  const ld = (ec.loan_data ?? {}) as Record<string, unknown>
  if (isRE) {
    const caseType = (ld.case_type as string) === 'buyer' ? 'buyer' : 'listing'
    const dom = typeof ld.days_on_market === 'number' ? ld.days_on_market : null
    if (caseType === 'listing') {
      if (ec.drift_tier === 'CRITICAL') return [
        `Schedule seller call within 48 hours — present price-band comparative analysis and recommend 3–5% list price reduction`,
        `Request professional photography refresh and update listing description if not done in last 30 days`,
        `Identify 2–3 qualified buyer prospects from active buyer pool and arrange targeted showings before MLS algorithm deprioritizes`,
        `Evaluate open house cadence — weekly open houses in the 60+ DOM window have shown 2.3× higher conversion than passive listing`,
      ]
      if (ec.drift_tier === 'ALERT') return [
        dom && dom >= 45
          ? `List is at ${dom} DOM — contact seller with market absorption data and a 2–3% price adjustment recommendation`
          : `Monitor DOM weekly; prepare price adjustment presentation if listing crosses 45-day threshold`,
        `Refresh listing syndication: re-upload photos to Zillow/Redfin, update "New Price" status flag in MLS`,
        `Cross-reference against buyer database — identify buyer profiles matching this price band and send direct outreach`,
        `Add to next week's priority follow-up call list with seller for progress update`,
      ]
      return [
        `No immediate action required — add to standard weekly check-in rotation`,
        `Confirm seller communication is current (last 7 days)`,
        `Monitor DOM progression — if approaching 30 days, initiate pre-emptive buyer outreach strategy`,
      ]
    } else {
      if (ec.drift_tier === 'CRITICAL') return [
        `Contact buyer's lender TODAY — request rate lock extension or determine extension cost`,
        `Accelerate closing checklist: confirm title, appraisal, and final walk-through are scheduled within the lock window`,
        `If lock cannot be extended at acceptable cost, prepare buyer for rate scenario analysis at current market rate`,
        `Document all lender communications and set 24-hour follow-up reminders until resolved`,
      ]
      if (ec.drift_tier === 'ALERT') return [
        `Call lender to confirm rate lock extension availability and cost — lock cost risk increases daily`,
        `Coordinate with all parties (title, escrow, inspection) to identify any remaining closing blockers`,
        `Set automated reminder for 7 days before lock expiration as hard deadline for closing or extension`,
      ]
      return [
        `Confirm closing timeline is on track with all parties`,
        `Monitor rate lock expiration date — flag for proactive review if within 30 days`,
      ]
    }
  }

  // Auto finance
  if (ec.pred?.recommended_action) {
    return [
      ec.pred.recommended_action,
      `Increase monitoring frequency to weekly for this account until drift score improves below ${ec.drift_tier === 'CRITICAL' ? 60 : 40}`,
      `Document outreach attempt and outcome in CRM within 48 hours of contact`,
    ]
  }
  if (ec.drift_tier === 'CRITICAL') return [
    `Initiate loss mitigation contact within 24 hours — review modification, extension, or refinance eligibility`,
    `Pull full payment history and confirm most recent payment status before outreach`,
    `Escalate to senior relationship manager for accounts with current balance over $15,000`,
    `Log all contact attempts and outcomes; flag for next sweep prioritization if no response within 72 hours`,
  ]
  if (ec.drift_tier === 'ALERT') return [
    `Schedule proactive outreach call within 5 business days — position as "account review" rather than collections call`,
    `Review account for early modification or payment arrangement eligibility before the next payment cycle`,
    `Flag for monitoring in next weekly sweep — verify drift score trajectory`,
  ]
  if (ec.drift_tier === 'CAUTION') return [
    `Add to outreach rotation — contact within 2 weeks with a satisfaction or check-in call`,
    `Review for any existing hardship or deferment requests on file`,
    `No payment accommodation needed yet — early relationship contact is the action`,
  ]
  return [
    `No action required at this time — continue standard monitoring`,
    `Account will be re-evaluated in next scheduled sweep`,
  ]
}

// ── Fusion insight narrative ───────────────────────────────────────────────
function buildInsight(signals: Signal[], sweep: Sweep | null): string {
  if (!sweep || signals.length === 0) return ''
  const top = signals.filter(s => s.direction_score <= -2)[0] || signals[0]
  const parsed = parseSignal(top)
  const crit = sweep.critical_count, alert = sweep.alert_count, caut = sweep.caution_count
  if (crit > 0) {
    return `${parsed.label} is compressing risk across the portfolio simultaneously — a systemic signal that standard payment-history monitoring misses entirely. ${crit} account${crit > 1 ? 's' : ''} require immediate loss-mitigation review. ${alert + caut} additional account${alert + caut !== 1 ? 's' : ''} show early drift signals that warrant monitoring before the next payment cycle.`
  }
  if (caut > 0) {
    return `External signal fusion — led by ${parsed.label} — is creating headwinds across ${caut} account${caut > 1 ? 's' : ''}. No accounts have crossed into loss-mitigation territory, but the signal environment is not improving. Proactive relationship outreach is recommended on flagged accounts.`
  }
  return `Portfolio is holding stable. ${sweep.cases_swept} accounts swept against ${signals.length} live signal streams — all within normal drift thresholds. The fusion engine continues monitoring and will alert on any directional changes.`
}

function caseId(ref: string) {
  return `case-${ref.replace(/[^a-zA-Z0-9]/g, '-')}`
}

// ── Popup Modal ────────────────────────────────────────────────────────────
function Popup({
  ec, type, isRE, onClose, onSaveFeedback,
}: {
  ec: EnrichedCase
  type: PopupType
  isRE: boolean
  onClose: () => void
  onSaveFeedback: (caseId: string, fb: CaseFeedback) => Promise<void>
}) {
  const [draft, setDraft] = useState<CaseFeedback>(ec.feedback ?? {})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  const handleOverlay = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const handleSave = async () => {
    setSaving(true)
    await onSaveFeedback(ec.id, draft)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const tierColor = DIR[ec.drift_tier]

  const POPUP_TITLES: Record<PopupType, string> = {
    implies: 'What This Implies',
    todo:    'What To Do',
    adjust:  'Your Assessment',
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlay}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,20,50,0.55)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 600,
        maxHeight: '85vh', overflow: 'auto', boxShadow: '0 8px 40px rgba(0,0,40,0.22)',
        border: `2px solid ${tierColor}`,
      }}>
        {/* Header */}
        <div style={{ background: tierColor, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>{POPUP_TITLES[type]}</div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>
              {displayCase(ec)} · <span style={{ textTransform: 'capitalize' }}>{ec.drift_tier}</span>
              {isRE && ec.loan_data?.case_type ? ` · ${(ec.loan_data.case_type as string) === 'buyer' ? 'Buyer' : 'Listing'}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {type === 'implies' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 10 }}>
                Fusion Intelligence Analysis
              </div>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, margin: 0 }}>
                {buildImplies(ec, isRE)}
              </p>
              {ec.pred?.top_signals && ec.pred.top_signals.length > 0 && (
                <div style={{ marginTop: 16, background: C.lightBlue, borderRadius: 8, padding: '12px 14px', borderLeft: `4px solid ${C.blue}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: C.blue, marginBottom: 8 }}>Top Fusion Signals Driving This Assessment</div>
                  {ec.pred.top_signals.map((sig, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.blue, flexShrink: 0, marginTop: 4 }} />
                      <span style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }}>{sig}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {type === 'todo' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 10 }}>
                Recommended Actions
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {buildToDo(ec, isRE).map((action, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: i === 0 ? '#FFF8EC' : C.lightBlue, borderRadius: 8, padding: '10px 12px', border: `1px solid ${i === 0 ? '#F0D080' : C.border}` }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: i === 0 ? C.gold : C.blue, color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <span style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {type === 'adjust' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 12 }}>
                Your Assessment Override
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
                Fusion&apos;s engine output is the baseline. Your direct knowledge of this account can adjust confidence, trend direction, and action status — and informs the next sweep cycle.
              </div>

              {/* Confidence override */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: C.text, marginBottom: 6 }}>
                  Confidence Override
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: C.muted, textTransform: 'none' }}>
                    (Engine: {ec.pred?.confidence_pct ?? Math.round(ec.drift_score)}%)
                  </span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="range" min={0} max={100}
                    value={draft.user_confidence ?? ec.pred?.confidence_pct ?? Math.round(ec.drift_score)}
                    onChange={e => setDraft({ ...draft, user_confidence: parseInt(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 700, color: tierColor, minWidth: 36 }}>
                    {draft.user_confidence ?? ec.pred?.confidence_pct ?? Math.round(ec.drift_score)}%
                  </span>
                </div>
              </div>

              {/* Trend override */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: C.text, marginBottom: 6 }}>
                  Trend Direction Override
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: C.muted, textTransform: 'none' }}>
                    (Engine: {ec.trendDirection})
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['improving', 'stable', 'declining'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setDraft({ ...draft, user_trend_override: draft.user_trend_override === t ? null : t })}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 6, border: `1.5px solid`,
                        borderColor: draft.user_trend_override === t
                          ? (t === 'improving' ? C.stable : t === 'declining' ? C.critical : C.muted)
                          : C.border,
                        background: draft.user_trend_override === t
                          ? (t === 'improving' ? '#E8F7EE' : t === 'declining' ? '#FDECEA' : '#F3F4F6')
                          : 'white',
                        color: draft.user_trend_override === t
                          ? (t === 'improving' ? C.stable : t === 'declining' ? C.critical : C.muted)
                          : C.muted,
                        cursor: 'pointer', fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                        transition: 'all 0.15s',
                      }}
                    >
                      {t === 'improving' ? '↓ Improving' : t === 'declining' ? '↑ Declining' : '→ Stable'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: C.text, marginBottom: 6 }}>
                  Action Status
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(['working_it', 'escalated', 'resolved', 'monitoring'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setDraft({ ...draft, user_status: draft.user_status === s ? null : s })}
                      style={{
                        padding: '6px 12px', borderRadius: 6, border: `1.5px solid`,
                        borderColor: draft.user_status === s ? USER_STATUS_COLORS[s] : C.border,
                        background: draft.user_status === s ? USER_STATUS_COLORS[s] : 'white',
                        color: draft.user_status === s ? 'white' : C.muted,
                        cursor: 'pointer', fontSize: 11, fontWeight: 700,
                        transition: 'all 0.15s',
                      }}
                    >
                      {USER_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action note */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: C.text, marginBottom: 6 }}>
                  Action Note
                </label>
                <textarea
                  value={draft.user_action ?? ''}
                  onChange={e => setDraft({ ...draft, user_action: e.target.value || null })}
                  placeholder="What did you observe? What action did you take or plan to take?"
                  rows={3}
                  style={{
                    width: '100%', borderRadius: 7, border: `1.5px solid ${C.border}`,
                    padding: '8px 10px', fontSize: 12, color: C.text, resize: 'vertical',
                    fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  width: '100%', padding: '10px', borderRadius: 8, border: 'none',
                  background: saved ? C.stable : C.blue,
                  color: 'white', fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Assessment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EnterpriseReportClient({ institutionId, institutionName, highlight, verticalConfig, caseActionsMap = {}, snapshotMap = {} }: Props) {
  const supabase = createClient()
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [enrichedCases, setEnrichedCases] = useState<EnrichedCase[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [objectives, setObjectives] = useState<EnterpriseObjective[]>([])
  const [objectiveResults, setObjectiveResults] = useState<Map<string, EnterpriseObjectiveResult>>(new Map())
  const [loading, setLoading] = useState(true)
  const [flashId, setFlashId] = useState<string | null>(null)
  // FF-051 popup state
  const [popupCaseId, setPopupCaseId] = useState<string | null>(null)
  const [popupType, setPopupType] = useState<PopupType | null>(null)
  // FF-061A alias edit state
  const [aliasCaseRef, setAliasCaseRef] = useState<string | null>(null)
  const [aliasValue, setAliasValue] = useState('')
  const [aliasSaving, setAliasSaving] = useState(false)
  // FF-061E close case state
  const [closingCase, setClosingCase] = useState<string | null>(null)
  const [closedCases, setClosedCases] = useState<Set<string>>(new Set())

  const openPopup = (caseId: string, type: PopupType) => {
    setPopupCaseId(caseId)
    setPopupType(type)
  }
  const closePopup = () => { setPopupCaseId(null); setPopupType(null) }

  const startAliasEdit = (ec: EnrichedCase) => {
    setAliasCaseRef(ec.case_ref)
    setAliasValue(ec.case_alias ?? '')
  }
  const cancelAliasEdit = () => { setAliasCaseRef(null); setAliasValue('') }
  const commitAliasEdit = async () => {
    if (!aliasCaseRef) return
    setAliasSaving(true)
    const result = await updateCaseAlias(institutionId, aliasCaseRef, aliasValue)
    setAliasSaving(false)
    if (result.ok) {
      setEnrichedCases(prev => prev.map(ec =>
        ec.case_ref === aliasCaseRef ? { ...ec, case_alias: aliasValue.trim() || null } : ec
      ))
      setAliasCaseRef(null)
    }
  }

  const handleSaveFeedback = useCallback(async (caseId: string, fb: CaseFeedback) => {
    const result = await updateCaseFeedback(institutionId, caseId, fb)
    if (result.ok) {
      setEnrichedCases(prev => prev.map(ec =>
        ec.id === caseId ? { ...ec, feedback: { ...ec.feedback, ...fb } } : ec
      ))
    }
  }, [institutionId])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const TIER_ORDER: Record<Dir, number> = { CRITICAL: 0, ALERT: 1, CAUTION: 2, STABLE: 3 }
    try {
      // Step 1: Sweep metadata
      const { data: sweeps } = await supabase
        .from('enterprise_sweeps').select('*')
        .eq('institution_id', institutionId).eq('status', 'complete')
        .order('completed_at', { ascending: false }).limit(1)
      setSweep(sweeps?.[0] ?? null)

      // Step 2: All in-scope cases
      const { data: casesRaw } = await supabase
        .from('enterprise_cases')
        .select('id, case_ref, case_alias, case_type, region, fico_band, vehicle_class, loan_status, ltv_ratio, dti_ratio, current_balance, payments_remaining, loan_data')
        .eq('institution_id', institutionId)
        .eq('in_scope', true)
      const cases = (casesRaw ?? []) as CaseRow[]

      // Step 3: Latest history + 5-point trend per case
      const caseIds = cases.map(c => c.id)
      const histMap = new Map<string, { drift_tier: string; drift_score: number; loan_status: string | null; days_past_due: number | null }>()
      const histPoints = new Map<string, number[]>()   // oldest→newest drift scores, up to 5

      if (caseIds.length > 0) {
        const { data: histRaw } = await supabase
          .from('enterprise_case_history')
          .select('case_id, drift_tier, drift_score, loan_status, days_past_due, snapshot_at')
          .in('case_id', caseIds)
          .not('drift_tier', 'is', null)
          .order('snapshot_at', { ascending: false })

        for (const row of histRaw ?? []) {
          // First-seen per case = latest (desc order)
          if (!histMap.has(row.case_id)) histMap.set(row.case_id, row as any)
          // Accumulate up to 5 points per case; unshift maintains ascending order
          const pts = histPoints.get(row.case_id) ?? []
          if (pts.length < 5) { pts.unshift(row.drift_score); histPoints.set(row.case_id, pts) }
        }
      }

      // Step 4: Predictions (supplementary)
      const predMap = new Map<string, PredExtra>()
      if (sweeps?.[0]) {
        const { data: preds } = await supabase
          .from('enterprise_predictions')
          .select('case_id, top_signals, recommended_action, confidence_pct')
          .eq('institution_id', institutionId)
          .eq('sweep_id', sweeps[0].id)
        for (const p of preds ?? []) predMap.set(p.case_id, p as PredExtra)
      }

      // Step 5: Load user feedback — Promise.allSettled per standing rule
      const feedbackMap = new Map<string, CaseFeedback>()
      const [feedbackResult] = await Promise.allSettled([
        supabase
          .from('enterprise_case_feedback')
          .select('case_id, user_confidence, user_trend_override, user_action, user_status')
          .eq('institution_id', institutionId)
      ])
      if (feedbackResult.status === 'fulfilled') {
        for (const f of feedbackResult.value.data ?? []) feedbackMap.set(f.case_id, f as CaseFeedback)
      }

      // Step 6: Merge + compute trend
      const enriched: EnrichedCase[] = cases.map(c => {
        const h = histMap.get(c.id)
        const pts = histPoints.get(c.id) ?? []
        const { direction: trendDirection, delta: trendDelta } = computeTrend(pts)
        return {
          id: c.id,
          case_ref: c.case_ref,
          case_alias: c.case_alias,
          case_type: c.case_type ?? null,
          region: c.region,
          fico_band: c.fico_band,
          vehicle_class: c.vehicle_class,
          ec_loan_status: c.loan_status,
          ltv_ratio: c.ltv_ratio,
          dti_ratio: c.dti_ratio,
          current_balance: c.current_balance,
          payments_remaining: c.payments_remaining,
          loan_data: c.loan_data,
          drift_tier: (h?.drift_tier ?? 'STABLE') as Dir,
          drift_score: h?.drift_score ?? 0,
          scored_status: h?.loan_status ?? null,
          scored_dpd: h?.days_past_due ?? null,
          pred: predMap.get(c.id),
          trendDirection,
          trendDelta,
          trendPoints: pts,
          feedback: feedbackMap.get(c.id),
        }
      }).sort((a, b) => {
        const td = TIER_ORDER[a.drift_tier] - TIER_ORDER[b.drift_tier]
        if (td !== 0) return td
        return b.drift_score - a.drift_score
      })
      setEnrichedCases(enriched)

      // Step 7: Market signals
      const since = new Date(); since.setDate(since.getDate() - 60)
      const { data: sigs } = await supabase.from('market_signals')
        .select('signal_id,source,direction_score,event_text,effective_date,magnitude')
        .gte('effective_date', since.toISOString().split('T')[0])
        .order('direction_score', { ascending: true }).limit(200)

      const seen = new Map<string, Signal>()
      for (const sg of (sigs ?? [])) if (!seen.has(sg.signal_id)) seen.set(sg.signal_id, sg)
      const all6: Signal[] = []
      const srcSeen = new Set<string>()
      const sorted = Array.from(seen.values()).sort((a, b) => a.direction_score - b.direction_score)
      for (const sg of sorted) { if (all6.length >= 6) break; if (!srcSeen.has(sg.source)) { all6.push(sg); srcSeen.add(sg.source) } }
      for (const sg of sorted) { if (all6.length >= 6) break; if (!all6.includes(sg)) all6.push(sg) }
      setSignals(all6)

      // Step 8: Enterprise objectives — live from DB, ordered
      const { data: objData } = await supabase
        .from('enterprise_objectives')
        .select('id, obj_id, title, statement, lifecycle_state, objective_state')
        .eq('institution_id', institutionId)
        .eq('lifecycle_state', 'active')
        .order('objective_order')
      setObjectives(objData ?? [])

      // Step 9: Most recent objective result per objective (latest computed_at wins)
      const { data: objResultsData } = await supabase
        .from('enterprise_objective_results')
        .select('objective_id, affecting_it, implies, what_to_do, confidence_score, escalated_to_focus, computed_at, key_case_refs')
        .eq('institution_id', institutionId)
        .order('computed_at', { ascending: false })
      const resultsMap = new Map<string, EnterpriseObjectiveResult>()
      for (const r of objResultsData ?? []) {
        if (!resultsMap.has(r.objective_id)) resultsMap.set(r.objective_id, r as EnterpriseObjectiveResult)
      }
      setObjectiveResults(resultsMap)
    } finally {
      setLoading(false)
    }
  }, [institutionId, supabase])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (!highlight || loading) return
    const id = caseId(highlight)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashId(id)
      setTimeout(() => setFlashId(null), 2000)
    }
  }, [highlight, loading])

  // FF-061B + FF-061C: both useMemo hooks must be before any early return
  const caseMap = useMemo<CaseMap>(() =>
    Object.fromEntries(
      enrichedCases.map(ec => [
        ec.case_ref,
        { alias: ec.case_alias ?? null, elementId: caseId(ec.case_ref) },
      ])
    ),
    [enrichedCases]
  )

  const caseObjectiveMap = useMemo<Record<string, ObjectiveFlag[]>>(() => {
    const map: Record<string, ObjectiveFlag[]> = {}
    for (const obj of objectives) {
      const result = objectiveResults.get(obj.id)
      for (const caseRef of result?.key_case_refs ?? []) {
        if (!map[caseRef]) map[caseRef] = []
        map[caseRef].push({
          obj_id: obj.obj_id,
          title: obj.title,
          confidence_score: result?.confidence_score ?? 0,
          escalated_to_focus: result?.escalated_to_focus ?? false,
        })
      }
    }
    return map
  }, [objectives, objectiveResults])

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: `2px solid ${C.blue}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: C.muted, fontSize: 13 }}>Loading report...</p>
      </div>
    </div>
  )

  const insight = buildInsight(signals, sweep)
  const isRealEstate = verticalConfig?.vertical_type === 'real_estate'
  const listingCount = isRealEstate ? enrichedCases.filter(c => c.case_type === 'listing').length : 0
  const buyerCount   = isRealEstate ? enrichedCases.filter(c => c.case_type === 'buyer').length  : 0
  const tierCounts = {
    CRITICAL: enrichedCases.filter(c => c.drift_tier === 'CRITICAL').length,
    ALERT:    enrichedCases.filter(c => c.drift_tier === 'ALERT').length,
    CAUTION:  enrichedCases.filter(c => c.drift_tier === 'CAUTION').length,
    STABLE:   enrichedCases.filter(c => c.drift_tier === 'STABLE').length,
  }

  // Popup case lookup
  const popupCase = popupCaseId ? enrichedCases.find(ec => ec.id === popupCaseId) ?? null : null

  function scrollToObjective(objId: string) {
    const el = document.getElementById(`objective-${objId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', color: C.text }}>
      {/* FF-061B: amber highlight for case card scroll-to */}
      <style>{`
        .case-card--highlighted {
          outline: 2px solid #C9A227 !important;
          box-shadow: 0 0 0 4px rgba(201,162,39,0.15) !important;
          transition: outline 0.3s ease, box-shadow 0.3s ease !important;
        }
        .case-objectives-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 7px 12px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .objective-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 20px;
          border: 1px solid #2E7CB8;
          background: transparent;
          color: #8AB4D4;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s, color 0.15s;
          font-family: inherit;
        }
        .objective-pill:hover {
          background: #2E7CB8;
          color: white;
        }
      `}</style>
      {/* Popup overlay */}
      {popupCase && popupType && (
        <Popup
          ec={popupCase}
          type={popupType}
          isRE={isRealEstate}
          onClose={closePopup}
          onSaveFeedback={handleSaveFeedback}
        />
      )}

      {/* CONFIDENTIAL BANNER */}
      <div style={{ background: C.critical, color: 'white', textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '5px', textTransform: 'uppercase' }}>
        CONFIDENTIAL — SOLVEGA LABS / MERIDIAN ARC — PILOT DEMONSTRATION ONLY
      </div>

      {isRealEstate && verticalConfig ? (
        <>
          <VerticalReportHeader
            institution={{ id: institutionId, name: institutionName }}
            tiers={tierCounts}
            config={verticalConfig}
            lastSweepAt={sweep?.completed_at ?? null}
            listingCount={listingCount}
            buyerCount={buyerCount}
          />
          <div style={{ padding: '8px 32px', background: C.blue, display: 'flex', alignItems: 'center', gap: 24, fontSize: 11, color: 'rgba(255,255,255,.85)' }}>
            <span>Fusion Sources: <strong>All Engines</strong></span>
            <span style={{ marginLeft: 'auto' }}>
              <Link href="/enterprise/cases" style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, textDecoration: 'none' }}>All Cases →</Link>
              <span style={{ color: 'rgba(255,255,255,.3)', margin: '0 12px' }}>|</span>
              <Link href="/enterprise" style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, textDecoration: 'none' }}>← Back to Portal</Link>
            </span>
          </div>
        </>
      ) : (
        <div style={{ background: C.navy }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, background: C.gold, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: C.navy, fontSize: 16 }}>MA</div>
              <div>
                <div style={{ color: 'white', fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>MERIDIAN ARC</div>
                <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>Enterprise Decision Intelligence · Solvega Labs</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', color: '#8899BB', fontSize: 11, lineHeight: 1.7 }}>
              <strong style={{ color: 'white' }}>{institutionName}</strong><br />
              Pilot Demo — Synthetic Data<br />
              Sweep Date: {fmtDate(sweep?.completed_at ?? null)}
            </div>
          </div>
          <div style={{ background: C.blue, padding: '8px 32px', display: 'flex', alignItems: 'center', gap: 24, fontSize: 11, color: 'rgba(255,255,255,.85)' }}>
            <span><strong>MAIN</strong></span>
            <span style={{ color: 'rgba(255,255,255,.3)' }}>|</span>
            <span>Active Loan Drift Detection — 90-Day Window</span>
            <span style={{ color: 'rgba(255,255,255,.3)' }}>|</span>
            <span>Fusion Sources: <strong>All Engines</strong></span>
            <span style={{ marginLeft: 'auto' }}>
              <Link href="/enterprise" style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, textDecoration: 'none' }}>← Back to Portal</Link>
            </span>
          </div>
        </div>
      )}

      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>

        {/* OBJECTIVES — live from enterprise_objectives + enterprise_objective_results */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, marginBottom: 10, paddingBottom: 6, borderBottom: `2px solid ${C.border}` }}>
          Objective Definitions ({objectives.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {objectives.map(obj => {
            const result = objectiveResults.get(obj.id)
            const conf = result?.confidence_score != null ? Math.round(result.confidence_score * 100) : null
            return (
              <div key={obj.id} id={`objective-${obj.obj_id}`} style={{ backgroundColor: '#0D1B3E', border: `1px solid ${result?.escalated_to_focus ? '#C9A227' : 'rgba(46,124,184,0.3)'}`, borderRadius: 12, overflow: 'hidden' }}>
                {/* Header — Meridian Blue */}
                <div style={{ backgroundColor: '#2E7CB8', padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: obj.statement ? 8 : 0, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.15)', padding: '3px 8px', borderRadius: 4, letterSpacing: '0.08em', flexShrink: 0 }}>
                      {obj.obj_id}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', flex: 1 }}>
                      {obj.title}
                    </span>
                    {conf != null && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#C9A227', flexShrink: 0 }}>
                        {conf}% confidence
                      </span>
                    )}
                    {result?.escalated_to_focus && (
                      <span style={{ padding: '3px 9px', borderRadius: 5, background: 'rgba(201,162,39,0.2)', border: '1px solid #C9A227', color: '#C9A227', fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        ↑ FOCUS
                      </span>
                    )}
                  </div>
                  {obj.statement && (
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.6, margin: 0 }}>
                      {obj.statement}
                    </p>
                  )}
                </div>
                {/* Latest sweep result — sections independently expandable */}
                {result && (result.affecting_it || result.implies || result.what_to_do) && (
                  <div style={{ background: '#f0f7ff', borderTop: '1px solid rgba(46,124,184,0.2)', padding: '12px 18px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {result.affecting_it && (
                      <ExpandableSection label="Affecting It" content={result.affecting_it} caseMap={caseMap} />
                    )}
                    {result.implies && (
                      <ExpandableSection label="Implies" content={result.implies} caseMap={caseMap} />
                    )}
                    {result.what_to_do && (
                      <ExpandableSection label="What to Do" content={result.what_to_do} caseMap={caseMap} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {objectives.length === 0 && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '16px 20px', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
              No active objectives configured for this institution.
            </div>
          )}
        </div>

        {/* SUMMARY PILLS */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {(['CRITICAL','ALERT','CAUTION','STABLE'] as Dir[]).map(d => (
            <div key={d} style={{ flex: 1, borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: DIR[d] }}>
              <span style={{ color: 'white', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.9 }}>{d}</span>
              <span style={{ color: 'white', fontSize: 28, fontWeight: 800 }}>
                {enrichedCases.filter(c => c.drift_tier === d).length}
              </span>
            </div>
          ))}
        </div>

        {/* CASE CARDS */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'rgba(255,255,255,0.38)', marginBottom: 10, paddingBottom: 6, borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
          {isRealEstate ? 'Listing & Buyer Sweep Results' : 'Loan Sweep Results'} — Inference Engine Output
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
          {enrichedCases.map(ec => {
            const color = DIR[ec.drift_tier]
            const objectiveFlags = caseObjectiveMap[ec.case_ref] ?? []
            const forwardStatus = computeForwardStatus(ec.drift_tier.toLowerCase(), objectiveFlags)
            const fwdColor = FORWARD_DIR[forwardStatus]
            const isWatch = forwardStatus === 'WATCH'
            const cardId = caseId(ec.case_ref ?? ec.id)
            const isFlashing = flashId === cardId
            const snapshot = snapshotMap[ec.id]
            const activeDriftScore = snapshot?.drift_score ?? ec.drift_score
            const confPct = snapshot?.confidence_pct ?? ec.pred?.confidence_pct ??
              (ec.drift_tier === 'STABLE'
                ? Math.round(100 - ec.drift_score)
                : Math.round(ec.drift_score))
            const userConf = ec.feedback?.user_confidence
            const userStatus = ec.feedback?.user_status
            const userTrend = ec.feedback?.user_trend_override
            const hasObjFlags = objectiveFlags.length > 0
            const objRiskLabel = objectiveFlags.some(f => f.confidence_score >= 0.6) ? 'HIGH'
              : objectiveFlags.some(f => f.confidence_score >= 0.4) ? 'MED' : 'LOW'
            const objRiskColor = objRiskLabel === 'HIGH' ? C.critical : objRiskLabel === 'MED' ? C.caution : C.stable

            return (
              <div key={ec.id} id={cardId} style={{ backgroundColor: '#0B1829', border: `1px solid ${isFlashing ? '#C9A227' : 'rgba(46,124,184,0.2)'}`, borderRadius: 10, overflow: 'visible', borderLeft: `5px solid ${fwdColor}`, transition: 'border-color 0.4s', boxShadow: isFlashing ? '0 0 0 3px rgba(201,162,39,0.25)' : 'none' }}>
                {/* Header row — 10 columns: Case, Status, Region, FICO, DOM/LTV, Drift Score, 5-Day Trend, Direction, Confidence, Close */}
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 110px 120px 90px 65px 140px 72px 105px 125px 85px', alignItems: 'stretch', minWidth: 1062, backgroundColor: '#0D1B3E' }}>
                    {/* Case ID — FF-061A alias */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3 }}>Case</div>
                      {aliasCaseRef === ec.case_ref ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            autoFocus
                            value={aliasValue}
                            onChange={e => setAliasValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitAliasEdit(); if (e.key === 'Escape') cancelAliasEdit() }}
                            onBlur={commitAliasEdit}
                            placeholder="Add alias"
                            maxLength={60}
                            style={{ fontSize: 11, fontWeight: 600, border: `1px solid ${C.blue}`, borderRadius: 4, padding: '2px 5px', width: 80, outline: 'none', color: '#111', backgroundColor: '#fff' }}
                          />
                          {aliasSaving && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>…</span>}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={ec.case_ref}>
                            {displayCase(ec)}
                          </div>
                          <button
                            onClick={() => startAliasEdit(ec)}
                            title={`Edit alias (${ec.case_ref})`}
                            style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 10, lineHeight: 1, flexShrink: 0 }}
                          >✏️</button>
                        </div>
                      )}
                      {ec.case_alias && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.38)', marginTop: 1 }}>{ec.case_ref}</div>}
                    </div>
                    {/* Status — FF-061D forward trajectory */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap' }}>STATUS<InfoTooltip text="Current risk tier based on case trajectory and objective signals. STABLE = no active flags. WATCH = flagged by an objective. CAUTION = threshold approaching. ALERT = act now." /></div>
                      <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 800, color: 'white', background: fwdColor, marginBottom: 3 }}>
                        {isWatch ? '⚠ WATCH' : forwardStatus}
                      </span>
                      {isWatch && (
                        <div style={{ fontSize: 7, color: C.watch, fontWeight: 700, marginBottom: 2, whiteSpace: 'nowrap' }}>In Objective Focus</div>
                      )}
                      {userStatus && (
                        <div style={{ display: 'inline-block', marginLeft: 4, padding: '1px 5px', borderRadius: 3, fontSize: 8, fontWeight: 700, color: 'white', background: USER_STATUS_COLORS[userStatus], marginBottom: 3 }}>{USER_STATUS_LABELS[userStatus]}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatLoanStatus(ec.scored_status)}</div>
                    </div>
                    {/* Region */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3 }}>Region</div>
                      <div style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,255,255,0.65)', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ec.region}</div>
                    </div>
                    {/* FICO Band / Price Band */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3 }}>
                        {isRealEstate ? 'Price Band' : 'FICO Band'}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,255,255,0.65)', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
                        {isRealEstate ? ((ec.loan_data as any)?.price_band ?? '—') : ec.fico_band}
                      </div>
                    </div>
                    {/* LTV Drift / DOM */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3 }}>
                        {isRealEstate ? 'DOM' : 'LTV Drift'}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,255,255,0.65)', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
                        {isRealEstate
                          ? (typeof (ec.loan_data as any)?.days_on_market === 'number' ? `${(ec.loan_data as any).days_on_market}d` : '—')
                          : fmtLTV(ec.ltv_ratio)}
                      </div>
                    </div>
                    {/* Drift Score */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap' }}>DRIFT SCORE<InfoTooltip text="Measures how far this case has moved from its baseline. 0/100 = no drift. Higher = accelerating change." /></div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased', letterSpacing: '-0.01em' }}>{activeDriftScore} / 100</div>
                      <div style={{ marginTop: 6, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${activeDriftScore}%`, background: color, borderRadius: 3 }} />
                      </div>
                    </div>
                    {/* 5-Day Trend — FF-051 */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 5 }}>5-Day Trend</div>
                      <TrendArrow
                        direction={userTrend ? (userTrend === 'improving' ? 'down' : userTrend === 'declining' ? 'up' : 'flat') : ec.trendDirection}
                        delta={ec.trendDelta}
                      />
                      {userTrend && (
                        <div style={{ fontSize: 8, color: '#8AB4D4', marginTop: 2, fontWeight: 600 }}>Your override</div>
                      )}
                    </div>
                    {/* Direction — FF-061D forward status */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>DIRECTION<InfoTooltip text="5-day sweep trajectory. Up = improving. Down = deteriorating. Flat = holding steady." /></div>
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 800, color: 'white', background: fwdColor, marginTop: 4 }}>
                        {isWatch ? '⚠ WATCH' : forwardStatus}
                      </span>
                    </div>
                    {/* Outcome Confidence — FF-061D: objective risk replaces snapshot conf when flags exist */}
                    <div style={{ padding: '10px 12px', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>CONFIDENCE<InfoTooltip text="Engine confidence in this case's current assessment. Reflects data completeness and signal strength." /></div>
                      {hasObjFlags ? (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: objRiskColor }}>
                            Objective Risk: {objRiskLabel}
                          </div>
                          {userConf != null && (
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{userConf}% override</div>
                          )}
                        </div>
                      ) : (
                        <div title={OUTCOME_TOOLTIP[ec.drift_tier] ?? ''} style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased', letterSpacing: '-0.01em', cursor: 'help' }}>
                          {userConf != null ? (
                            <>
                              <span style={{ color: '#8AB4D4' }}>{userConf}%</span>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', marginLeft: 3 }}>({confPct}%)</span>
                            </>
                          ) : `${confPct}%`}
                        </div>
                      )}
                    </div>
                    {/* Close */}
                    <div style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      {closedCases.has(ec.case_ref) ? (
                        <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700, textAlign: 'center' }}>✓ Closed</span>
                      ) : (
                        <button
                          onClick={() => setClosingCase(ec.case_ref)}
                          style={{ backgroundColor: '#10b981', color: '#ffffff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* FF-061C: Objective pill strip */}
                {(caseObjectiveMap[ec.case_ref] ?? []).length > 0 && (
                  <div className="case-objectives-strip">
                    {(caseObjectiveMap[ec.case_ref] ?? []).map(obj => (
                      <button
                        key={obj.obj_id}
                        className="objective-pill"
                        onClick={() => scrollToObjective(obj.obj_id)}
                      >
                        {obj.obj_id} · {obj.title.length > 20 ? obj.title.slice(0, 20) + '…' : obj.title}
                      </button>
                    ))}
                  </div>
                )}

                {/* FF-051 Action Bar */}
                <div style={{ background: '#0B1829', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => openPopup(ec.id, 'implies')}
                    style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.blue}`, background: 'rgba(46,124,184,0.12)', color: '#8AB4D4', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <span style={{ fontSize: 11 }}>💡</span> What this implies
                  </button>
                  <button
                    onClick={() => openPopup(ec.id, 'todo')}
                    style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.stable}`, background: 'rgba(22,163,74,0.12)', color: C.stable, fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <span style={{ fontSize: 11 }}>✅</span> What to do
                  </button>
                  <button
                    onClick={() => openPopup(ec.id, 'adjust')}
                    style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${ec.feedback?.user_status ? C.gold : 'rgba(255,255,255,0.15)'}`, background: ec.feedback?.user_status ? 'rgba(201,162,39,0.12)' : 'rgba(255,255,255,0.05)', color: ec.feedback?.user_status ? C.gold : 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <span style={{ fontSize: 11 }}>⚙️</span> Your assessment
                    {ec.feedback?.user_status && (
                      <span style={{ marginLeft: 3, padding: '1px 5px', borderRadius: 3, background: USER_STATUS_COLORS[ec.feedback.user_status], color: 'white', fontSize: 8 }}>
                        {USER_STATUS_LABELS[ec.feedback.user_status]}
                      </span>
                    )}
                  </button>
                  {ec.feedback?.user_action && (
                    <span style={{ marginLeft: 4, fontSize: 10, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                      &ldquo;{ec.feedback.user_action}&rdquo;
                    </span>
                  )}
                </div>

                {/* Body: prediction data if available */}
                {ec.pred && (
                  <div style={{ background: '#0B1829', padding: '10px 12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 5 }}>Top Signals (Fusion)</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(ec.pred.top_signals ?? []).slice(0, 3).map((sig, j) => (
                          <div key={j} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, padding: '4px 8px', fontSize: 10, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#2E7CB8', flexShrink: 0 }} />
                            {sig}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: 4 }}>Recommended Action</div>
                      <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
                        {ec.pred.recommended_action}
                      </div>
                    </div>
                  </div>
                )}

                {/* FF-061E: Case Action Tracker */}
                <CaseActionTracker
                  institutionId={institutionId}
                  caseRef={ec.case_ref}
                  actions={caseActionsMap[ec.case_ref] ?? []}
                  objectives={objectives}
                />

                {/* FF-061E: Close Case Modal */}
                {closingCase === ec.case_ref && (
                  <CloseCaseModal
                    caseRef={ec.case_ref}
                    caseDisplay={displayCase(ec)}
                    institutionId={institutionId}
                    onClose={() => setClosingCase(null)}
                    onConfirm={() => {
                      setClosedCases(prev => { const s = new Set(prev); s.add(ec.case_ref); return s })
                      setClosingCase(null)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* LIVE FUSION SIGNALS */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, marginBottom: 10, paddingBottom: 6, borderBottom: `2px solid ${C.border}` }}>
          Live Fusion Signal Snapshot — Applied to All Cases
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 4 }}>
            {signals.map(s => {
              const { label, value, delta, isNeg } = parseSignal(s)
              return (
                <div key={s.signal_id} style={{ background: C.lightBlue, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: C.blue, fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</div>
                  <div style={{ fontSize: 10, marginTop: 2, color: isNeg ? C.alert : C.stable }}>{delta}</div>
                </div>
              )
            })}
          </div>
          {insight && (
            <div style={{ marginTop: 14, background: C.lightBlue, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.navy, borderLeft: `4px solid ${C.blue}` }}>
              <strong>Fusion insight:</strong> {insight}
            </div>
          )}
        </div>

        {/* SCHEMA */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.muted, marginBottom: 10, paddingBottom: 6, borderBottom: `2px solid ${C.border}` }}>
          Sanitized Schema — 82 Fields across 7 Groups (PII Removed)
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {[
              ['A. Loan Origination', '15', 'loan_id · origination_date · loan_term_months · loan_amount · interest_rate_pct · monthly_payment · loan_type · down_payment · ltv_ratio · dti_ratio · institution_code · loan_purpose · co_borrower_flag · channel'],
              ['B. Borrower Profile (Anonymized)', '15', 'region (ZIP→region) · fico_band (range) · income_band (range) · employment_type · tenure_months · residence_type · credit_utilization · open_tradelines · derogatory_marks · bankruptcy_flag · prior_auto_loans · prior_default_flag'],
              ['C. Vehicle', '10', 'vehicle_year · vehicle_make · model_class · condition · odometer · value_at_origination · nada_book · vehicle_age · category · gap_flag'],
              ['D. Payment History', '13', 'payments_made · payments_remaining · current_balance · last_payment_date · last_payment_amount · days_past_due · max_dpd_ever · times_30/60/90_dpd · payment_streak · deferment_flag · loan_status'],
              ['E. External Signals at Origination', '8', 'manheim_index · regional_unemployment · fed_funds_rate · regional_median_income · auto_sales_index · consumer_sentiment · fuel_price · prime_rate — all captured at origination date'],
              ['F. Live Fusion Signals', '9', 'manheim_current · unemployment_current · fed_funds_current · income_index_current · fuel_current · sentiment_current · collateral_value_est · ltv_drift · employment_signal_regional'],
            ].map(([label, count, fields]) => (
              <div key={label} style={{ background: C.bg, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  {label}
                  <span style={{ background: C.blue, color: 'white', borderRadius: 10, fontSize: 9, padding: '1px 7px' }}>{count}</span>
                </div>
                <div style={{ fontSize: 9, color: C.muted, lineHeight: 1.8 }}>{fields}</div>
              </div>
            ))}
            <div style={{ background: C.lightBlue, borderRadius: 8, padding: '10px 14px', border: `1px solid #B8CEF5` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.blue, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                G. Inference Engine Output — Meridian Arc
                <span style={{ background: C.navy, color: 'white', borderRadius: 10, fontSize: 9, padding: '1px 7px' }}>12</span>
              </div>
              <div style={{ fontSize: 9, color: C.muted, lineHeight: 1.8 }}>objective_id · case_id · drift_score · drift_direction · top_signal_1/2/3 · collateral_risk_flag · income_stress_flag · recommended_action · sweep_timestamp · confidence_pct</div>
            </div>
          </div>
        </div>

      </div>

      {/* FOOTER */}
      <div style={{ background: C.navy, color: '#8899BB', textAlign: 'center', padding: '16px 32px', fontSize: 10 }}>
        <strong style={{ color: C.gold }}>MERIDIAN ARC · SOLVEGA LABS</strong>
        {' '}·{' '}Confidential — Pilot Demonstration, Synthetic Data Only{' '}·{' '}Not for distribution
      </div>
    </div>
  )
}
