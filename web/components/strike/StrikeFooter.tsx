'use client'

type Props = {
  brief: Record<string, unknown> | null
  onRefresh: () => void
}

export default function StrikeFooter({ brief, onRefresh }: Props) {
  const goNoGo = (brief?.go_no_go as string) ?? ''
  const briefDate = (brief?.brief_date as string) ?? ''
  const attribution = (brief?.attribution as string) ?? 'Powered by Meridian Arc'

  const goBadgeClass =
    goNoGo === 'GO'
      ? 'bg-green-600 text-white'
      : goNoGo === 'CONDITIONAL'
      ? 'bg-amber-600 text-white'
      : 'bg-red-700 text-white'

  return (
    <div className="mt-4 pt-3 border-t border-slate-700 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-1 rounded ${goBadgeClass}`}>
          {goNoGo || 'NO-GO'}
        </span>
        <span className="text-xs text-slate-500">{briefDate} · 0430</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">{attribution}</span>
        <button
          onClick={onRefresh}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
