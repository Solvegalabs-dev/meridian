// FF-099: what each Signals card shows.
import { describe, it, expect } from 'vitest'
import { cardModel, groupSignals, type Signal } from './signalCards'

let n = 0
const sig = (agent_key: string, observed_value: number | null, minutesAgo: number, source = 'observed'): Signal => ({
  id: `s${++n}`, agent_key, objective_id: 'o1', observed_value, source,
  recorded_at: new Date(Date.UTC(2026, 9, 8, 12) - minutesAgo * 60000).toISOString(),
})

describe('grouping', () => {
  it('hatch window, water temperature and streamflow are separate cards', () => {
    const groups = groupSignals([
      sig('OUTDOOR_HATCH_WINDOW', 0.33, 1),
      sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 2),
      sig('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 3),
      sig('OUTDOOR_NOAA_TEMP', 0, 4, 'estimated'),
    ])
    expect(groups.map(g => g.label)).toEqual(['Hatch window', 'Water temperature', 'Streamflow', 'Air temperature'])
  })
})

describe('card header', () => {
  it('the streamflow card carries the state-level label and note, with the cfs help line', () => {
    const m = cardModel(groupSignals([sig('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 1)])[0])
    expect(m.subtitle).toBe('State-level streamflow (not this water)')
    expect(m.note).toBe('A state-wide reading, not the flow at your spot.')
    expect(m.help).toBe('cfs = cubic feet per second')
    expect(m.header).toMatchObject({ kind: 'value', primary: '2,490 cfs' })
  })

  it('the header value is the latest reading of that group only', () => {
    const groups = groupSignals([
      sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 1),
      sig('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 2),
    ])
    expect(cardModel(groups[0]).header).toMatchObject({ primary: '45.5 F', secondary: '(7.5 C)' })
    expect(cardModel(groups[1]).header).toMatchObject({ primary: '2,490 cfs' })
  })

  it('an estimated reading is tagged, a hatch score is a word and a number', () => {
    expect(cardModel(groupSignals([sig('OUTDOOR_USGS_WATER_TEMP', 3.2, 1, 'estimated')])[0]).header).toMatchObject({ estimated: true })
    expect(cardModel(groupSignals([sig('OUTDOOR_HATCH_WINDOW', 0.3333, 1)])[0]).header).toMatchObject({ primary: 'Low, 0.33' })
    expect(cardModel(groupSignals([sig('OUTDOOR_HATCH_WINDOW', 0.3333, 1)])[0]).scale).toContain('Low under 0.34')
  })

  it('moon: percent, direction from the previous reading, and the picture data', () => {
    const m = cardModel(groupSignals([sig('OUTDOOR_MOON_PHASE', 9, 1), sig('OUTDOOR_MOON_PHASE', 16, 60 * 24)])[0])
    expect(m.header).toMatchObject({ kind: 'moon', moon: { percent: 9, waxing: false, headline: '9% lit, waning crescent' } })
  })
})

describe('placeholder zeros', () => {
  it('an estimated 0 is "No data", with no trend and no sparkline', () => {
    const m = cardModel(groupSignals([
      sig('OUTDOOR_NOAA_TEMP', 0, 1, 'estimated'),
      sig('OUTDOOR_NOAA_TEMP', 0, 400, 'estimated'),
      sig('OUTDOOR_NOAA_TEMP', 0, 800, 'estimated'),
    ])[0])
    expect(m.header).toEqual({ kind: 'nodata' })
    expect(m.trend).toBe('')
    expect(m.spark).toEqual([])
    expect(m.rows.every(r => r.noData && r.text === 'No data')).toBe(true)
  })

  it('placeholders are left out of the trend and the sparkline when real readings exist', () => {
    const m = cardModel(groupSignals([
      sig('OUTDOOR_USGS_WATER_TEMP', 8, 1),
      sig('OUTDOOR_USGS_WATER_TEMP', 0, 100, 'estimated'),
      sig('OUTDOOR_USGS_WATER_TEMP', 6, 200),
    ])[0])
    expect(m.spark).toEqual([6, 8])
    expect(m.trend).toBe('↑')
  })
})

describe('trend', () => {
  it('no arrow with a single reading', () => {
    expect(cardModel(groupSignals([sig('OUTDOOR_USGS_WATER_TEMP', 7, 1)])[0]).trend).toBe('')
  })

  it('only readings of the same agent make a trend', () => {
    // Two agents share the Drought group; one reading each is not a trend.
    const m = cardModel(groupSignals([sig('OUTDOOR_NOAA_DROUGHT_STATE', 2, 1), sig('OUTDOOR_NOAA_DROUGHT_COUNTY', 1, 2)])[0])
    expect(m.trend).toBe('')
    expect(m.spark).toEqual([2])
  })
})
