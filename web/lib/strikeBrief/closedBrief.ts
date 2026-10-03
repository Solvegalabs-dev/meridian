// Deterministic brief for a hunt that is over (season_closed / trip_ended).
// No model call, no LLM text. The code owns this decision.
import { isEndedWindowState, type WindowEvaluation } from '@/lib/objectives/windowState'
import { formatDateOnly } from '@/lib/utils/dateOnly'

// Mirrors the CHECK constraints on strike_briefs. Keep in sync with
// supabase/migrations/20261002_ff089_p0_season_lifecycle.sql.
export const STRIKE_BRIEF_GO_NO_GO_VALUES = ['GO', 'NO_GO', 'CONDITIONAL', 'MONITOR', 'CLOSED'] as const
export const STRIKE_BRIEF_TIME_WINDOWS = ['0600', '1100', '1700'] as const

export type StrikeGoNoGo = (typeof STRIKE_BRIEF_GO_NO_GO_VALUES)[number]

// time_window is NOT NULL, so a closed row needs a value. '0600' is neutral:
// no UI or API path shows time_window when go_no_go is CLOSED.
export const CLOSED_BRIEF_TIME_WINDOW = '0600'

export type ClosedWindowState = 'season_closed' | 'trip_ended'

export function formatBriefDate(isoDate: string): string {
  return formatDateOnly(isoDate)
}

const CLOSED_TAIL = 'This hunt is over; Meridian has paused daily briefs for it. Reactivate or start a new objective whenever you are ready.'

// Fixed text. Dates come from the stored season/trip window, never from a model.
export function closedSynthesis(evaluation: WindowEvaluation): string {
  if (evaluation.state === 'season_closed' && evaluation.detail.season_end) {
    return `Season closed on ${formatBriefDate(evaluation.detail.season_end)}. ${CLOSED_TAIL}`
  }
  const end = evaluation.detail.trip_end
  return `Your trip window ended on ${end ? formatBriefDate(end) : 'an earlier date'}. ${CLOSED_TAIL}`
}

// Banner for an objective that has not opened yet. Null for every other state.
export function windowOpensBanner(evaluation: WindowEvaluation | null): string | null {
  if (!evaluation) return null
  if (evaluation.state === 'season_not_open' && evaluation.detail.season_start) {
    return `Season opens ${formatBriefDate(evaluation.detail.season_start)}`
  }
  if (evaluation.state === 'upcoming' && evaluation.detail.trip_start) {
    return `Trip opens ${formatBriefDate(evaluation.detail.trip_start)}`
  }
  return null
}

export type ClosedBriefFields = {
  time_window: string
  go_no_go: 'CLOSED'
  confidence_tier: null
  synthesis: string
  lead_signal: null
  condition_delta: null
  movement_windows: []
  terrain_intel: null
  terrain_source: null
}

export function buildClosedBriefFields(evaluation: WindowEvaluation): ClosedBriefFields {
  return {
    time_window: CLOSED_BRIEF_TIME_WINDOW,
    go_no_go: 'CLOSED',
    confidence_tier: null,
    synthesis: closedSynthesis(evaluation),
    lead_signal: null,
    condition_delta: null,
    movement_windows: [],
    terrain_intel: null,
    terrain_source: null,
  }
}

// An ended unit, as the list and detail pages show it. Null when the hunt is live.
export type EndedNotice = { reason: ClosedWindowState; date: string | null }

// Evaluated window state wins. Stored status (unit expired, or profile completed)
// is an extra trigger, so a stale 'active' row cannot keep a finished hunt looking live.
// Stored-only endings carry no date: the lifecycle has not confirmed the end yet.
export function resolveEndedNotice(input: {
  evaluation: WindowEvaluation | null
  unitStatus?: string | null
  profileStatus?: string | null
  endedReason?: string | null
}): EndedNotice | null {
  const ev = input.evaluation
  if (ev && isEndedWindowState(ev.state)) {
    return ev.state === 'season_closed'
      ? { reason: 'season_closed', date: ev.detail.season_end ?? null }
      : { reason: 'trip_ended', date: ev.detail.trip_end ?? null }
  }
  const storedEnded = input.unitStatus === 'expired' || input.profileStatus === 'completed'
  if (!storedEnded) return null
  return { reason: input.endedReason === 'season_closed' ? 'season_closed' : 'trip_ended', date: null }
}

// "Season closed on Sep 30" / "Trip ended on Sep 30" (the date is optional).
export function endedNoticeLabel(notice: EndedNotice): string {
  const on = notice.date ? ` on ${formatBriefDate(notice.date)}` : ''
  return notice.reason === 'season_closed' ? `Season closed${on}` : `Trip ended${on}`
}
