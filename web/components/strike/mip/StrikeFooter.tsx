'use client'

import { RefreshCw } from 'lucide-react'

type Props = {
  briefGeneratedAt: string
  refreshing: boolean
  onRefresh: () => void
}

export default function StrikeFooter({ briefGeneratedAt, refreshing, onRefresh }: Props) {
  const time = new Date(briefGeneratedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex items-center justify-between px-4 py-3 mt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <div className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
        Powered by Meridian Arc · Updated {time}
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh brief"
        className="p-2 -mr-2 rounded-full active:bg-white/10 disabled:opacity-50"
      >
        <RefreshCw size={16} className={refreshing ? 'animate-spin text-white/60' : 'text-white/60'} />
      </button>
    </div>
  )
}
