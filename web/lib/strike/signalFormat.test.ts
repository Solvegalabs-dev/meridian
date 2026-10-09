// FF-099: the shared table for group names, units, the moon and placeholder readings.
import { describe, it, expect } from 'vitest'
import {
  AGENTS, agentChip, agentGroup, agentLabel, agentNote, displayValue, isSpotLevel, formatReading, hatchBand, isPlaceholderReading, moonDisplay, moonInfo,
  moonNightNote, moonPhaseName, trendArrow,
} from './signalFormat'

const noon = (month: number, day: number) => new Date(Date.UTC(2026, month - 1, day, 12))

describe('groups are keyed on the full agent key', () => {
  it('the hatch score is not Wind, and water temperature is not streamflow', () => {
    expect(agentGroup('OUTDOOR_HATCH_WINDOW').label).toBe('Hatch window')
    expect(agentGroup('OUTDOOR_USGS_WATER_TEMP').label).toBe('Water temperature')
    expect(agentGroup('OUTDOOR_USGS_STREAMFLOW_STATE').label).toBe('Streamflow')
    expect(agentGroup('OUTDOOR_NOAA_TEMP').label).toBe('Air temperature')
    expect(agentGroup('OUTDOOR_WINDY_API').label).toBe('Wind')
    expect(agentGroup('OUTDOOR_MOON_PHASE').label).toBe('Moon Phase')
  })

  it('no key lands in a group whose name is about something else', () => {
    // The old includes() matching put HATCH_WINDOW under Wind and every USGS agent under Streamflow.
    for (const key of Object.keys(AGENTS)) {
      const label = agentGroup(key).label
      if (label === 'Wind') expect(key).toBe('OUTDOOR_WINDY_API')
      if (label === 'Streamflow') expect(key).toBe('OUTDOOR_USGS_STREAMFLOW_STATE')
      if (label === 'Water temperature') expect(key).toBe('OUTDOOR_USGS_WATER_TEMP')
      if (label === 'Air temperature') expect(key).toBe('OUTDOOR_NOAA_TEMP')
    }
    expect(agentGroup('OUTDOOR_USGS_DISSOLVED_O2').label).not.toBe('Streamflow')
    expect(agentGroup('OUTDOOR_USGS_TURBIDITY').label).not.toBe('Streamflow')
  })

  it('an unlisted key falls back to its cleaned name, never to a guessed group', () => {
    expect(agentGroup('OUTDOOR_WINDOW_SOMETHING').label).toBe('Window something')
    expect(agentGroup('OUTDOOR_SOMETHING_NEW').label).toBe('Something new')
  })
})

describe('reference-gauge labels (until the agents use the own gauge of the pin)', () => {
  const REFERENCE_NOTE = 'A reference gauge, not the water at your spot.'

  it('water temperature, dissolved oxygen, turbidity and the hatch score say they are not this water', () => {
    expect(agentLabel('OUTDOOR_USGS_WATER_TEMP')).toBe('Water temperature (reference gauge, not this water)')
    expect(agentLabel('OUTDOOR_USGS_DISSOLVED_O2')).toBe('Dissolved oxygen (reference gauge, not this water)')
    expect(agentLabel('OUTDOOR_USGS_TURBIDITY')).toBe('Turbidity (reference gauge, not this water)')
    expect(agentLabel('OUTDOOR_HATCH_WINDOW')).toBe('Hatch window score (based on a reference gauge, not this water)')
  })

  it('each has the card note, and the state-level flow keeps its own', () => {
    for (const key of ['OUTDOOR_USGS_WATER_TEMP', 'OUTDOOR_USGS_DISSOLVED_O2', 'OUTDOOR_USGS_TURBIDITY', 'OUTDOOR_HATCH_WINDOW']) {
      expect(agentNote(key), key).toBe(REFERENCE_NOTE)
      expect(isSpotLevel(key), key).toBe(false)
      expect(agentChip(key), key).toBeNull()
    }
    expect(agentNote('OUTDOOR_USGS_STREAMFLOW_STATE')).toBe('A state-wide reading, not the flow at your spot.')
    expect(isSpotLevel('OUTDOOR_USGS_STREAMFLOW_STATE')).toBe(false)
  })

  it('the moon and wind belong to the spot', () => {
    expect(isSpotLevel('OUTDOOR_MOON_PHASE')).toBe(true)
    expect(isSpotLevel('OUTDOOR_WINDY_API')).toBe(true)
  })

  it('turbidity is in FNU', () => {
    expect(displayValue('OUTDOOR_USGS_TURBIDITY', 3.25).primary).toBe('3.3 FNU')
  })
})

describe('units', () => {
  it('water temperature: Celsius stored, Fahrenheit first, exactly converted', () => {
    expect(displayValue('OUTDOOR_USGS_WATER_TEMP', 7.5)).toMatchObject({ primary: '45.5 F', secondary: '(7.5 C)' })
    expect(displayValue('OUTDOOR_USGS_WATER_TEMP', 0).primary).toBe('32 F')
    expect(displayValue('OUTDOOR_USGS_WATER_TEMP', 20).primary).toBe('68 F')
  })

  it('streamflow is cfs with a thousands separator', () => {
    expect(displayValue('OUTDOOR_USGS_STREAMFLOW_STATE', 2490).primary).toBe('2,490 cfs')
    expect(displayValue('OUTDOOR_USGS_STREAMFLOW_STATE', 1234567).primary).toBe('1,234,567 cfs')
  })

  it('wind is mph', () => {
    expect(displayValue('OUTDOOR_WINDY_API', 8).primary).toBe('8 mph')
  })

  it('hatch score is a word with the number, using the stated thresholds', () => {
    expect(displayValue('OUTDOOR_HATCH_WINDOW', 0.3333).primary).toBe('Low, 0.33')
    expect(displayValue('OUTDOOR_HATCH_WINDOW', 0.5).primary).toBe('Moderate, 0.50')
    expect(displayValue('OUTDOOR_HATCH_WINDOW', 0.8).primary).toBe('High, 0.80')
    expect([hatchBand(0.33), hatchBand(0.34), hatchBand(0.66), hatchBand(0.67)]).toEqual(['Low', 'Moderate', 'Moderate', 'High'])
  })

  it('an index is named as an index, and an unlisted agent says its unit is not stated', () => {
    expect(displayValue('OUTDOOR_NOAA_DROUGHT_STATE', 2)).toMatchObject({ primary: '2 drought index', unitless: true })
    expect(displayValue('OUTDOOR_NOAA_TEMP', -1.5)).toMatchObject({ primary: '-1.5 change index', unitless: true })
    expect(displayValue('OUTDOOR_SOMETHING_NEW', 3).primary).toBe('3 (unit not stated)')
  })

  it('the brief prompt uses the same table (one source of truth)', () => {
    expect(formatReading('OUTDOOR_USGS_WATER_TEMP', 7.5, { source: 'observed' })).toBe('Water temperature (reference gauge, not this water): 45.5 F (7.5 C), USGS observed')
  })
})

describe('placeholder readings', () => {
  it('an estimated 0 is a failed lookup; an observed 0 is a measurement', () => {
    expect(isPlaceholderReading({ observed_value: 0, source: 'estimated' })).toBe(true)
    expect(isPlaceholderReading({ observed_value: 0, source: 'observed' })).toBe(false)
    expect(isPlaceholderReading({ observed_value: 3.2, source: 'estimated' })).toBe(false)
    expect(isPlaceholderReading({ observed_value: null, source: 'observed' })).toBe(true)
  })
})

describe('moon', () => {
  it('Oct 6, 7, 8, 10 2026: about 25, 16, 9 and under 3 percent, all waning', () => {
    const expected: Array<[number, number]> = [[6, 25], [7, 16], [8, 9], [10, 1]]
    for (const [day, pct] of expected) {
      const m = moonInfo(noon(10, day))
      expect(m.illumination).toBeGreaterThan(pct - 2)
      expect(m.illumination).toBeLessThan(pct + 2)
      expect(m.waxing).toBe(false)
    }
  })

  it('names the phase from illumination and direction', () => {
    expect(moonPhaseName(1, false)).toBe('new moon')
    expect(moonPhaseName(9, false)).toBe('waning crescent')
    expect(moonPhaseName(9, true)).toBe('waxing crescent')
    expect(moonPhaseName(50, true)).toBe('first quarter')
    expect(moonPhaseName(50, false)).toBe('last quarter')
    expect(moonPhaseName(75, true)).toBe('waxing gibbous')
    expect(moonPhaseName(75, false)).toBe('waning gibbous')
    expect(moonPhaseName(99, true)).toBe('full moon')
  })

  it('direction: a falling reading is waning, a rising one waxing, and one reading uses the date', () => {
    expect(moonDisplay(16, noon(10, 7), 25).waxing).toBe(false)
    expect(moonDisplay(25, noon(10, 20), 16).waxing).toBe(true)
    expect(moonDisplay(16, noon(10, 7), null).waxing).toBe(false)
  })

  it('card text: "9% lit, waning crescent" and days to the new moon', () => {
    const m = moonDisplay(9, noon(10, 8), null)
    expect(m.headline).toBe('9% lit, waning crescent')
    expect(m.detail).toBe('New moon in about 3 days')
    expect(m.note).toBe('Darker nights')
  })

  it('only the two certain night notes', () => {
    expect(moonNightNote(5)).toBe('Darker nights')
    expect(moonNightNote(95)).toBe('Bright nights')
    expect(moonNightNote(50)).toBeNull()
  })
})

describe('trend arrow', () => {
  it('needs two readings', () => {
    expect(trendArrow([])).toBe('')
    expect(trendArrow([5])).toBe('')
    expect(trendArrow([6, 5])).toBe('↑')
    expect(trendArrow([4, 5])).toBe('↓')
    expect(trendArrow([5, 5])).toBe('→')
  })
})
