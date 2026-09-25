'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { MipBriefPayload } from '@/lib/mip/briefPayload'
import StrikeHeader from './StrikeHeader'
import StrikeSummary from './StrikeSummary'
import SignalChips from './SignalChips'
import TimeWindows from './TimeWindows'
import StrikeFooter from './StrikeFooter'

const REFRESH_INTERVAL_MS = 30 * 60 * 1000

type Props = {
  objectiveId: string
  objectiveTitle: string
  initialBrief: MipBriefPayload
}

export default function StrikeBriefView({ objectiveId, objectiveTitle, initialBrief }: Props) {
  const [brief, setBrief] = useState(initialBrief)
  const [refreshing, setRefreshing] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/mip/brief?objective_id=${objectiveId}&partner_key=arc`, { cache: 'no-store' })
      if (res.ok) setBrief(await res.json())
    } catch {
      // keep showing last known brief on network failure
    } finally {
      setRefreshing(false)
    }
  }, [objectiveId])

  useEffect(() => {
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [refresh])

  return (
    <div className="-m-6 min-h-[calc(100vh-3.5rem)]" style={{ backgroundColor: 'var(--navy)' }}>
      <div className="max-w-lg mx-auto pb-6">
        <div className="px-4 pt-4">
          <Link href={`/objectives/${objectiveId}`} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ov-text-mid)' }}>
            <ChevronLeft size={14} /> Back to objective
          </Link>
        </div>

        <StrikeHeader
          objectiveTitle={objectiveTitle}
          confidenceTier={brief.confidence_tier}
          confidencePct={brief.confidence_pct}
          briefGeneratedAt={brief.brief_generated_at}
        />

        <div className="flex flex-col gap-4">
          <StrikeSummary summary={brief.summary} sources={brief.sources} />
          <SignalChips chips={brief.signal_chips} />
          <TimeWindows windows={brief.time_windows} />
        </div>

        <StrikeFooter
          briefGeneratedAt={brief.brief_generated_at}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      </div>
    </div>
  )
}
