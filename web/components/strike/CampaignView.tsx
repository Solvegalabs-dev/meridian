'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isFishingTaxonomyKey } from '@/lib/strike/config/fishing-taxonomy'
import { goNoGoKind } from '@/lib/strikeBrief/goNoGo'
import { endedNoticeLabel, type EndedNotice } from '@/lib/strikeBrief/closedBrief'
import { formatDateOnly } from '@/lib/utils/dateOnly'
import { NOTICE_CLASSES } from '@/lib/strike/noticeStyles'
import { formatReason } from '@/lib/strike/reasonLabels'

type UnitProfile = {
  id?: string
  objective_id?: string
  geo?: { unit?: string; state?: string; water_body?: string } | null
  timing?: { trip_start?: string; trip_end?: string } | null
  agent_build_status?: string
  status?: string
} | null

type UnitBrief = {
  confidence_tier?: string
  go_no_go?: string
} | null

type EnrichedUnit = {
  id: string
  objective_id: string
  role: string
  rank: number | null
  status: string
  missed_reason: string | null
  pivot_recommended: boolean
  pivot_reason: string | null
  profile: UnitProfile
  brief: UnitBrief
  // Resolved on the server from the evaluated window (render time) and stored status.
  ended: EndedNotice | null
}

type Campaign = {
  id: string
  name: string
  status?: string
  taxonomy_key: string
  season_year: number | null
  units: EnrichedUnit[]
}

// A campaign is closed when hunt_campaigns.status is 'closed', or when every unit has ended.
// Closed campaigns stay visible, read-only, sorted to the bottom.
function isClosedCampaign(c: Campaign): boolean {
  if (c.status === 'closed') return true
  return c.units.length > 0 && c.units.every(u => u.ended !== null)
}

// Pivot cards are for live hunts only. If the primary is over, no shift is recommended.
function livePivotUnits(c: Campaign): EnrichedUnit[] {
  if (c.units.some(u => u.role === 'primary' && u.ended)) return []
  return c.units.filter(u => u.pivot_recommended && !u.ended)
}

function formatRole(role: string): string {
  switch (role) {
    case 'primary':    return 'Primary'
    case 'fallback_1': return 'Fallback 1'
    case 'fallback_2': return 'Fallback 2'
    case 'fallback_3': return 'Fallback 3'
    case 'missed':     return 'Missed'
    default: return role
  }
}

function roleBadge(role: string) {
  if (role === 'primary')  return 'bg-emerald-700 text-emerald-100'
  if (role === 'fallback_1' || role === 'fallback_2' || role === 'fallback_3') return 'bg-blue-700 text-blue-100'
  if (role === 'missed')   return 'bg-slate-700 text-slate-400'
  return 'bg-slate-700 text-slate-300'
}

function tierBadge(tier?: string) {
  if (!tier) return null
  const t = tier.toUpperCase()
  const cls = t === 'HIGH'
    ? 'bg-emerald-900 text-emerald-300 border border-emerald-700'
    : t === 'MODERATE'
    ? 'bg-amber-900 text-amber-300 border border-amber-700'
    : 'bg-red-900 text-red-300 border border-red-700'
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{tier}</span>
}

function gnoBadge(gno?: string) {
  if (!gno) return null
  if (goNoGoKind(gno) === 'closed') {
    return <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-slate-700 text-slate-300">Closed</span>
  }
  const g = gno.toUpperCase()
  const cls = g === 'GO'
    ? 'bg-emerald-600 text-white'
    : g === 'NO-GO' || g === 'NO GO'
    ? 'bg-red-600 text-white'
    : g === 'CAUTION'
    ? 'bg-amber-600 text-white'
    : 'bg-slate-600 text-slate-300'
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{gno}</span>
}

type UnitTiming = { trip_start?: string; trip_end?: string } | null | undefined

// Trip dates are date-only strings: formatted as written, never shifted by the viewer's zone.
function formatDates(timing: UnitTiming): string {
  if (!timing?.trip_start) return ''
  const start = formatDateOnly(timing.trip_start)
  const end = timing.trip_end ? formatDateOnly(timing.trip_end) : null
  return end ? `${start} – ${end}` : start
}

function UnitRow({ unit, isFishing }: { unit: EnrichedUnit; isFishing?: boolean }) {
  const router = useRouter()
  const geo = unit.profile?.geo
  const unitName = isFishing
    ? (geo?.water_body ?? 'Water TBD')
    : (geo?.unit ? `Unit ${geo.unit}${geo.state ? `, ${geo.state}` : ''}` : 'Unit TBD')
  const dates = formatDates(unit.profile?.timing)
  const dateLabel = isFishing && dates ? `Season window: ${dates}` : dates
  const isMissed = unit.status === 'missed' || unit.role?.toUpperCase() === 'MISSED'
  // An ended unit shows only the closed label: no GO, CONDITIONAL or tier badge from a stored brief.
  const ended = unit.ended !== null
  const endedLabel = unit.ended ? endedNoticeLabel(unit.ended) : null
  const muted = isMissed || ended

  return (
    <button
      onClick={() => unit.objective_id && router.push(`/strike/${unit.objective_id}`)}
      className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-700/50 last:border-0 hover:bg-slate-700/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Muted rows dim by colour, never opacity, so the ended label below stays fully readable. */}
          <span className={muted ? NOTICE_CLASSES.mutedName : 'text-sm font-medium text-white'}>{unitName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${muted ? 'bg-slate-700 text-slate-400' : roleBadge(unit.role)}`}>
            {formatRole(unit.role)}
          </span>
          {endedLabel && <span className={NOTICE_CLASSES.endedLabel}>{endedLabel}</span>}
        </div>
        {dateLabel && <div className="text-xs text-slate-400 mt-0.5">{dateLabel}</div>}
        {isMissed && unit.missed_reason && (
          <div className="text-xs text-slate-500 mt-0.5 italic">{formatReason(unit.missed_reason)}</div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!ended && tierBadge(unit.brief?.confidence_tier)}
        {!ended && gnoBadge(unit.brief?.go_no_go)}
        <span className="text-slate-500 text-xs">›</span>
      </div>
    </button>
  )
}

function PivotCard({ unit }: { unit: EnrichedUnit }) {
  const geo = unit.profile?.geo
  const unitName = geo?.unit ? `Unit ${geo.unit}` : 'unit'
  return (
    <div className="mx-4 mb-3 bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="text-amber-400 text-base mt-0.5">⚠</span>
        <div>
          <div className="text-amber-300 text-sm font-semibold">Pivot recommended — {unitName}</div>
          {unit.pivot_reason && (
            <p className="text-amber-200/70 text-xs mt-1 leading-relaxed">{unit.pivot_reason}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CampaignView({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Meridian</div>
          <div className="text-lg font-semibold">Strike Campaigns</div>
        </div>
        <Link
          href="/strike/new"
          className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors"
        >
          + New objective
        </Link>
      </div>

      {/* Body */}
      <div className="flex-1 px-0 py-4 space-y-4">
        {campaigns.length === 0 ? (
          <div className="text-center py-16 text-slate-400 px-4">
            <div className="text-sm">No active campaigns.</div>
            <Link href="/strike/new" className="text-blue-400 text-sm mt-2 inline-block">
              Create your first objective →
            </Link>
          </div>
        ) : (
          [...campaigns].sort((a, b) => Number(isClosedCampaign(a)) - Number(isClosedCampaign(b))).map(campaign => {
            const isFishing = isFishingTaxonomyKey(campaign.taxonomy_key ?? '')
            const pivotUnits = livePivotUnits(campaign)
            return (
              <div key={campaign.id}>
                {/* Campaign header */}
                <div className="flex items-center gap-2 px-4 mb-2">
                  <div className="font-semibold text-white text-base flex-1 min-w-0 truncate">
                    {isFishing && <span className="mr-1">🎣</span>}{campaign.name}
                  </div>
                  {campaign.taxonomy_key && (
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono flex-shrink-0">
                      {campaign.taxonomy_key.replace(/\./g, ' · ')}
                    </span>
                  )}
                  {campaign.season_year && (
                    <span className="text-xs text-slate-500 flex-shrink-0">{campaign.season_year}</span>
                  )}
                </div>

                {/* Pivot alerts */}
                {pivotUnits.map(u => <PivotCard key={u.id} unit={u} />)}

                {/* Unit rows */}
                <div className="bg-slate-800 rounded-xl mx-4 overflow-hidden">
                  {campaign.units.length === 0 ? (
                    <div className="px-4 py-4 text-slate-500 text-sm">No units in this campaign.</div>
                  ) : (
                    campaign.units.map(unit => <UnitRow key={unit.id} unit={unit} isFishing={isFishing} />)
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer new objective button */}
      <div className="px-4 pb-8 pt-2">
        <Link
          href="/strike/new"
          className="block w-full text-center text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-3 rounded-xl transition-colors border border-slate-700"
        >
          + Add objective
        </Link>
      </div>
    </div>
  )
}
