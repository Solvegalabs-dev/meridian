'use client'

import type { REPortfolioMetricsData } from '@/lib/enterprise/objectives-queries'

type Props = {
  data: REPortfolioMetricsData
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

type ThresholdLevel = 'green' | 'amber' | 'red' | 'neutral'

function ThresholdDot({ level }: { level: ThresholdLevel }) {
  const colors: Record<ThresholdLevel, string> = {
    green:   'bg-green-400',
    amber:   'bg-amber-400',
    red:     'bg-red-500',
    neutral: 'bg-gray-600',
  }
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[level]}`} />
}

interface MetricCardProps {
  label: string
  value: string | null
  suffix?: string
  level: ThresholdLevel
  sublabel?: string
  note?: string
}

function MetricCard({ label, value, suffix, level, sublabel, note }: MetricCardProps) {
  const isPending = value === null
  return (
    <div className="bg-gray-800/50 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-gray-400 mb-1">{label}</div>
          {isPending ? (
            <div className="text-2xl font-black text-gray-600">—</div>
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white">{value}</span>
              {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
            </div>
          )}
          {sublabel && <div className="text-[10px] text-gray-500 mt-1 leading-tight">{sublabel}</div>}
          {note && <div className="text-[10px] text-gray-600 mt-1 leading-tight">{note}</div>}
        </div>
        <ThresholdDot level={level} />
      </div>
    </div>
  )
}

const BAND_LABELS: Record<string, string> = {
  'entry':     'Entry',
  'entry-mid': 'Entry-Mid',
  'mid':       'Mid',
  'upper-mid': 'Upper-Mid',
  'luxury':    'Luxury',
}

const BAND_COLORS: Record<string, string> = {
  'entry':     'bg-blue-500',
  'entry-mid': 'bg-cyan-500',
  'mid':       'bg-teal-500',
  'upper-mid': 'bg-violet-500',
  'luxury':    'bg-amber-400',
}

export function REPortfolioMetricsPanel({ data }: Props) {
  const {
    totalCases, activeListings, activeBuyers,
    avgDOM, domOver45, domOver60,
    rateLockUnder14, rateLockUnder30, rateLockExpired,
    priceBandDistribution, avgListPrice,
    computedAt,
  } = data

  function domLevel(): ThresholdLevel {
    if (avgDOM === null) return 'neutral'
    if (avgDOM >= 60) return 'red'
    if (avgDOM >= 45) return 'amber'
    return 'green'
  }

  function staleLevel(): ThresholdLevel {
    if (domOver60 > 0) return 'red'
    if (domOver45 > 0) return 'amber'
    return 'green'
  }

  function rateLockLevel(): ThresholdLevel {
    if (rateLockExpired > 0) return 'red'
    if (rateLockUnder14 > 0) return 'amber'
    return 'green'
  }

  const totalBands = priceBandDistribution.reduce((s, b) => s + b.count, 0)
  const atRiskBuyers = rateLockUnder14 + rateLockExpired

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="font-semibold text-sm text-white">Portfolio Health Metrics</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {activeListings} listings · {activeBuyers} buyers · {totalCases} total · Last computed {timeAgo(computedAt)}
        </div>
      </div>

      {/* Four metric cards */}
      <div className="p-4 grid grid-cols-2 gap-3">
        <MetricCard
          label="Avg. Days on Market"
          value={avgDOM !== null ? String(avgDOM) : null}
          suffix="days"
          level={domLevel()}
          sublabel="Active listings · 45-day threshold"
        />
        <MetricCard
          label="Stale Listings"
          value={String(domOver45)}
          suffix={domOver45 === 1 ? 'listing' : 'listings'}
          level={staleLevel()}
          sublabel={`${domOver60} at 60+ days`}
        />
        <MetricCard
          label="Rate Lock Risk"
          value={String(atRiskBuyers)}
          suffix={atRiskBuyers === 1 ? 'buyer' : 'buyers'}
          level={rateLockLevel()}
          sublabel={
            rateLockExpired > 0
              ? `${rateLockExpired} expired · ${rateLockUnder14} expiring <14d`
              : rateLockUnder14 > 0
                ? `${rateLockUnder14} expiring within 14 days`
                : 'All locks healthy'
          }
        />
        <MetricCard
          label="Avg. List Price"
          value={avgListPrice !== null ? `$${(avgListPrice / 1000).toFixed(0)}K` : null}
          level="neutral"
          sublabel="Active listings only"
        />
      </div>

      {/* Price Band Distribution */}
      {priceBandDistribution.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Price Band Distribution
          </div>
          <div className="space-y-2">
            {priceBandDistribution.map(b => {
              const pct = totalBands > 0 ? Math.round((b.count / totalBands) * 100) : 0
              return (
                <div key={b.band} className="flex items-center gap-2">
                  <div className="text-xs text-gray-400 w-20 flex-shrink-0">
                    {BAND_LABELS[b.band] ?? b.band}
                  </div>
                  <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${BAND_COLORS[b.band] ?? 'bg-gray-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 w-16 text-right flex-shrink-0">
                    {b.count} ({pct}%)
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Rate Lock Expiry Breakdown — buyers only */}
      {activeBuyers > 0 && (
        <div className="border-t border-gray-800 px-4 py-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Rate Lock Expiry Windows
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-lg p-2.5 text-center ${rateLockExpired > 0 ? 'bg-red-900/30' : 'bg-gray-800/40'}`}>
              <div className={`text-sm font-bold ${rateLockExpired > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                {rateLockExpired}
              </div>
              <div className="text-[10px] text-gray-600 mt-0.5">Expired</div>
            </div>
            <div className={`rounded-lg p-2.5 text-center ${rateLockUnder14 > 0 ? 'bg-amber-900/30' : 'bg-gray-800/40'}`}>
              <div className={`text-sm font-bold ${rateLockUnder14 > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                {rateLockUnder14}
              </div>
              <div className="text-[10px] text-gray-600 mt-0.5">&lt;14 days</div>
            </div>
            <div className={`rounded-lg p-2.5 text-center ${rateLockUnder30 > 0 ? 'bg-yellow-900/20' : 'bg-gray-800/40'}`}>
              <div className={`text-sm font-bold ${rateLockUnder30 > 0 ? 'text-yellow-500' : 'text-gray-600'}`}>
                {rateLockUnder30}
              </div>
              <div className="text-[10px] text-gray-600 mt-0.5">14–30 days</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
