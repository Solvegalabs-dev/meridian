// Header status chip from the evaluated window. Null when there is nothing honest to say.
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import { formatDateOnly } from '@/lib/utils/dateOnly'

export type WindowChip = { label: string; tone: 'live' | 'pending' | 'ended' }

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
