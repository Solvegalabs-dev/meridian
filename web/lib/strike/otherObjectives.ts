// Standalone objectives on the Strike home (FF-095 Part 1, regrouped by focus in FF-106 Stage 1):
// a user's Strike objectives that are not part of any campaign. Pure view-model code, so grouping,
// sorting and labels are testable without a database.
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import { localDateIn } from '@/lib/objectives/windowState'
import type { ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'
import { objectiveTimezone } from '@/lib/objectives/seasonMatcher'
import { resolveObjectiveTitle } from '@/lib/objectives/objectiveTitle'
import { windowStatusChip, type WindowChip } from '@/lib/strike/windowStatus'
import { endedNoticeLabel, resolveEndedNotice } from '@/lib/strikeBrief/closedBrief'
import { isClosedBrief } from '@/lib/strikeBrief/goNoGo'
import { formatDateOnly } from '@/lib/utils/dateOnly'
import { checkCoverage, type SeasonIndex } from '@/lib/strike/coverage'
import { isFishingObjective } from '@/lib/strike/objectiveKind'
import { focusState, type FocusState } from '@/lib/strike/focusState'

export type OtherObjectiveGroup = FocusState

// Group headings, exactly as specified (FF-106 Stage 1).
export const FOCUS_GROUP_HEADINGS: Record<OtherObjectiveGroup, string> = {
  now: 'Focus now',
  prep: 'Getting ready',
  radar: 'On the radar',
  next_year: 'Next year',
  ended: 'Finished',
}

export type OtherObjective = {
  // objective_profiles.id: the row links to /strike/{id}.
  id: string
  title: string
  subtitle: string
  chip: WindowChip | null
  // Trip dates, shown only when there is no chip to say where the window stands.
  dates: string | null
  // Raw trip_start (YYYY-MM-DD), for sorting within a group. Null when there is none.
  tripStart: string | null
  // go_no_go of a live brief. Null for an ended hunt or when no brief exists.
  verdict: string | null
  group: OtherObjectiveGroup
  createdAt: string | null
  // FF-096 Part 3: we have no data for this species and state. A label only; it changes nothing about briefs.
  limitedData: boolean
}

export type OtherProfileRow = ObjectiveWindowProfile & {
  geo: { water_body?: unknown; state?: unknown } | null
  created_at: string | null
}

export type OtherBrief = { go_no_go?: string | null }

// Window evaluations are keyed by objective_id. A profile with no objectives row yet (objective_id NULL)
// is keyed by its own id, so two unlinked profiles never share a slot.
export function evaluationKey(profile: { id: string; objective_id: string | null }): string {
  return profile.objective_id ?? profile.id
}

const GROUP_ORDER: Record<OtherObjectiveGroup, number> = { now: 0, prep: 1, radar: 2, next_year: 3, ended: 4 }

function tripDates(timing: ObjectiveWindowProfile['timing']): string | null {
  const start = typeof timing?.trip_start === 'string' ? timing.trip_start : null
  if (!start) return null
  const end = typeof timing?.trip_end === 'string' ? timing.trip_end : null
  return end ? `${formatDateOnly(start)} – ${formatDateOnly(end)}` : formatDateOnly(start)
}

function tripStartDate(timing: ObjectiveWindowProfile['timing']): string | null {
  return typeof timing?.trip_start === 'string' ? timing.trip_start : null
}

// Group order first (focus now ... finished). Inside a group: soonest trip_start first (one with no
// trip_start sorts after any that has one), then newest created. Finished sorts newest first, same as before.
export function sortOtherObjectives(items: OtherObjective[]): OtherObjective[] {
  return [...items].sort((a, b) => {
    const byGroup = GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
    if (byGroup !== 0) return byGroup
    if (a.group !== 'ended') {
      if (a.tripStart && b.tripStart) {
        const byDate = a.tripStart.localeCompare(b.tripStart)
        if (byDate !== 0) return byDate
      } else if (a.tripStart || b.tripStart) {
        return a.tripStart ? -1 : 1
      }
    }
    const created = (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    return created !== 0 ? created : a.id.localeCompare(b.id)
  })
}

export function buildOtherObjectives(input: {
  profiles: OtherProfileRow[]
  evaluations: Map<string, WindowEvaluation>
  // Latest brief per objective_id.
  briefs: Map<string, OtherBrief>
  // objectives.title per objective_id.
  storedTitles: Map<string, string | null>
  // The hunt_seasons index, null when it could not be read. Omit to skip the coverage label.
  seasonIndex?: SeasonIndex | null
  // The instant "today" is evaluated at, per objective's own local timezone. Defaults to now.
  now?: Date
}): OtherObjective[] {
  const now = input.now ?? new Date()
  const items = input.profiles.map((p): OtherObjective => {
    const key = evaluationKey(p)
    const evaluation = input.evaluations.get(key) ?? null
    const ended = resolveEndedNotice({ evaluation, profileStatus: p.status, endedReason: p.ended_reason })
    const chip: WindowChip | null = ended
      ? { label: endedNoticeLabel(ended), tone: 'ended' }
      : windowStatusChip(evaluation, isFishingObjective(p))

    const brief = input.briefs.get(key) ?? null
    const verdict = !ended && brief?.go_no_go && !isClosedBrief(brief) ? brief.go_no_go : null

    const today = localDateIn(now, objectiveTimezone(p))
    const taxonomy = (p.taxonomy_key ?? '').replace(/\./g, ' · ')
    return {
      id: p.id,
      title: resolveObjectiveTitle({
        storedTitle: input.storedTitles.get(key) ?? null,
        taxonomyKey: p.taxonomy_key,
        state: p.state,
        huntCode: p.hunt_code,
        waterBody: typeof p.geo?.water_body === 'string' ? p.geo.water_body : null,
      }),
      subtitle: p.hunt_code && !isFishingObjective(p) ? `${p.hunt_code} · ${taxonomy}` : taxonomy,
      chip,
      dates: chip ? null : tripDates(p.timing),
      tripStart: tripStartDate(p.timing),
      verdict,
      group: focusState(evaluation, p.status, today),
      createdAt: p.created_at,
      limitedData: input.seasonIndex === undefined
        ? false
        : checkCoverage({ taxonomyKey: p.taxonomy_key, state: p.state, seasonIndex: input.seasonIndex }).covered === false,
    }
  })
  return sortOtherObjectives(items)
}

// Row classes. Opaque backgrounds only (no /30 alpha), no opacity, and each text size meets the floor:
// body text 14 px (text-sm) or larger, labels 12 px (text-xs) or larger, the row at least 44 px tall.
// The "Limited data" label: opaque amber pair, same palette as the CONDITIONAL verdict pill.
export const LIMITED_DATA_TONE = { bg: '#78350f', color: '#fde68a' } as const

export const OTHER_OBJECTIVE_CLASSES = {
  heading: 'px-4 mb-2 text-xs font-medium uppercase tracking-wider text-slate-300',
  card: 'bg-slate-800 rounded-xl mx-4 overflow-hidden',
  row: 'flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-slate-700 last:border-0 hover:bg-slate-700 transition-colors',
  title: 'text-base font-medium text-white',
  titleEnded: 'text-base font-medium text-slate-300',
  subtitle: 'text-xs text-slate-300',
  chip: 'text-xs font-medium px-2 py-1 rounded',
  limited: 'text-xs font-medium px-2 py-1 rounded',
  verdict: 'text-xs font-bold px-2 py-1 rounded',
  dates: 'text-xs text-slate-300',
  chevron: 'text-slate-300 text-base',
  // Spotlight card (FF-106 Stage 1): the first "Focus now" / "Next up" item, larger than a normal row
  // but the same tap target convention (min 44 px, whole card clickable).
  spotlightCard: 'flex items-center gap-3 mx-4 px-4 py-4 min-h-[56px] bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors border border-slate-700',
  spotlightLabel: 'px-4 mb-2 text-xs font-medium uppercase tracking-wider text-blue-300',
  spotlightTitle: 'text-lg font-semibold text-white',
  // Collapsible section summary (On the radar / Next year once over 3 items, Finished always).
  sectionSummary: 'flex items-center min-h-[44px] px-4 mb-2 text-xs font-medium uppercase tracking-wider text-slate-300 cursor-pointer',
  removedSummary: 'flex items-center min-h-[44px] px-4 text-sm font-medium text-slate-200 cursor-pointer',
  removedRow: 'flex items-center gap-3 px-4 py-2 min-h-[56px] border-b border-slate-700 last:border-0',
  removedTitle: 'flex-1 min-w-0 text-sm text-slate-200 break-words',
  restoreButton: 'min-h-[44px] px-4 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors flex-shrink-0',
  removedMessage: 'px-4 py-2 text-sm text-slate-100',
  prompt: 'text-center py-16 px-4',
  promptTitle: 'text-base font-medium text-white',
  promptBody: 'text-sm text-slate-300 mt-1',
  promptButton: 'inline-flex items-center justify-center min-h-[44px] mt-4 px-4 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors',
} as const
