import { describe, it, expect } from 'vitest'
import { goNoGoKind, isClosedBrief } from './goNoGo'

describe('goNoGoKind', () => {
  it('classifies every value the model and the code can write', () => {
    expect(goNoGoKind('GO')).toBe('go')
    expect(goNoGoKind('CONDITIONAL')).toBe('conditional')
    expect(goNoGoKind('MONITOR')).toBe('monitor')
    expect(goNoGoKind('NO_GO')).toBe('no_go')
    expect(goNoGoKind('CLOSED')).toBe('closed')
  })

  it('accepts the hyphenated and lowercase spellings used elsewhere', () => {
    expect(goNoGoKind('NO-GO')).toBe('no_go')
    expect(goNoGoKind('no go')).toBe('no_go')
    expect(goNoGoKind('go')).toBe('go')
    expect(goNoGoKind(' closed ')).toBe('closed')
  })

  it('unknown values are never GO', () => {
    for (const v of ['GOOD', 'GO AHEAD', 'WAIT', 'proceed', '', null, undefined]) {
      expect(goNoGoKind(v)).not.toBe('go')
    }
    expect(goNoGoKind('WAIT')).toBe('unknown')
    expect(goNoGoKind(undefined)).toBe('unknown')
  })

  it('isClosedBrief reads only the CLOSED value', () => {
    expect(isClosedBrief({ go_no_go: 'CLOSED' })).toBe(true)
    expect(isClosedBrief({ go_no_go: 'GO' })).toBe(false)
    expect(isClosedBrief(null)).toBe(false)
  })
})
