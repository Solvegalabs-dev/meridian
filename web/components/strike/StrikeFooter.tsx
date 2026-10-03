'use client'

type Props = {
  brief: Record<string, unknown> | null
  onRefresh: () => void
}

// The verdict is shown at the top of the tab, so the footer carries only date, attribution and refresh.
export default function StrikeFooter({ brief, onRefresh }: Props) {
  const briefDate = (brief?.brief_date as string) ?? ''
  const attribution = (brief?.attribution as string) ?? 'Powered by Meridian Arc'

  return (
    <div className="mt-4 pt-3 border-t border-slate-700 flex items-center justify-between gap-3 flex-wrap">
      <span className="text-sm text-slate-300">{briefDate ? `${briefDate} · ${attribution}` : attribution}</span>
      <button
        onClick={onRefresh}
        className="min-h-[44px] px-3 text-sm font-medium text-blue-300 hover:text-blue-200 transition-colors"
      >
        Refresh
      </button>
    </div>
  )
}
