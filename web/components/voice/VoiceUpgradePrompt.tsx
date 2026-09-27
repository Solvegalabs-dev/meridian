'use client'

interface VoiceUpgradePromptProps {
  featureName: string
  requiredTier: 'brief' | 'full'
}

export function VoiceUpgradePrompt({ featureName, requiredTier }: VoiceUpgradePromptProps) {
  return (
    <div
      className="rounded-xl p-4 text-[13px]"
      style={{ backgroundColor: 'var(--gray-lt)', border: '1px solid var(--border)', color: 'var(--text2)' }}
    >
      <p className="font-medium mb-1">{featureName} requires an upgrade</p>
      {requiredTier === 'brief' ? (
        <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
          Unlock Voice Brief for $9/mo or upgrade to Accelerator
        </p>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
          Available on Command plan
        </p>
      )}
      <button
        disabled
        className="mt-3 px-4 py-1.5 rounded-lg text-[12px] font-medium opacity-60 cursor-not-allowed"
        style={{ backgroundColor: 'var(--blue)', color: '#fff' }}
      >
        Join waitlist
      </button>
    </div>
  )
}
