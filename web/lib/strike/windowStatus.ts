// Header status chip from the evaluated window. Null when there is nothing honest to say.
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import { formatDateOnly } from '@/lib/utils/dateOnly'

export type WindowChip = { label: string; tone: 'live' | 'pending' | 'ended' }

// Opaque hex pairs so a chip reads the same on any page background. Each pair is checked for 4.5:1 in a test.
export const WINDOW_CHIP_TONE: Record<WindowChip['tone'], { bg: string; color: string }> = {
  live:    { bg: '#14532d', color: '#4ade80' },
  pending: { bg: '#1e3a8a', color: '#bfdbfe' },
  ended:   { bg: '#334155', color: '#e2e8f0' },
}

// Before the hunt window opens: a verdict here is a pre-season outlook, not a hunt-day call.
export const PRESEASON_CAPTION = 'Pre-season outlook, not a hunt-day call'

export function isPreseasonState(evaluation: WindowEvaluation | null | undefined): boolean {
  return evaluation?.state === 'upcoming' || evaluation?.state === 'season_not_open'
}

export function windowStatusChip(evaluation: WindowEvaluation | null | undefined): WindowChip | null {
  if (!evaluation) return null
  const d = evaluation.detail
  switch (evaluation.state) {
    case 'active':
      return { label: 'Active', tone: 'live' }
    case 'upcoming':
      return d.trip_start ? { label: `Opens ${formatDateOnly(d.trip_start)}`, tone: 'pending' } : null
    case 'season_not_open':
      return d.season_start ? { label: `Opens ${formatDateOnly(d.season_start)}`, tone: 'pending' } : null
    case 'season_closed':
      return { label: 'Season closed', tone: 'ended' }
    case 'trip_ended':
      return { label: 'Trip ended', tone: 'ended' }
    default:
      return null
  }
}
