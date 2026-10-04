// "Check for newer brief" on the Strike Brief tab. Asks the server for the stored brief and says what changed.
import { hasStoredBrief, briefTimeLabel } from './briefFreshness'

export type BriefRefreshResult = 'same' | 'new' | 'offline' | 'error'

// How long the "same" and "new" notes stay on screen before they clear.
export const REFRESH_NOTE_MS = 4000

export type StrikeBriefPayload = Record<string, unknown> & {
  brief_generated_at: string
  time_windows: unknown[] | null
}

// Only a real brief (or the no-brief stub) may replace the one on screen. Anything else counts as an error.
export function isBriefPayload(value: unknown): value is StrikeBriefPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (!(v.time_windows === null || Array.isArray(v.time_windows))) return false
  return typeof v.brief_generated_at === 'string' && !Number.isNaN(Date.parse(v.brief_generated_at))
}

type CheckInput = {
  objectiveId: string
  // brief_generated_at of the brief on screen, or null when none is shown.
  currentGeneratedAt: string | null
  online: boolean
  fetchFn?: typeof fetch
}

export type CheckOutcome = { result: BriefRefreshResult; brief?: StrikeBriefPayload }

// Returns the brief only for 'new'. 'same', 'offline' and 'error' never give the caller a brief to show.
export async function checkForNewerBrief({
  objectiveId,
  currentGeneratedAt,
  online,
  fetchFn = fetch,
}: CheckInput): Promise<CheckOutcome> {
  if (!online) return { result: 'offline' }

  let payload: unknown
  try {
    const res = await fetchFn(
      `/api/mip/brief?objective_id=${encodeURIComponent(objectiveId)}&partner_key=strike`
    )
    if (!res.ok) return { result: 'error' }
    payload = await res.json()
  } catch {
    return { result: 'error' }
  }

  if (!isBriefPayload(payload)) return { result: 'error' }
  // No stored brief yet: nothing newer to load, and the stub must not replace a brief on screen.
  if (!hasStoredBrief(payload)) return { result: 'same' }
  if (currentGeneratedAt && Date.parse(payload.brief_generated_at) <= Date.parse(currentGeneratedAt)) {
    return { result: 'same' }
  }
  return { result: 'new', brief: payload }
}

export function refreshMessage(result: BriefRefreshResult, generatedAt: string | null): string {
  switch (result) {
    case 'offline':
      return "You're offline. Showing the saved brief."
    case 'new':
      return 'New brief loaded.'
    case 'error':
      return "Couldn't check right now. Try again in a minute."
    case 'same':
      return generatedAt
        ? `No newer brief. The latest is from ${briefTimeLabel(generatedAt)}. Briefs update with each scheduled sweep.`
        : 'No newer brief. Briefs update with each scheduled sweep.'
  }
}
