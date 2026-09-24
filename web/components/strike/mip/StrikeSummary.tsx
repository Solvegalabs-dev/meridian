'use client'

type Props = {
  summary: string
  sources: string[]
}

export default function StrikeSummary({ summary, sources }: Props) {
  return (
    <div className="mx-4 rounded-xl px-4 py-4" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
      <p className="text-[19px] leading-snug text-white">{summary}</p>
      {sources.length > 0 && (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
          Sources: {sources.join(' · ')}
        </p>
      )}
    </div>
  )
}
