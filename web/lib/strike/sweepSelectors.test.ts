import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeSupabase, type FakeCall } from '@/lib/testing/fakeSupabase'
import { selectAgentSwarmProfiles, selectStrikeProfilesForSweep } from './sweepSelectors'

const asDb = (sb: ReturnType<typeof fakeSupabase>) => sb as unknown as Parameters<typeof selectAgentSwarmProfiles>[0]

async function run(build: (db: Parameters<typeof selectAgentSwarmProfiles>[0]) => PromiseLike<unknown>): Promise<FakeCall> {
  const sb = fakeSupabase(() => ({ data: [] }))
  await build(asDb(sb))
  return sb.calls[0]
}

describe('FF-096 selectors skip archived objectives', () => {
  it('the agent swarm cron excludes archived and completed profiles', async () => {
    const call = await run(db => selectAgentSwarmProfiles(db))
    expect(call.table).toBe('objective_profiles')
    expect(call.filters).toContainEqual(['status', 'neq', 'archived'])
    expect(call.filters).toContainEqual(['status', 'neq', 'completed'])
  })

  it('the sweep Strike pass excludes archived even when the profile was lifecycle-ended first', async () => {
    const call = await run(db => selectStrikeProfilesForSweep(db, 'user-1'))
    expect(call.filters).toContainEqual(['status', 'neq', 'archived'])
    expect(call.filters).toContainEqual(['user_id', 'eq', 'user-1'])
    expect(call.filters).toContainEqual(['org_source', 'eq', 'strike'])
    // The ended_at branch of the OR is what would let an archived, previously-ended profile through.
    expect(call.filters).toContainEqual(['or', 'or', 'status.eq.active,ended_at.not.is.null'])
  })
})

// Every selector that feeds a sweep, an agent run, a brief or a signal tag. Each either goes through a
// helper above or filters on an allow-list of statuses that does not include 'archived'. This pins the
// audit: change one of these queries and this test says which file to re-check.
const AUDITED: Array<{ file: string; pattern: RegExp; why: string }> = [
  { file: 'app/api/cron/agent-swarm/route.ts', pattern: /selectAgentSwarmProfiles\(/, why: 'agent swarm cron' },
  { file: 'lib/sweep/runSweepForUser.ts', pattern: /selectStrikeProfilesForSweep\(/, why: 'sweep Strike brief pass and agent binding' },
  { file: 'lib/sweep/runSweepForUser.ts', pattern: /\.from\('objectives'\)\s*\.select\('\*'\)\s*\.eq\('user_id', userId\)\s*\.eq\('status', 'active'\)/, why: 'sweep objective list' },
  { file: 'app/api/cron/strike-brief-push/route.ts', pattern: /\.eq\('status', 'active'\)/, why: 'Strike brief push cron' },
  { file: 'lib/objectives/objectiveWindow.ts', pattern: /\.in\('status', \['active', 'completed'\]\)/, why: 'window lifecycle (never ends or reactivates an archived profile)' },
  { file: 'lib/ask/extractSignals.ts', pattern: /\.eq\('status', 'active'\)/, why: 'signal tagging' },
  { file: 'lib/calendar/syncCalendarConnection.ts', pattern: /\.eq\('status', 'active'\)/, why: 'calendar sync' },
  { file: 'app/api/checkin/route.ts', pattern: /\.eq\('status', 'active'\)/, why: 'check-in' },
  { file: 'app/api/ask/route.ts', pattern: /\.eq\('status', 'active'\)/, why: 'Ask' },
  { file: 'lib/voice/generateVoiceBrief.ts', pattern: /\.in\('status', \['active', 'on_track', 'at_risk'\]\)/, why: 'voice brief' },
  { file: 'lib/concierge/buildConciergeContext.ts', pattern: /\.in\('status', \['active', 'paused'\]\)/, why: 'concierge context' },
  { file: 'app/api/strike-brief/route.ts', pattern: /\.neq\('status', 'archived'\)/, why: 'on-demand Strike brief' },
]

describe('FF-096 audited selectors', () => {
  for (const { file, pattern, why } of AUDITED) {
    it(`${file} (${why})`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source).toMatch(pattern)
      // None of them lists 'archived' as an included status.
      expect(source).not.toMatch(/\.(in|eq)\([^)]*'archived'/)
    })
  }
})
