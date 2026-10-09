// FF-100: the runner records the nearest gauge's reading with its source, projects nothing when there is no reading,
// and skips a gauge agent when the spot has no gauge.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeSupabase } from '@/lib/testing/fakeSupabase'

const h = vi.hoisted(() => ({
  db: null as unknown,
  record: vi.fn(async () => undefined),
  estimate: vi.fn(async () => null),
}))

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.db }))
vi.mock('./agentHealth', () => ({ updateAgentHealth: vi.fn(async () => undefined) }))
vi.mock('./agentSignalHistory', () => ({ recordAndCheckSignal: h.record, recordEstimatedSignal: h.estimate }))
vi.mock('@/lib/spots/activeSpot', () => ({ loadActiveSpotId: vi.fn(async () => null) }))

import { runAgent } from './agentRunner'

const PROFILE = {
  lat: 40.0, lon: -111.0, nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, state: 'UT',
  hunt_unit_id: null, snotel_station_ids: null, usgs_gauge_ids: ['10152000', '10150500'],
}

function agentRow(over: Record<string, unknown> = {}) {
  return {
    agent_key: 'OUTDOOR_USGS_WATER_TEMP', vertical: 'outdoor', domain: 'elk_hunt', display_name: 'USGS Water Temperature',
    source_url_template: 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={usgs_gauge_ids}&parameterCd=00010&siteStatus=active',
    threshold_type: 'value_below', threshold_value: 18.3, threshold_keywords: null, cadence_minutes: 1440,
    event_category: 'climate_regulatory', event_source_prefix: 'ELK_HUNT:', is_active: true, ...over,
  }
}

function setup(opts: { agent?: Record<string, unknown>; profile?: Record<string, unknown> | null } = {}): FakeSupabase {
  const db = fakeSupabase(call => {
    switch (call.table) {
      case 'agent_configs': return { data: opts.agent ?? agentRow() }
      case 'objective_profiles': return { data: opts.profile === undefined ? PROFILE : opts.profile }
      case 'enterprise_macro_events': return { data: { id: 'ev1' } }
      default: return { data: null }
    }
  })
  h.db = db
  return db
}

const usgsBody = (...sites: Array<[string, number, number, string]>) => ({
  value: { timeSeries: sites.map(([siteNo, lat, lon, value]) => ({
    sourceInfo: { siteName: `Gauge ${siteNo}`, siteCode: [{ value: siteNo }], geoLocation: { geogLocation: { latitude: lat, longitude: lon } } },
    variable: { noDataValue: -999999 },
    values: [{ value: [{ value, dateTime: '2026-10-08T12:00:00.000-06:00' }] }],
  })) },
})

function respondWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: init.ok ?? true, status: init.status ?? 200,
    headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const runs = (db: FakeSupabase) => db.calls.filter(c => c.table === 'agent_run_log' && c.op === 'insert').map(c => c.payload as Record<string, unknown>)
const ctx = { state: 'UT', domain: 'fishing', objectiveId: 'obj-1' }

beforeEach(() => {
  h.record.mockClear()
  h.estimate.mockClear()
})

describe('water temperature from the pin gauges', () => {
  it('asks USGS for all the pin gauges, nearest first', async () => {
    setup()
    const fetchMock = respondWith(usgsBody(['10150500', 40, -111.1, '7.5']))
    await runAgent('OUTDOOR_USGS_WATER_TEMP', ctx)
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0]
    expect(url).toContain('sites=10152000,10150500')
    expect(url).not.toContain('15266300')
  })

  it('records the nearest gauge that has a value, with its name and distance', async () => {
    setup()
    respondWith(usgsBody(['10150500', 40, -111.1, '7.5']))
    const r = await runAgent('OUTDOOR_USGS_WATER_TEMP', ctx)
    expect(r.thresholdValueObserved).toBe(7.5)
    expect(h.record).toHaveBeenCalledTimes(1)
    const args = h.record.mock.calls[0] as unknown as [unknown, string, string, number, Record<string, unknown>]
    expect(args.slice(1, 4)).toEqual(['OUTDOOR_USGS_WATER_TEMP', 'obj-1', 7.5])
    expect(args[4]).toMatchObject({ kind: 'gauge', site_no: '10150500', site_name: 'Gauge 10150500' })
    expect(typeof args[4].distance_mi).toBe('number')
  })

  it('no gauge returns a value: a miss with no value, and nothing is projected', async () => {
    const db = setup()
    respondWith(usgsBody(['99999999', 40, -111, '5']))
    const r = await runAgent('OUTDOOR_USGS_WATER_TEMP', ctx)
    expect(r.result).toBe('miss')
    expect(r.thresholdValueObserved).toBeUndefined()
    expect(runs(db)[0]).toMatchObject({ result: 'miss', threshold_value_observed: null })
    expect(h.estimate).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
  })

  it('only no-data values: a miss, nothing projected', async () => {
    setup()
    respondWith(usgsBody(['10152000', 40, -111, '-999999']))
    const r = await runAgent('OUTDOOR_USGS_WATER_TEMP', ctx)
    expect(r.result).toBe('miss')
    expect(h.estimate).not.toHaveBeenCalled()
  })

  it('a failed request is an error and still projects nothing for a spot agent', async () => {
    const db = setup()
    respondWith({}, { ok: false, status: 503 })
    const r = await runAgent('OUTDOOR_USGS_WATER_TEMP', ctx)
    expect(r.result).toBe('error')
    expect(runs(db)[0]).toMatchObject({ result: 'error' })
    expect(h.estimate).not.toHaveBeenCalled()
  })

  it('a spot with no gauge skips with its own reason, without calling USGS', async () => {
    const db = setup({ profile: { ...PROFILE, usgs_gauge_ids: [] } })
    const fetchMock = respondWith({})
    const r = await runAgent('OUTDOOR_USGS_WATER_TEMP', ctx)
    expect(r.result).toBe('skip')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runs(db)[0]).toMatchObject({ result: 'skip', error_message: 'no_usgs_gauge_for_spot' })
    expect(h.estimate).not.toHaveBeenCalled()
  })
})

describe('other agents still project after a failed request', () => {
  it('a non-spot agent keeps the old behavior', async () => {
    setup({ agent: agentRow({ agent_key: 'OUTDOOR_USGS_SNOWPACK', source_url_template: 'https://example.gov/x.json' }) })
    respondWith({}, { ok: false, status: 500 })
    await runAgent('OUTDOOR_USGS_SNOWPACK', ctx)
    expect(h.estimate).toHaveBeenCalledTimes(1)
  })
})

describe('NWS agents', () => {
  const hourly = { type: 'Feature', properties: { periods: [{ temperature: 48, temperatureUnit: 'F', windSpeed: '8 mph', windGust: '20 mph', probabilityOfPrecipitation: { value: 30 } }] } }
  const nws = (key: string, over: Record<string, unknown> = {}) => agentRow({
    agent_key: key, source_url_template: 'https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/forecast/hourly',
    threshold_type: 'delta_pct', threshold_value: 10, ...over,
  })

  it('air temperature records the forecast Fahrenheit figure, tagged as a forecast, and sends a User-Agent', async () => {
    setup({ agent: nws('OUTDOOR_NOAA_TEMP') })
    const fetchMock = respondWith(hourly)
    await runAgent('OUTDOOR_NOAA_TEMP', ctx)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://api.weather.gov/gridpoints/SLC/90,130/forecast/hourly')
    expect(init.headers['User-Agent']).toMatch(/^Meridian\/1\.0/)
    const args = h.record.mock.calls[0] as unknown as [unknown, string, string, number, Record<string, unknown>]
    expect(args[3]).toBe(48)
    expect(args[4]).toEqual({ kind: 'forecast', provider: 'NWS' })
    expect(h.estimate).not.toHaveBeenCalled()
  })

  it('wind records mph with the gust in the detail', async () => {
    setup({ agent: nws('OUTDOOR_WINDY_API', { threshold_type: 'value_above', threshold_value: 30 }) })
    respondWith(hourly)
    await runAgent('OUTDOOR_WINDY_API', ctx)
    const args = h.record.mock.calls[0] as unknown as [unknown, string, string, number, Record<string, unknown>]
    expect(args[3]).toBe(8)
    expect(args[4]).toMatchObject({ kind: 'forecast', gust_mph: 20 })
  })

  it('the old threshold still decides a hit: strong wind is a hit and records the same detail', async () => {
    setup({ agent: nws('OUTDOOR_WINDY_API', { threshold_type: 'value_above', threshold_value: 5 }) })
    respondWith(hourly)
    const r = await runAgent('OUTDOOR_WINDY_API', ctx)
    expect(r.result).toBe('hit')
    expect(h.record).toHaveBeenCalledTimes(1)
  })

  it('an air temperature agent with no grid skips as before', async () => {
    const db = setup({ agent: nws('OUTDOOR_NOAA_TEMP'), profile: { ...PROFILE, nws_grid_office: null } })
    const fetchMock = respondWith(hourly)
    const r = await runAgent('OUTDOOR_NOAA_TEMP', ctx)
    expect(r.result).toBe('skip')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runs(db)[0]).toMatchObject({ error_message: 'location_not_set' })
  })
})
