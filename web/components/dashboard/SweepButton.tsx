'use client'

import MeridianBeacon from '@/components/brand/MeridianBeacon'
import { useRunSweep } from '@/lib/sweep/useRunSweep'
import { formatLastSweep, formatNextSweep } from '@/lib/sweep/runSweep'

interface SweepButtonProps {
  lastSweepAt?: string | null
  nextSweepAt?: string | null
  onSweepComplete?: (result: unknown) => void
}

export default function SweepButton({ lastSweepAt, nextSweepAt: nextSweepAtProp, onSweepComplete }: SweepButtonProps) {
  // The action and its states are shared with Strike (FF-098): see lib/sweep/useRunSweep.ts.
  const { isRunning, error, nextSweepAt, rateLimited: isRateLimited, run: handleSweep } = useRunSweep({
    nextSweepAt: nextSweepAtProp,
    onSweepComplete,
  })

  const disabled = isRunning || isRateLimited

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSweep}
        disabled={disabled}
        className={`flex items-center gap-2.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
          disabled
            ? 'bg-navy/40 text-white/50 cursor-not-allowed'
            : 'bg-navy text-white hover:bg-[var(--night)]'
        }`}
      >
        <MeridianBeacon
          size={16}
          variant="gold"
          animate={isRunning}
          arrowTip={true}
        />
        {isRunning ? 'Sweeping...' : 'Run Sweep'}
      </button>

      {isRateLimited && nextSweepAt ? (
        <span className="text-[10px] text-[var(--text3)]">
          Next sweep available {formatNextSweep(nextSweepAt)}
        </span>
      ) : lastSweepAt && !isRunning ? (
        <span className="text-[10px] text-[var(--text3)]">
          Last sweep: {formatLastSweep(lastSweepAt)}
        </span>
      ) : null}

      {error && (
        <span className="text-[10px] text-[var(--red)]">{error}</span>
      )}
    </div>
  )
}
