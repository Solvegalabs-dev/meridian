'use client'

// Shown on the Brief, Intel and Signals tabs when an objective has no sweep data yet, or the data is old
// (FF-098). One tap: the Run Sweep button sits inline under the text.
import RunSweepButton from './RunSweepButton'
import type { SweepPrompt } from '@/lib/strike/sweepStatus'

export const PROMPT_CLASSES = {
  box: 'rounded-lg bg-slate-800 px-4 py-4 space-y-3',
  text: 'text-sm text-slate-100',
} as const

export default function RunSweepPrompt({ prompt, lastSweepAt, nextSweepAt }: {
  prompt: SweepPrompt
  lastSweepAt?: string | null
  nextSweepAt?: string | null
}) {
  if (prompt.kind === 'none') return null
  return (
    <div className={PROMPT_CLASSES.box} data-testid="run-sweep-prompt">
      <p className={PROMPT_CLASSES.text}>{prompt.text}</p>
      <RunSweepButton lastSweepAt={lastSweepAt} nextSweepAt={nextSweepAt} />
    </div>
  )
}
