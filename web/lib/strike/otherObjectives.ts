// "Other objectives" on the Strike home (FF-095 Part 1): a user's Strike objectives that are not part
// of any campaign. Pure view-model code, so grouping, sorting and labels are testable without a database.
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import type { ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'
import { resolveObjectiveTitle } from '@/lib/objectives/objectiveTitle'
import { windowStatusChip, type WindowChip } from '@/lib/strike/windowStatus'
import { endedNoticeLabel, resolveEndedNotice } from '@/lib/strikeBrief/closedBrief'
import { isClosedBrief } from '@/lib/strikeBrief/goNoGo'
import { formatDateOnly } from '@/lib/utils/dateOnly'
import { checkCoverage, type SeasonIndex } from '@/lib/strike/coverage'

export type OtherObjectiveGroup = 'active' | 'upcoming' | 'ended'

export type OtherObjective = {
  // objective_profiles.id: the row links to /strike/{id}.
  id: string
  title: string
  subtitle: string
  chip: WindowChip | null
  // Trip dates, shown only when there is no chip to say where the window stands.
  dates: string | null
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

const GROUP_ORDER: Record<OtherObjectiveGroup, number> = { active: 0, upcoming: 1, ended: 2 }

function groupFor(evaluation: WindowEvaluation | null, ended: boolean): OtherObjectiveGroup {
  if (ended) return 'ended'
  if (evaluation?.state === 'upcoming' || evaluation?.state === 'season_not_open') return 'upcoming'
  return 'active'
}

function tripDates(timing: ObjectiveWindowProfile['timing']): string | null {
  const start = typeof timing?.trip_start === 'string' ? timing.trip_start : null
  if (!start) return null
  const end = typeof timing?.trip_end === 'string' ? timing.trip_end : null
  return end ? `${formatDateOnly(start)} – ${formatDateOnly(end)}` : formatDateOnly(start)
}

// Active first, then upcoming, then ended. Newest first inside each group.
export function sortOtherObjectives(items: OtherObjective[]): OtherObjective[] {
  return [...items].sort((a, b) => {
    const byGroup = GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
    if (byGroup !== 0) return byGroup
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
}): OtherObjective[] {
  const items = input.profiles.map((p): OtherObjective => {
    const key = evaluationKey(p)
    const evaluation = input.evaluations.get(key) ?? null
    const ended = resolveEndedNotice({ evaluation, profileStatus: p.status, endedReason: p.ended_reason })
    const chip: WindowChip | null = ended
      ? { label: endedNoticeLabel(ended), tone: 'ended' }
      : windowStatusChip(evaluation)

    const brief = input.briefs.get(key) ?? null
    const verdict = !ended && brief?.go_no_go && !isClosedBrief(brief) ? brief.go_no_go : null

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
      subtitle: p.hunt_code ? `${p.hunt_code} · ${taxonomy}` : taxonomy,
      chip,
      dates: chip ? null : tripDates(p.timing),
      verdict,
      group: groupFor(evaluation, ended !== null),
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
