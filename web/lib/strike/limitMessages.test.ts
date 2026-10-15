import { describe, it, expect } from 'vitest'
import { slotsSummaryLine, totalLimitMessage, limitReachedMessage } from './limitMessages'

describe('slotsSummaryLine', () => {
  it('formats "Hunting N of M · Fishing N of M"', () => {
    expect(slotsSummaryLine({ used: 1, max: 3 }, { used: 0, max: 3 })).toBe('Hunting 1 of 3 · Fishing 0 of 3')
    expect(slotsSummaryLine({ used: 3, max: 3 }, { used: 2, max: 3 })).toBe('Hunting 3 of 3 · Fishing 2 of 3')
  })
})

describe('totalLimitMessage', () => {
  it('names the limit and tells the user what to do', () => {
    expect(totalLimitMessage(5)).toBe("You're at your limit of 5 active objectives. Remove or finish one to add another.")
  })
})

describe('limitReachedMessage', () => {
  it('names hunting specifically for the hunt category', () => {
    expect(limitReachedMessage('hunt', 3)).toBe('You already have 3 active hunting objectives. Remove or finish one to add another.')
  })

  it('names fishing specifically for the fish category', () => {
    expect(limitReachedMessage('fish', 3)).toBe('You already have 3 active fishing objectives. Remove or finish one to add another.')
  })

  it('falls back to the total message for the total category', () => {
    expect(limitReachedMessage('total', 5)).toBe(totalLimitMessage(5))
  })
})
