'use client'

import { isEndedWindowState, type WindowEvaluation } from '@/lib/objectives/windowState'
import { isClosedBrief } from '@/lib/strikeBrief/goNoGo'
import { verdictStyle, TIER_CHIP } from '@/lib/strike/verdictStyles'
import { PRESEASON_CAPTION, WINDOW_CHIP_TONE, isPreseasonState, windowStatusChip } from '@/lib/strike/windowStatus'

type Props = {
  title: string
  // UDWR hunt number (FF-091), shown next to the title when saved.
  huntCode?: string | null
  taxonomyKey: string
  evaluation: WindowEvaluation | null
  // hasBrief is false when no strike_briefs row exists. The brief object still carries
  // placeholder fields in that case, so they must not be shown as a verdict or tier.
  hasBrief: boolean
  brief: Record<string, unknown> | null
  isOnline: boolean
}

export default function StrikeHeader({ title, huntCode, taxonomyKey, evaluation, hasBrief, brief, isOnline }: Props) {
  const chip = windowStatusChip(evaluation)
  const ended = evaluation ? isEndedWindowState(evaluation.state) : false
  const closed = ended || isClosedBrief(brief as { go_no_go?: string | null } | null)
  // Verdict and tier only when a real brief exists and the hunt is live.
  const showBrief = hasBrief && !closed
  const verdict = showBrief ? verdictStyle(brief?.go_no_go as string | null | undefined) : null
  const tier = showBrief ? (brief?.confidence_tier as string | null | undefined) ?? null : null

  return (
    <div className="px-4 py-3 border-b border-slate-700 space-y-2">
      <div className="min-w-0">
        <div className="text-xs text-slate-300 uppercase tracking-wider">Strike Brief</div>
        <h1 className="text-white font-semibold text-lg leading-tight line-clamp-2 break-words">{title}</h1>
        <div className="text-xs text-slate-300 truncate">
          {huntCode && <span className="font-semibold text-slate-100">{huntCode} · </span>}
          {taxonomyKey.replace(/\./g, ' · ')}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {verdict && (
          <div className="flex flex-col gap-1">
            <span
              className="self-start text-2xl font-bold leading-none px-3 py-2 rounded-lg"
              style={{ backgroundColor: verdict.bg, color: verdict.color }}
            >
              {verdict.label}
            </span>
            {isPreseasonState(evaluation) && (
              <span className="text-sm text-slate-200">{PRESEASON_CAPTION}</span>
            )}
          </div>
        )}
        {tier && TIER_CHIP[tier] && (
          <span
            className="text-sm font-bold px-2 py-1 rounded"
            style={{ backgroundColor: TIER_CHIP[tier].bg, color: TIER_CHIP[tier].color }}
          >
            {tier}
          </span>
        )}
        {chip && (
          <span
            className="text-sm font-medium px-2 py-1 rounded"
            style={{ backgroundColor: WINDOW_CHIP_TONE[chip.tone].bg, color: WINDOW_CHIP_TONE[chip.tone].color }}
          >
            {chip.label}
          </span>
        )}
        {!isOnline && <span className="text-sm text-amber-300 ml-auto">Offline</span>}
      </div>
    </div>
  )
}
