// FF-100 Part 4: labels, counting, chips and cards depend on where each reading came from.
import { describe, it, expect } from 'vitest'
import {
  agentChip, agentLabel, agentNote, displayValue, formatReading, isSpotLevel, NEARBY_GAUGE_MAX_MI, provenance,
  type SourceDetail,
} from './signalFormat'
import { cardModel, groupSignals, type Signal } from './signalCards'
import { buildSignalChips } from './signalChips'
import { buildEvidence } from '@/lib/strikeBrief/evidence'

const NOW = new Date('2026-10-08T15:00:00Z')
const HOUR = 3600000
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString()

const NEAR: SourceDetail = { kind: 'gauge', site_no: '10152000', site_name: 'Provo River', distance_mi: 12.3 }
const FAR: SourceDetail = { kind: 'gauge', site_no: '10999999', site_name: 'Big River', distance_mi: 48 }
const FORECAST: SourceDetail = { kind: 'forecast', provider: 'NWS' }

describe('provenance', () => {
  it('a gauge at or under the limit is nearby; farther or of unknown distance is distant', () => {
    expect(NEARBY_GAUGE_MAX_MI).toBe(15)
    expect(provenance('OUTDOOR_USGS_WATER_TEMP', { ...NEAR, distance_mi: 15 })).toBe('nearby_gauge')
    expect(provenance('OUTDOOR_USGS_WATER_TEMP', { ...NEAR, distance_mi: 15.1 })).toBe('distant_gauge')
    expect(provenance('OUTDOOR_USGS_WATER_TEMP', { ...NEAR, distance_mi: null })).toBe('distant_gauge')
  })

  it('old rows without source detail keep their old classes', () => {
    for (const key of ['OUTDOOR_USGS_WATER_TEMP', 'OUTDOOR_USGS_DISSOLVED_O2', 'OUTDOOR_USGS_TURBIDITY', 'OUTDOOR_HATCH_WINDOW']) {
      expect(provenance(key, null), key).toBe('reference')
      expect(isSpotLevel(key, null), key).toBe(false)
    }
    expect(provenance('OUTDOOR_USGS_STREAMFLOW_STATE', null)).toBe('state')
    expect(provenance('OUTDOOR_NOAA_TEMP', null)).toBe('legacy')
    expect(provenance('OUTDOOR_WINDY_API', null)).toBe('forecast')
  })

  it('forecast and station readings and the moon are the spot\'s own', () => {
    expect(isSpotLevel('OUTDOOR_NOAA_TEMP', FORECAST)).toBe(true)
    expect(isSpotLevel('OUTDOOR_NOAA_BAROMETRIC', { kind: 'station', station_id: 'KPVU' })).toBe(true)
    expect(isSpotLevel('OUTDOOR_MOON_PHASE', null)).toBe(true)
  })
})

describe('labels', () => {
  it('nearby gauge: names the gauge and the distance, no reference note', () => {
    expect(agentLabel('OUTDOOR_USGS_WATER_TEMP', NEAR)).toBe('Water temperature (USGS gauge Provo River, 12.3 mi from your spot)')
    expect(agentNote('OUTDOOR_USGS_WATER_TEMP', NEAR)).toBeNull()
    expect(agentLabel('OUTDOOR_USGS_STREAMFLOW_NEAR', NEAR)).toBe('Streamflow (USGS gauge Provo River, 12.3 mi from your spot)')
  })

  it('distant gauge: labeled, with a note that it may not match this water', () => {
    expect(agentLabel('OUTDOOR_USGS_WATER_TEMP', FAR)).toBe('Water temperature (distant gauge, 48 mi away, may not match this water)')
    expect(agentNote('OUTDOOR_USGS_WATER_TEMP', FAR)).toContain('may not match the water at your spot')
  })

  it('old rows keep the reference and state-level labels', () => {
    expect(agentLabel('OUTDOOR_USGS_WATER_TEMP', null)).toBe('Water temperature (reference gauge, not this water)')
    expect(agentLabel('OUTDOOR_HATCH_WINDOW', null)).toBe('Hatch window score (based on a reference gauge, not this water)')
    expect(agentLabel('OUTDOOR_USGS_STREAMFLOW_STATE', null)).toBe('State-level streamflow (not this water)')
    expect(agentNote('OUTDOOR_USGS_WATER_TEMP', null)).toBe('A reference gauge, not the water at your spot.')
  })

  it('the hatch score from a nearby gauge says whose water temperature it used', () => {
    expect(agentLabel('OUTDOOR_HATCH_WINDOW', { ...NEAR, derived_from: 'OUTDOOR_USGS_WATER_TEMP' }))
      .toBe('Hatch window score (from water temperature at USGS gauge Provo River, 12.3 mi from your spot)')
  })

  it('brief lines: nearby gauge, forecast and station wording', () => {
    expect(formatReading('OUTDOOR_USGS_WATER_TEMP', 7.5, { source: 'observed', detail: NEAR }))
      .toBe('Water temperature (USGS gauge Provo River, 12.3 mi from your spot): 45.5 F (7.5 C), USGS observed')
    expect(formatReading('OUTDOOR_NOAA_TEMP', 48, { source: 'observed', detail: FORECAST }))
      .toBe('Air temperature: 48 F, NWS forecast for this hour (not a measurement)')
    expect(formatReading('OUTDOOR_WINDY_API', 8, { source: 'observed', detail: { ...FORECAST, gust_mph: 20 } }))
      .toBe('Wind: 8 mph (gusts 20 mph), NWS forecast for this hour (not a measurement)')
    expect(formatReading('OUTDOOR_NOAA_BAROMETRIC', 29.92, { source: 'observed', detail: { kind: 'station', station_id: 'KPVU', change_inhg: -0.06, change_hours: 3 } }))
      .toBe('Barometric pressure: 29.92 inHg (-0.06 inHg over 3 h), NWS station KPVU observation')
  })

  it('an old weather row with an unknown unit is not handed over', () => {
    expect(formatReading('OUTDOOR_NOAA_TEMP', 3.2, { source: 'observed' })).toBeNull()
    expect(displayValue('OUTDOOR_NOAA_TEMP', 3.2)).toMatchObject({ primary: '3.2 change index', unitless: true })
    expect(displayValue('OUTDOOR_NOAA_TEMP', 48, FORECAST)).toMatchObject({ primary: '48 F', unitless: false })
    expect(displayValue('OUTDOOR_NOAA_PRECIP', 20, FORECAST).primary).toBe('20%')
  })
})

describe('chips', () => {
  it('Water and Flow only for nearby gauges', () => {
    expect(agentChip('OUTDOOR_USGS_WATER_TEMP', NEAR)?.label).toBe('Water')
    expect(agentChip('OUTDOOR_USGS_STREAMFLOW_NEAR', NEAR)?.label).toBe('Flow')
    expect(agentChip('OUTDOOR_USGS_WATER_TEMP', FAR)).toBeNull()
    expect(agentChip('OUTDOOR_USGS_WATER_TEMP', null)).toBeNull()
    expect(agentChip('OUTDOOR_USGS_STREAMFLOW_NEAR', FAR)).toBeNull()
  })

  it('built chips: Water 45 F, Flow 120 cfs, and State flow only when a state-level reading exists', () => {
    const chips = buildSignalChips([
      { agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 7.5, source: 'observed', recorded_at: at(1), source_detail: NEAR },
      { agent_key: 'OUTDOOR_USGS_STREAMFLOW_NEAR', observed_value: 120, source: 'observed', recorded_at: at(2), source_detail: NEAR },
    ], NOW)
    expect(chips.map(c => `${c.label} ${c.value}`)).toEqual(['Water 46 F', 'Flow 120 cfs'])
    expect(chips.map(c => c.label)).not.toContain('State flow')

    const withState = buildSignalChips([
      { agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE', observed_value: 2490, source: 'observed', recorded_at: at(1), source_detail: null },
    ], NOW)
    expect(withState.map(c => `${c.label} ${c.value}`)).toEqual(['State flow 2,490 cfs'])
  })

  it('a distant gauge, an old reference reading and a forecast give no chip', () => {
    const chips = buildSignalChips([
      { agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 7.5, source: 'observed', recorded_at: at(1), source_detail: FAR },
      { agent_key: 'OUTDOOR_USGS_STREAMFLOW_NEAR', observed_value: 120, source: 'observed', recorded_at: at(1), source_detail: FAR },
      { agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 7.5, source: 'observed', recorded_at: at(3), source_detail: null },
      { agent_key: 'OUTDOOR_NOAA_TEMP', observed_value: 48, source: 'observed', recorded_at: at(1), source_detail: FORECAST },
    ], NOW)
    expect(chips).toEqual([])
  })

  it('the newest water reading decides: a distant gauge now hides the chip even if an older one was nearby', () => {
    const chips = buildSignalChips([
      { agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 7.5, source: 'observed', recorded_at: at(1), source_detail: FAR },
      { agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 9, source: 'observed', recorded_at: at(30), source_detail: NEAR },
    ], NOW)
    expect(chips).toEqual([])
  })
})

describe('evidence counts and the missing-data clause', () => {
  const reading = (agent_key: string, observed_value: number, source_detail: SourceDetail, hoursAgo = 1) =>
    ({ agent_key, observed_value, source: 'observed', recorded_at: at(hoursAgo), source_detail })

  it('a nearby-gauge reading counts and satisfies the water temperature clause', () => {
    const e = buildEvidence({ readings: [reading('OUTDOOR_USGS_WATER_TEMP', 7.5, NEAR)], signals: [], domain: 'fishing', now: NOW })
    expect(e.count).toBe(1)
    expect(e.missing).toEqual(['streamflow reading for this water'])
    expect(e.lines[0]).toContain('Water temperature (USGS gauge Provo River, 12.3 mi from your spot): 45.5 F (7.5 C), USGS observed')
  })

  it('nearby water temperature and flow leave nothing missing', () => {
    const e = buildEvidence({
      readings: [reading('OUTDOOR_USGS_WATER_TEMP', 7.5, NEAR), reading('OUTDOOR_USGS_STREAMFLOW_NEAR', 120, NEAR)],
      signals: [], domain: 'fishing', now: NOW,
    })
    expect(e.missing).toEqual([])
    expect(e.count).toBe(2)
  })

  it('a distant gauge is listed with its label but is not counted and does not satisfy the clause', () => {
    const e = buildEvidence({ readings: [reading('OUTDOOR_USGS_WATER_TEMP', 7.5, FAR)], signals: [], domain: 'fishing', now: NOW })
    expect(e.count).toBe(0)
    expect(e.missing).toContain('water temperature reading for this water')
    expect(e.lines.join(' ')).toContain('Water temperature (distant gauge, 48 mi away, may not match this water)')
  })

  it('old Kenai and state-level rows stay uncounted', () => {
    const e = buildEvidence({
      readings: [reading('OUTDOOR_USGS_WATER_TEMP', 7.5, null), reading('OUTDOOR_HATCH_WINDOW', 0.33, null), reading('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, null)],
      signals: [], domain: 'fishing', now: NOW,
    })
    expect(e.count).toBe(0)
    expect(e.missing).toEqual(['water temperature reading for this water', 'streamflow reading for this water'])
  })

  it('a forecast counts as evidence but is worded as a forecast', () => {
    const e = buildEvidence({ readings: [reading('OUTDOOR_NOAA_TEMP', 48, FORECAST)], signals: [], domain: 'fishing', now: NOW })
    expect(e.count).toBe(1)
    expect(e.lines[0]).toContain('Air temperature: 48 F, NWS forecast for this hour (not a measurement)')
  })
})

describe('Signals cards', () => {
  const sig = (agent_key: string, value: number | null, hoursAgo: number, detail: SourceDetail, source = 'observed', id = `${agent_key}-${hoursAgo}`): Signal => ({
    id, agent_key, objective_id: 'o1', observed_value: value, source, recorded_at: at(hoursAgo), source_detail: detail,
  })

  it('under the heading: the gauge name and distance for a nearby reading', () => {
    const m = cardModel(groupSignals([sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 1, NEAR)])[0])
    expect(m.label).toBe('Water temperature')
    expect(m.subtitle).toBe('Water temperature (USGS gauge Provo River, 12.3 mi from your spot)')
    expect(m.note).toBeNull()
    expect(m.header).toMatchObject({ primary: '45.5 F', secondary: '(7.5 C)' })
  })

  it('a distant gauge shows its warning; an old reading shows the reference note', () => {
    expect(cardModel(groupSignals([sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 1, FAR)])[0]).note).toContain('may not match')
    expect(cardModel(groupSignals([sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 1, null)])[0]).note).toBe('A reference gauge, not the water at your spot.')
  })

  it('flow from the nearby gauge has the cfs help line; air temperature is a forecast', () => {
    expect(cardModel(groupSignals([sig('OUTDOOR_USGS_STREAMFLOW_NEAR', 120, 1, NEAR)])[0])).toMatchObject({ help: 'cfs = cubic feet per second', header: { primary: '120 cfs' } })
    const air = cardModel(groupSignals([sig('OUTDOOR_NOAA_TEMP', 48, 1, FORECAST)])[0])
    expect(air.header).toMatchObject({ primary: '48 F' })
    expect(air.note).toBe('A forecast for this hour, not a measurement.')
  })

  it('the trend and sparkline never join an old Kenai reading to a new nearby reading', () => {
    const m = cardModel(groupSignals([
      sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 1, NEAR),
      sig('OUTDOOR_USGS_WATER_TEMP', 3.0, 30, null),
      sig('OUTDOOR_USGS_WATER_TEMP', 3.5, 60, null),
    ])[0])
    expect(m.spark).toEqual([7.5])
    expect(m.trend).toBe('')
  })

  it('state-level flow and nearby flow are separate cards', () => {
    const groups = groupSignals([sig('OUTDOOR_USGS_STREAMFLOW_NEAR', 120, 1, NEAR), sig('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 2, null)])
    expect(groups.map(g => g.label)).toEqual(['Streamflow', 'State streamflow'])
  })

  it('an old weather row shows as a change index, never as degrees', () => {
    const m = cardModel(groupSignals([sig('OUTDOOR_NOAA_TEMP', 3.2, 1, null)])[0])
    expect(m.header).toMatchObject({ primary: '3.2 change index' })
  })
})
