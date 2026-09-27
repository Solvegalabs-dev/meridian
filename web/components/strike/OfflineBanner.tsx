'use client'

export default function OfflineBanner({ cachedAt }: { cachedAt?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-900/80 border-b border-amber-700 text-amber-200 text-sm">
      <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
      <span>
        Offline — showing cached brief
        {cachedAt ? ` from ${new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
      </span>
    </div>
  )
}
