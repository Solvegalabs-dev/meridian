import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeCall } from '@/lib/testing/fakeSupabase'
import {
  EVIDENCE_WINDOW_DAYS,
  ZERO_EVIDENCE_BANNER,
  buildEvidence,
  describeMoon,
  formatReading,
  isUsableReading,
  loadEvidence,
  type Reading,
} from './evidence'

const NOW = new Date('2026-10-08T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()

// The default reading is spot-level (the moon). State-level and reference-gauge readings are labeled lines but are
// not evidence for the spot (FF-099), so they are named explicitly where a test wants one.
const reading = (over: Partial<Reading> = {}): Reading => ({
  agent_key: 'OUTDOOR_MOON_PHASE', observed_value: 9, source: 'observed', recorded_at: daysAgo(1), ...over,
})
const flow = (over: Partial<Reading> = {}) => reading({ agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE', observed_value: 2490, ...over })
const waterTemp = (over: Partial<Reading> = {}) => reading({ agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 7.5, ...over })

describe('evidence window', () => {
  it('is 14 days', () => {
    expect(EVIDENCE_WINDOW_DAYS).toBe(14)
  })

  it('a reading 13 days old counts, one 15 days old does not', () => {
    expect(buildEvidence({ readings: [reading({ recorded_at: daysAgo(13) })], signals: [], now: NOW }).count).toBe(1)
    expect(buildEvidence({ readings: [reading({ recorded_at: daysAgo(15) })], signals: [], now: NOW }).count).toBe(0)
  })

  it('a tagged signal 13 days old counts, one 15 days old does not', () => {
    expect(buildEvidence({ readings: [], signals: [{ created_at: daysAgo(13) }], now: NOW }).count).toBe(1)
    expect(buildEvidence({ readings: [], signals: [{ created_at: daysAgo(15) }], now: NOW }).count).toBe(0)
  })

  it('counts readings and signals together', () => {
    const e = buildEvidence({
      readings: [reading(), reading({ agent_key: 'OUTDOOR_WINDY_API', observed_value: 8 })],
      signals: [{ created_at: daysAgo(2) }],
      now: NOW,
    })
    expect(e.count).toBe(3)
  })

  it('nothing at all is zero', () => {
    expect(buildEvidence({ readings: [], signals: [], now: NOW }).count).toBe(0)
  })
})

describe('estimated zero readings are not evidence', () => {
  it('an estimated 0 is unusable and is not counted or listed', () => {
    const placeholder = reading({ agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 0, source: 'estimated' })
    expect(isUsableReading(placeholder)).toBe(false)
    const e = buildEvidence({ readings: [placeholder], signals: [], domain: 'fishing', now: NOW })
    expect(e.count).toBe(0)
    expect(e.lines).toEqual([])
    expect(e.missing).toContain('water temperature reading for this water')
  })

  it('an observed 0 is a real measurement, and a nonzero estimate is kept but labeled as a projection', () => {
    expect(isUsableReading(reading({ observed_value: 0, source: 'observed' }))).toBe(true)
    const e = buildEvidence({ readings: [reading({ observed_value: 5, source: 'estimated', agent_key: 'OUTDOOR_WINDY_API' })], signals: [], now: NOW })
    expect(e.count).toBe(1)
    expect(e.lines[0]).toContain('estimated (a projection, not a measurement)')
  })

  it('missing, empty and non-numeric values are unusable', () => {
    for (const bad of [null, '', 'n/a', NaN]) expect(isUsableReading(reading({ observed_value: bad as never }))).toBe(false)
  })
})

describe('labeled values with units', () => {
  it('water temperature gives Fahrenheit and Celsius (USGS reports Celsius)', () => {
    expect(formatReading('OUTDOOR_USGS_WATER_TEMP', 7.5, { source: 'observed' })).toBe('Water temperature (reference gauge, not this water): 45.5 F (7.5 C), USGS observed')
  })

  it('streamflow is in cfs with a thousands separator', () => {
    expect(formatReading('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, { source: 'observed' })).toBe('State-level streamflow (not this water): 2,490 cfs, USGS observed')
  })

  it('other known readings carry their units', () => {
    expect(formatReading('OUTDOOR_USGS_DISSOLVED_O2', 8.25, { source: 'observed' })).toContain('8.3 mg/L')
    expect(formatReading('OUTDOOR_SALMON_PROGRESSION', 42, { source: 'observed' })).toContain('42% of the annual run')
    expect(formatReading('OUTDOOR_USACE_BONNEVILLE', 1200, { source: 'observed' })).toContain('1,200 fish per day')
  })

  it('the moon is percent illuminated with a direction and days to the next phase, not a bare number', () => {
    // 27.5 days after a new moon: a thin waning crescent, new moon in about 2 days.
    const waning = new Date(Date.UTC(2000, 0, 6, 18, 14) + 27.5 * DAY)
    expect(describeMoon(9, waning)).toBe('9% illuminated, waning (new moon in about 2 days)')
    // 3 days after a new moon: waxing, full moon in about 12 days.
    const waxing = new Date(Date.UTC(2000, 0, 6, 18, 14) + 3 * DAY)
    expect(describeMoon(8.2, waxing)).toBe('8% illuminated, waxing (full moon in about 12 days)')
    expect(formatReading('OUTDOOR_MOON_PHASE', 9, { source: 'observed', recordedAt: waning })).toBe(
      'Moon: 9% illuminated, waning (new moon in about 2 days), observed',
    )
  })

  it('an agent whose unit is not known gets no number at all', () => {
    expect(formatReading('OUTDOOR_NOAA_BAROMETRIC', 1013, { source: 'observed' })).toBeNull()
    expect(formatReading('OUTDOOR_USGS_WATER_TEMP', NaN)).toBeNull()
  })

  it('the evidence block never contains a bare number for an unknown-unit agent', () => {
    const e = buildEvidence({ readings: [reading({ agent_key: 'OUTDOOR_NOAA_BAROMETRIC', observed_value: 1013 })], signals: [], now: NOW })
    expect(e.count).toBe(1) // it is evidence that something was recorded
    const text = e.lines.join('\n')
    expect(text).not.toContain('1013')
    expect(text).toContain('value not shown because its unit is not available')
    expect(text.toLowerCase()).toContain('barometric pressure')
  })

  it('every listed reading line has a unit and an age', () => {
    const e = buildEvidence({
      readings: [
        flow(),
        waterTemp({ recorded_at: daysAgo(0) }),
        reading({ agent_key: 'OUTDOOR_MOON_PHASE', observed_value: 9, recorded_at: daysAgo(3) }),
      ],
      signals: [],
      now: NOW,
    })
    expect(e.lines).toHaveLength(3)
    expect(e.lines.join('\n')).toMatch(/cfs, USGS observed, recorded 1 day ago/)
    expect(e.lines.join('\n')).toMatch(/45\.5 F \(7\.5 C\), USGS observed, recorded today/)
    expect(e.lines.join('\n')).toMatch(/illuminated, wax|illuminated, wan/)
  })

  it('uses the newest reading per agent', () => {
    const e = buildEvidence({
      readings: [flow({ observed_value: 100, recorded_at: daysAgo(5) }), flow({ observed_value: 2490, recorded_at: daysAgo(1) })],
      signals: [],
      now: NOW,
    })
    expect(e.lines).toHaveLength(1)
    expect(e.lines[0]).toContain('2,490 cfs')
    expect(e.count).toBe(0) // a state-level reading is listed but is not evidence for the spot
  })
})

describe('missing data', () => {
  it('names the fishing categories that have no reading for this water', () => {
    const e = buildEvidence({ readings: [flow(), waterTemp()], signals: [], domain: 'fishing', now: NOW })
    // The state-level flow and the reference-gauge temperature are present, but neither is a reading for this water.
    expect(e.missing).toEqual(['water temperature reading for this water', 'streamflow reading for this water'])
  })

  it('a state-level streamflow reading never clears the streamflow clause', () => {
    const e = buildEvidence({
      readings: [waterTemp(), flow()],
      signals: [],
      domain: 'fishing',
      now: NOW,
    })
    expect(e.missing).toContain('streamflow reading for this water')
    expect(e.count).toBe(0)
  })

  it('a spot-level streamflow agent, once one exists in the list, would clear it', () => {
    // Today no agent is listed for spot-level streamflow, so the clause always shows for fishing.
    const e = buildEvidence({ readings: [], signals: [], domain: 'fishing', now: NOW })
    expect(e.missing).toContain('streamflow reading for this water')
  })

  it('names nothing for a domain with no expected categories', () => {
    expect(buildEvidence({ readings: [], signals: [], domain: 'elk_hunt', now: NOW }).missing).toEqual([])
  })
})

describe('reference-gauge and state-level readings (FF-099)', () => {
  it('are labeled in the lines the model sees', () => {
    const e = buildEvidence({ readings: [waterTemp(), flow()], signals: [], domain: 'fishing', now: NOW })
    expect(e.lines.join(' ')).toContain('Water temperature (reference gauge, not this water): 45.5 F (7.5 C), USGS observed')
    expect(e.lines.join(' ')).toContain('State-level streamflow (not this water): 2,490 cfs, USGS observed')
  })

  it('are not counted: only those readings means zero evidence', () => {
    const e = buildEvidence({
      readings: [waterTemp(), flow(), reading({ agent_key: 'OUTDOOR_HATCH_WINDOW', observed_value: 0.5 }), reading({ agent_key: 'OUTDOOR_USGS_DISSOLVED_O2', observed_value: 9 }), reading({ agent_key: 'OUTDOOR_USGS_TURBIDITY', observed_value: 3 })],
      signals: [],
      domain: 'fishing',
      now: NOW,
    })
    expect(e.count).toBe(0)
  })

  it('a spot-level reading or a tagged signal still counts beside them', () => {
    expect(buildEvidence({ readings: [waterTemp(), reading()], signals: [], now: NOW }).count).toBe(1)
    expect(buildEvidence({ readings: [waterTemp()], signals: [{ created_at: daysAgo(1) }], now: NOW }).count).toBe(1)
  })

  it('a water temperature reading from the reference gauge does not clear the missing-data clause', () => {
    const e = buildEvidence({ readings: [waterTemp(), reading()], signals: [], domain: 'fishing', now: NOW })
    expect(e.missing).toContain('water temperature reading for this water')
  })
})

describe('loadEvidence: scoped to this objective', () => {
  // A responder that honours the filters the loader sets, like a database would.
  function db(rows: { readings: Array<Reading & { objective_id: string }>; signals: Array<{ id: string; user_id: string; objective_ids: string[]; created_at: string }> }) {
    return fakeSupabase((call: FakeCall) => {
      const eq = (col: string) => call.filters.find(f => f[0] === col && f[1] === 'eq')?.[2]
      if (call.table === 'agent_signal_history') {
        return { data: rows.readings.filter(r => r.objective_id === eq('objective_id')) }
      }
      if (call.table === 'signals') {
        const contained = call.filters.find(f => f[1] === 'contains')?.[2] as string[] | undefined
        return { data: rows.signals.filter(s => s.user_id === eq('user_id') && (contained ?? []).every(id => s.objective_ids.includes(id))) }
      }
      return { data: [] }
    })
  }

  const asDb = (d: ReturnType<typeof db>) => d as never

  it('another objective\'s readings and signals do not count', async () => {
    const d = db({
      readings: [
        { ...reading(), objective_id: 'other-obj' },
        { ...reading({ agent_key: 'OUTDOOR_MOON_PHASE', observed_value: 9 }), objective_id: 'other-obj' },
      ],
      signals: [{ id: 's1', user_id: 'u1', objective_ids: ['other-obj'], created_at: daysAgo(1) }],
    })
    const e = await loadEvidence(asDb(d), { objectiveId: 'this-obj', userId: 'u1', now: NOW })
    expect(e.count).toBe(0)
  })

  it('this objective\'s own readings and signals count, and another user\'s signals do not', async () => {
    const d = db({
      readings: [{ ...reading(), objective_id: 'this-obj' }],
      signals: [
        { id: 's1', user_id: 'u1', objective_ids: ['this-obj', 'x'], created_at: daysAgo(1) },
        { id: 's2', user_id: 'someone-else', objective_ids: ['this-obj'], created_at: daysAgo(1) },
      ],
    })
    const e = await loadEvidence(asDb(d), { objectiveId: 'this-obj', userId: 'u1', now: NOW })
    expect(e.count).toBe(2)
  })

  it('asks for the window and drops rows outside it even if the database returned them', async () => {
    const d = db({
      readings: [
        { ...reading({ recorded_at: daysAgo(13) }), objective_id: 'this-obj' },
        { ...reading({ agent_key: 'OUTDOOR_MOON_PHASE', recorded_at: daysAgo(15) }), objective_id: 'this-obj' },
      ],
      signals: [],
    })
    const e = await loadEvidence(asDb(d), { objectiveId: 'this-obj', userId: 'u1', now: NOW })
    expect(e.count).toBe(1)
    const since = new Date(NOW.getTime() - 14 * DAY).toISOString()
    for (const call of d.calls) expect(call.filters).toContainEqual([call.table === 'signals' ? 'created_at' : 'recorded_at', 'gte', since])
  })

  it('a failed read counts as no evidence for that source, not a crash', async () => {
    const d = fakeSupabase(() => ({ error: { message: 'boom' } }))
    const e = await loadEvidence(asDb(d as never), { objectiveId: 'this-obj', userId: 'u1', now: NOW })
    expect(e.count).toBe(0)
  })
})

describe('banner', () => {
  it('is the fixed text', () => {
    expect(ZERO_EVIDENCE_BANNER).toBe('No data collected yet. This is typical for the season, not confirmed. Tap Run Sweep to get intel.')
  })
})
