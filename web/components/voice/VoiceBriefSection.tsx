'use client'

interface VoiceBriefSectionProps {
  label: string
  isActive: boolean
  children: React.ReactNode
}

export function VoiceBriefSection({ label, isActive, children }: VoiceBriefSectionProps) {
  return (
    <div
      className="rounded-xl p-4 transition-all"
      style={{
        border: `1px solid ${isActive ? 'var(--blue)' : 'var(--border)'}`,
        backgroundColor: isActive ? 'rgba(46,124,184,0.06)' : 'transparent',
        opacity: isActive ? 1 : 0.5,
      }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-widest mb-2"
        style={{ color: isActive ? 'var(--blue)' : 'var(--text3)' }}
      >
        {label}
      </p>
      <div className="text-[13px]" style={{ color: 'var(--text2)' }}>
        {children}
      </div>
    </div>
  )
}
