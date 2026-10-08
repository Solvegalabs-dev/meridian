'use client'

// "Run Sweep" on a Strike objective page (FF-098). The same action as Mission Control's button, through the
// shared hook: one sweep covers every active objective and counts once toward the 23-hour limit.
import { useRunSweep } from '@/lib/sweep/useRunSweep'
import { formatLastSweep, formatNextSweep } from '@/lib/sweep/runSweep'
import { SWEEP_SCOPE_LINE } from '@/lib/strike/sweepStatus'

export const SWEEP_BUTTON_CLASSES = {
  button: 'inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-600 transition-colors disabled:bg-slate-600 disabled:text-slate-300 disabled:cursor-not-allowed',
  line: 'text-xs text-slate-300',
  error: 'text-sm text-red-300',
} as const

// Presentational. Separate from the hook so the markup can be checked without a browser.
export function RunSweepButtonView(props: {
  isRunning: boolean
  disabled: boolean
  rateLimitedNext: string | null
  lastSweepAt: string | null
  error: string | null
  onRun: () => void
}) {
  const { isRunning, disabled, rateLimitedNext, lastSweepAt, error, onRun } = props
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={onRun} disabled={disabled} className={SWEEP_BUTTON_CLASSES.button}>
        {isRunning ? 'Sweeping...' : 'Run Sweep'}
      </button>
      <span className={SWEEP_BUTTON_CLASSES.line}>{SWEEP_SCOPE_LINE}</span>
      {rateLimitedNext ? (
        <span className={SWEEP_BUTTON_CLASSES.line}>Next sweep available {formatNextSweep(rateLimitedNext)}</span>
      ) : lastSweepAt && !isRunning ? (
        <span className={SWEEP_BUTTON_CLASSES.line}>Last sweep: {formatLastSweep(lastSweepAt)}</span>
      ) : null}
      {error && <span role="alert" className={SWEEP_BUTTON_CLASSES.error}>{error}</span>}
    </div>
  )
}

export default function RunSweepButton({ lastSweepAt, nextSweepAt }: { lastSweepAt?: string | null; nextSweepAt?: string | null }) {
  const { isRunning, error, nextSweepAt: limitedUntil, rateLimited, disabled, run } = useRunSweep({ nextSweepAt })
  return (
    <RunSweepButtonView
      isRunning={isRunning}
      disabled={disabled}
      rateLimitedNext={rateLimited ? limitedUntil : null}
      lastSweepAt={lastSweepAt ?? null}
      error={error}
      onRun={run}
    />
  )
}
