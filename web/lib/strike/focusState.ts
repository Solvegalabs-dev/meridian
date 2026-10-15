// Focus grouping for the Strike home (FF-106 Stage 1): where an objective sits on the
// calendar, not just whether its window is open. Pure: no DB, no network.
import { parseCalendarDate, type WindowEvaluation } from '@/lib/objectives/windowState'

export type FocusState = 'now' | 'prep' | 'radar' | 'next_year' | 'ended'

export const FOCUS_NOW_DAYS = 14
export const FOCUS_PREP_DAYS = 90
export const FOCUS_RADAR_DAYS = 180

// Whole calendar days from `today` to `dateStr` (both YYYY-MM-DD). Same UTC-midnight
// construction as parseCalendarDate, so DST never moves the count.
function daysUntil(dateStr: string, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number)
  const [dy, dm, dd] = dateStr.split('-').map(Number)
  const todayUtc = Date.UTC(ty, tm - 1, td)
  const targetUtc = Date.UTC(dy, dm - 1, dd)
  return Math.round((targetUtc - todayUtc) / 86400000)
}

export function focusState(
  evaluation: WindowEvaluation | null,
  profileStatus: string | null,
  today: string
): FocusState {
  if (evaluation && (evaluation.state === 'season_closed' || evaluation.state === 'trip_ended')) return 'ended'
  if (profileStatus === 'completed') return 'ended'

  if (!evaluation) return 'radar'

  if (evaluation.state === 'active') return 'now'

  if (evaluation.state === 'upcoming' || evaluation.state === 'season_not_open') {
    const target = evaluation.detail.trip_start ?? evaluation.detail.season_start
    if (!target || !parseCalendarDate(target)) return 'radar'
    const days = daysUntil(target, today)
    if (days <= FOCUS_NOW_DAYS) return 'now'
    if (days <= FOCUS_PREP_DAYS) return 'prep'
    if (days <= FOCUS_RADAR_DAYS) return 'radar'
    return 'next_year'
  }

  // no_dates, or anything else not covered above.
  return 'radar'
}
