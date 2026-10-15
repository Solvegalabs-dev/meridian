import { describe, it, expect } from 'vitest'
import { shouldCollectThisCycle } from './collectionCadence'

// UTC Monday 2026-10-19 (a known Monday) at various hours.
const mondayAt = (hour: number) => new Date(Date.UTC(2026, 9, 19, hour, 0, 0))
// UTC Tuesday 2026-10-20 at hour 6 — same hour as the Monday run, but the wrong weekday.
const tuesdayAt6 = new Date(Date.UTC(2026, 9, 20, 6, 0, 0))

describe('shouldCollectThisCycle', () => {
  it('now and prep collect every cycle, any hour', () => {
    for (const hour of [0, 6, 12, 18]) {
      expect(shouldCollectThisCycle('now', mondayAt(hour))).toBe(true)
      expect(shouldCollectThisCycle('prep', mondayAt(hour))).toBe(true)
    }
  })

  it('radar collects only at UTC hour 6', () => {
    expect(shouldCollectThisCycle('radar', mondayAt(6))).toBe(true)
    expect(shouldCollectThisCycle('radar', mondayAt(0))).toBe(false)
    expect(shouldCollectThisCycle('radar', mondayAt(12))).toBe(false)
    expect(shouldCollectThisCycle('radar', mondayAt(18))).toBe(false)
  })

  it('next_year collects only at UTC hour 6 on a Monday', () => {
    expect(shouldCollectThisCycle('next_year', mondayAt(6))).toBe(true)
    expect(shouldCollectThisCycle('next_year', mondayAt(0))).toBe(false)
    expect(shouldCollectThisCycle('next_year', mondayAt(12))).toBe(false)
    expect(shouldCollectThisCycle('next_year', tuesdayAt6)).toBe(false)
  })

  it('ended never collects', () => {
    for (const hour of [0, 6, 12, 18]) {
      expect(shouldCollectThisCycle('ended', mondayAt(hour))).toBe(false)
    }
  })

  it('every weekday is checked for next_year: only Monday collects', () => {
    for (let day = 0; day <= 6; day++) {
      const date = new Date(Date.UTC(2026, 9, 18 + day, 6, 0, 0)) // 2026-10-18 is a Sunday
      expect(shouldCollectThisCycle('next_year', date)).toBe(date.getUTCDay() === 1)
    }
  })
})
