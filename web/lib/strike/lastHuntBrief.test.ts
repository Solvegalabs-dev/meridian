import { describe, it, expect } from 'vitest'
import { selectLastHuntBrief, lastHuntHeading, cleanSynthesis } from './lastHuntBrief'
import { formatReason } from './reasonLabels'

const CLOSED = { brief_date: '2026-10-04', go_no_go: 'CLOSED', synthesis: 'Season closed on Oct 3.' }
const GO = { brief_date: '2026-10-01', go_no_go: 'GO', synthesis: 'Hold the north side. (T2: good wind)' }

describe('selectLastHuntBrief', () => {
  it('closed hunt with a CLOSED latest row and an earlier GO row: GO is the history', () => {
    expect(selectLastHuntBrief([CLOSED, GO])).toBe(GO)
  })

  it('closed hunt with only CLOSED rows: no history', () => {
    expect(selectLastHuntBrief([CLOSED, { ...CLOSED, brief_date: '2026-10-03' }])).toBeNull()
  })

  it('no rows: no history', () => {
    expect(selectLastHuntBrief([])).toBeNull()
  })

  it('skips a row with no verdict', () => {
    expect(selectLastHuntBrief([{ go_no_go: null, synthesis: 'x' }, GO])).toBe(GO)
  })
})

describe('lastHuntHeading', () => {
  it('reads "Last hunt brief, {date} · {verdict}"', () => {
    expect(lastHuntHeading({ brief_date: '2026-10-01', go_no_go: 'NO_GO' })).toMatch(/^Last hunt brief, .+ · NO GO$/)
  })

  it('never names CLOSED', () => {
    expect(lastHuntHeading(GO)).not.toContain('CLOSED')
  })
})

describe('cleanSynthesis', () => {
  it('strips tier annotations and trims', () => {
    expect(cleanSynthesis(GO.synthesis)).toBe('Hold the north side.')
  })

  it('returns null for empty text', () => {
    expect(cleanSynthesis('   ')).toBeNull()
    expect(cleanSynthesis(null)).toBeNull()
  })
})

describe('formatReason', () => {
  it('maps access_fell_through to readable text', () => {
    expect(formatReason('access_fell_through')).toBe('Access fell through')
  })

  it('renders unknown snake_case codes as sentence case with spaces', () => {
    expect(formatReason('landowner_denied_access')).toBe('Landowner denied access')
    expect(formatReason('weather__hold')).toBe('Weather hold')
  })

  it('leaves plain text readable', () => {
    expect(formatReason('Already filled')).toBe('Already filled')
  })
})
