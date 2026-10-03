import { describe, it, expect } from 'vitest'
import { evaluatePivot, isClosedUnit } from './pivot-logic'

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

// Primary has collapsed over the week (sharp drop), so a pivot would normally fire.
const primary = (status = 'active') => ({
  id: 'p',
  objective_id: 'obj-primary',
  role: 'primary',
  rank: 1,
  status,
  confidence_trajectory: [
    { date: daysAgo(7), confidence_pct: 80, tier: 'T2', go_no_go: 'GO' },
    { date: daysAgo(0), confidence_pct: 40, tier: 'T3', go_no_go: 'MONITOR' },
  ],
})

const fallback = (id: string, status: string, pct: number) => ({
  id,
  objective_id: `obj-${id}`,
  role: 'fallback_1',
  rank: 2,
  status,
  confidence_trajectory: [{ date: daysAgo(0), confidence_pct: pct, tier: 'T2', go_no_go: 'GO' }],
})

describe('isClosedUnit', () => {
  it('expired, missed, completed and closed units are closed', () => {
    for (const s of ['expired', 'missed', 'completed', 'closed']) expect(isClosedUnit({ status: s })).toBe(true)
  })

  it('active units are open', () => {
    expect(isClosedUnit({ status: 'active' })).toBe(false)
  })
})

describe('evaluatePivot skips closed units', () => {
  it('never pivots to a closed fallback, even the most confident one', () => {
    const r = evaluatePivot(primary() as never, [
      fallback('expired', 'expired', 95) as never,
      fallback('open', 'active', 60) as never,
    ])
    expect(r?.should_pivot).toBe(true)
    expect(r?.to_objective_id).toBe('obj-open')
  })

  it('returns null when every fallback is closed', () => {
    const r = evaluatePivot(primary() as never, [
      fallback('expired', 'expired', 95) as never,
      fallback('missed', 'missed', 90) as never,
    ])
    expect(r).toBeNull()
  })

  it('a closed primary never pivots', () => {
    const r = evaluatePivot(primary('expired') as never, [fallback('open', 'active', 60) as never])
    expect(r).toBeNull()
  })
})
