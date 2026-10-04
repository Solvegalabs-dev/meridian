'use client'

import { useEffect, useState } from 'react'
import { REFRESH_NOTE_MS, refreshMessage, type BriefRefreshResult } from '@/lib/strike/briefRefresh'

type Props = {
  brief: Record<string, unknown> | null
  onRefresh: () => Promise<BriefRefreshResult>
  // A closed hunt has nothing newer to check for, so the refresh control is hidden.
  showRefresh?: boolean
}

// Result text for the live region. Opaque slate-100 on slate-900, 14 px. Empty until a check has run.
export function RefreshStatus({ result, generatedAt }: { result: BriefRefreshResult | null; generatedAt: string | null }) {
  return (
    <div role="status" className="min-h-[1.25rem] text-sm text-slate-100">
      {result ? refreshMessage(result, generatedAt) : ''}
    </div>
  )
}

export function RefreshButton({ checking, onClick }: { checking: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={checking}
      className="min-h-[44px] px-3 text-sm font-medium text-blue-300 hover:text-blue-200 disabled:text-slate-300 transition-colors"
    >
      {checking ? 'Checking…' : 'Check for newer brief'}
    </button>
  )
}

// The verdict is shown at the top of the tab, so the footer carries only date, attribution and the refresh check.
export default function StrikeFooter({ brief, onRefresh, showRefresh = true }: Props) {
  const briefDate = (brief?.brief_date as string) ?? ''
  const attribution = (brief?.attribution as string) ?? 'Powered by Meridian Arc'
  const generatedAt = (brief?.brief_generated_at as string) ?? null

  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<BriefRefreshResult | null>(null)

  // "same" and "new" are confirmations, so they clear. "offline" and "error" stay until the next check.
  useEffect(() => {
    if (result !== 'same' && result !== 'new') return
    const timer = setTimeout(() => setResult(null), REFRESH_NOTE_MS)
    return () => clearTimeout(timer)
  }, [result])

  async function check() {
    setChecking(true)
    setResult(null)
    let next: BriefRefreshResult
    try {
      next = await onRefresh()
    } catch {
      next = 'error'
    }
    setChecking(false)
    setResult(next)
  }

  const dateLine = <span className="text-sm text-slate-300">{briefDate ? `${briefDate} · ${attribution}` : attribution}</span>

  if (!showRefresh) {
    return <div className="mt-4 pt-3 border-t border-slate-700">{dateLine}</div>
  }

  return (
    <div className="mt-4 pt-3 border-t border-slate-700 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {dateLine}
        <RefreshButton checking={checking} onClick={check} />
      </div>
      <RefreshStatus result={result} generatedAt={generatedAt} />
    </div>
  )
}
