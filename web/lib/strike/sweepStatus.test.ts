import { describe, it, expect } from 'vitest'
import {
  NO_DATA_PROMPT,
  SWEEP_STALE_DAYS,
  computeSweepInfo,
  emptyTabPrompt,
  stalePrompt,
  sweepPromptFor,
} from './sweepStatus'

const NOW = new Date('2026-10-08T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()

describe('sweepPromptFor', () => {
  it('stale after 3 days is a single constant', () => {
    expect(SWEEP_STALE_DAYS).toBe(3)
  })

  it('no sweep data at all says there is no intel yet', () => {
    expect(sweepPromptFor(null, NOW)).toEqual({ kind: 'no_data', text: 'No intel yet. Tap Run Sweep to get intel for this objective.' })
    expect(NO_DATA_PROMPT).toBe('No intel yet. Tap Run Sweep to get intel for this objective.')
    expect(sweepPromptFor('not a date', NOW).kind).toBe('no_data')
  })

  it('data 4 days old is stale, with the day count', () => {
    expect(sweepPromptFor(ago(4), NOW)).toEqual({ kind: 'stale', days: 4, text: 'Last sweep 4 days ago. Tap Run Sweep to refresh.' })
  })

  it('data 2 days old is fresh: no prompt', () => {
    expect(sweepPromptFor(ago(2), NOW)).toEqual({ kind: 'none' })
  })

  it('exactly 3 days is not yet older than 3 days', () => {
    expect(sweepPromptFor(ago(3), NOW).kind).toBe('none')
    expect(sweepPromptFor(ago(3.1), NOW)).toMatchObject({ kind: 'stale', days: 3 })
  })

  it('the stale line is singular for one day', () => {
    expect(stalePrompt(1)).toBe('Last sweep 1 day ago. Tap Run Sweep to refresh.')
  })
})

describe('emptyTabPrompt (a tab with nothing to show)', () => {
  it('says "No intel yet" when there is no data or the data is fresh', () => {
    expect(emptyTabPrompt(null, NOW).kind).toBe('no_data')
    expect(emptyTabPrompt(ago(1), NOW).kind).toBe('no_data')
  })

  it('says how old the sweep is when the data is stale', () => {
    expect(emptyTabPrompt(ago(5), NOW)).toMatchObject({ kind: 'stale', days: 5 })
  })
})

describe('computeSweepInfo', () => {
  const base = { accountType: 'beta', email: 'tester@example.com', objectiveCreatedAt: ago(30), latestSignalAt: null, now: NOW }

  it('the next sweep is 23 hours after the last, while that is in the future', () => {
    const info = computeSweepInfo({ ...base, lastSweepAt: ago(0.25) }) // 6 hours ago
    expect(info.nextSweepAt).toBe(new Date(Date.parse(ago(0.25)) + 23 * 60 * 60 * 1000).toISOString())
  })

  it('there is no limit once the 23 hours have passed, or before any sweep', () => {
    expect(computeSweepInfo({ ...base, lastSweepAt: ago(1) }).nextSweepAt).toBeNull()
    expect(computeSweepInfo({ ...base, lastSweepAt: null }).nextSweepAt).toBeNull()
  })

  it('an internal account is not limited, matching /api/sweep', () => {
    expect(computeSweepInfo({ ...base, email: 'me@solvegalabs.com', lastSweepAt: ago(0.1) }).nextSweepAt).toBeNull()
  })

  it('an account type that is not limited has no next time', () => {
    expect(computeSweepInfo({ ...base, accountType: 'enterprise', lastSweepAt: ago(0.1) }).nextSweepAt).toBeNull()
  })

  it('an unset account type is treated as limited, as in /api/sweep', () => {
    expect(computeSweepInfo({ ...base, accountType: null, lastSweepAt: ago(0.1) }).nextSweepAt).not.toBeNull()
  })

  it('the latest data is the last sweep when it came after the objective was created', () => {
    expect(computeSweepInfo({ ...base, lastSweepAt: ago(2) }).latestDataAt).toBe(ago(2))
  })

  it('a sweep from before the objective existed did not cover it', () => {
    const info = computeSweepInfo({ ...base, objectiveCreatedAt: ago(1), lastSweepAt: ago(5) })
    expect(info.latestDataAt).toBeNull()
    expect(info.lastSweepAt).toBe(ago(5)) // still shown as the user's last sweep
  })

  it('a signal tagged to the objective counts, and the newer of the two wins', () => {
    expect(computeSweepInfo({ ...base, lastSweepAt: ago(5), latestSignalAt: ago(2) }).latestDataAt).toBe(ago(2))
    expect(computeSweepInfo({ ...base, lastSweepAt: ago(1), latestSignalAt: ago(6) }).latestDataAt).toBe(ago(1))
  })

  it('no sweep and no signal is no data', () => {
    expect(computeSweepInfo({ ...base, lastSweepAt: null }).latestDataAt).toBeNull()
  })
})
