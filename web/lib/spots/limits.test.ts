import { describe, it, expect } from 'vitest'
import { DEFAULT_SPOT_LIMIT, limitForResponse, maxSpotsForUser, uncappedUserIds } from './limits'

describe('maxSpotsForUser', () => {
  it('defaults to 3 for an ordinary account', () => {
    expect(maxSpotsForUser('user-a', {})).toBe(DEFAULT_SPOT_LIMIT)
    expect(DEFAULT_SPOT_LIMIT).toBe(3)
  })

  it('is uncapped for ids in the env allowlist', () => {
    const env = { SPOT_LIMIT_UNCAPPED_USER_IDS: 'founder-1, tester-2 ' }
    expect(maxSpotsForUser('founder-1', env)).toBe(Infinity)
    expect(maxSpotsForUser('tester-2', env)).toBe(Infinity)
    expect(maxSpotsForUser('user-a', env)).toBe(3)
  })

  it('an empty or missing allowlist caps everyone', () => {
    expect(uncappedUserIds({}).size).toBe(0)
    expect(maxSpotsForUser('founder-1', { SPOT_LIMIT_UNCAPPED_USER_IDS: '' })).toBe(3)
  })

  it('the API sends null for uncapped', () => {
    expect(limitForResponse(Infinity)).toBeNull()
    expect(limitForResponse(3)).toBe(3)
  })
})
