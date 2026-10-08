'use client'

import type { ReactNode } from 'react'
import { NO_DATA_PROMPT } from '@/lib/strike/sweepStatus'
import SignalChipRow, { parseChips } from './SignalChipRow'

type Props = {
  brief: Record<string, unknown> | null
  objective: Record<string, unknown>
  // FF-098: the Run Sweep prompt, in place of "No signal data yet", and above old data.
  emptyPrompt?: ReactNode
  stalePrompt?: ReactNode
}

export default function StrikeIntelPanel({ brief, emptyPrompt, stalePrompt }: Props) {
  const chips = parseChips(brief?.signal_chips)

  return (
    <div className="p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Signal Chips</div>
      {chips.length === 0 ? (
        emptyPrompt ?? <div className="text-slate-100 text-sm">{NO_DATA_PROMPT}</div>
      ) : (
        <>
        {stalePrompt && <div className="mb-3">{stalePrompt}</div>}
        <SignalChipRow chips={chips} />
        </>
      )}
    </div>
  )
}
