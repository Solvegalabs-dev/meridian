// What the Strike tabs say about sweeps (FF-098 Part 1). There is no scheduled user sweep: the user runs it, so the
// tabs say so when an objective has no sweep data yet or the data is old. Pure and client-safe.

// A sweep older than this many days is stale.
export const SWEEP_STALE_DAYS = 3

// Same limit /api/sweep enforces.
const RATE_LIMIT_MS = 23 * 60 * 60 * 1000
const RATE_LIMITED_TYPES = new Set(['alpha_personal', 'alpha_business', 'beta', 'personal'])
const DAY_MS = 24 * 60 * 60 * 1000

export const NO_DATA_PROMPT = 'No intel yet. Tap Run Sweep to get intel for this objective.'
export const SWEEP_SCOPE_LINE = 'Checks all your active objectives'

export function stalePrompt(days: number): string {
  return `Last sweep ${days} ${days === 1 ? 'day' : 'days'} ago. Tap Run Sweep to refresh.`
}

export type SweepPrompt =
  | { kind: 'none' }
  | { kind: 'no_data'; text: string }
  | { kind: 'stale'; days: number; text: string }

// null latestDataAt means the objective has no sweep data. Older than SWEEP_STALE_DAYS is stale. Otherwise nothing.
export function sweepPromptFor(latestDataAt: string | null | undefined, now: Date = new Date()): SweepPrompt {
  if (!latestDataAt) return { kind: 'no_data', text: NO_DATA_PROMPT }
  const t = Date.parse(latestDataAt)
  if (Number.isNaN(t)) return { kind: 'no_data', text: NO_DATA_PROMPT }
  const ageMs = now.getTime() - t
  if (ageMs > SWEEP_STALE_DAYS * DAY_MS) {
    const days = Math.floor(ageMs / DAY_MS)
    return { kind: 'stale', days, text: stalePrompt(days) }
  }
  return { kind: 'none' }
}

// Where an empty tab points the user: the stale line if data exists but is old, otherwise "no intel yet".
export function emptyTabPrompt(latestDataAt: string | null | undefined, now: Date = new Date()): SweepPrompt {
  const prompt = sweepPromptFor(latestDataAt, now)
  return prompt.kind === 'stale' ? prompt : { kind: 'no_data', text: NO_DATA_PROMPT }
}

export type SweepInfo = {
  // profiles.last_sweep_at, for "Last sweep: 2d ago".
  lastSweepAt: string | null
  // When the 23-hour limit ends, or null when the user can sweep now.
  nextSweepAt: string | null
  // The newest sweep data covering this objective, or null when there is none.
  latestDataAt: string | null
}

// The user's last sweep covers this objective only if the objective existed at the time. A tagged signal is also
// sweep data. The newer of the two is the objective's latest data.
export function computeSweepInfo(input: {
  accountType: string | null | undefined
  email: string | null | undefined
  lastSweepAt: string | null | undefined
  objectiveCreatedAt: string | null | undefined
  latestSignalAt: string | null | undefined
  now?: Date
}): SweepInfo {
  const now = input.now ?? new Date()
  const lastSweepAt = input.lastSweepAt ?? null

  let nextSweepAt: string | null = null
  const internal = input.email?.endsWith('@solvegalabs.com') ?? false
  if (!internal && RATE_LIMITED_TYPES.has(input.accountType ?? 'personal') && lastSweepAt) {
    const next = new Date(new Date(lastSweepAt).getTime() + RATE_LIMIT_MS)
    if (next > now) nextSweepAt = next.toISOString()
  }

  const covers = lastSweepAt !== null
    && (!input.objectiveCreatedAt || Date.parse(lastSweepAt) >= Date.parse(input.objectiveCreatedAt))
  const candidates = [covers ? lastSweepAt : null, input.latestSignalAt ?? null]
    .filter((v): v is string => !!v && !Number.isNaN(Date.parse(v)))
  const latestDataAt = candidates.length > 0
    ? candidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
    : null

  return { lastSweepAt, nextSweepAt, latestDataAt }
}
