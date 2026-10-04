// How many hunt spots an objective may hold. Limits are config, not UI: the 5 and 10
// tiers are a change to maxSpotsForUser() only.

export const DEFAULT_SPOT_LIMIT = 3

// Founder and tester accounts with no cap. Comma-separated user ids in an env var, so no
// account ids live in source.
export function uncappedUserIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.SPOT_LIMIT_UNCAPPED_USER_IDS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )
}

// Infinity means uncapped. API responses send null for it.
export function maxSpotsForUser(userId: string, env: Record<string, string | undefined> = process.env): number {
  return uncappedUserIds(env).has(userId) ? Infinity : DEFAULT_SPOT_LIMIT
}

export function limitForResponse(limit: number): number | null {
  return Number.isFinite(limit) ? limit : null
}
