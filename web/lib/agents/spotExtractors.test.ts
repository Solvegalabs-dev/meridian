// FF-100 Parts 1 to 3: what the spot-level agents take from a response. Recorded-shape fixtures, no network.
import { describe, it, expect } from 'vitest'
import { extractSpotReading, isSpotAgent } from './spotExtractors'
import { fetchStationPressure, pressureFromObservations } from './nwsStationPressure'

const CTX = { gaugeIds: ['10152000', '10150500'], lat: 40.0, lon: -111.0 }

const usgs = (siteNo: string, lat: number, lon: number, value: string) => ({
  value: { timeSeries: [{
    sourceInfo: { siteName: `Gauge ${siteNo}`, siteCode: [{ value: siteNo }], geoLocation: { geogLocation: { latitude: lat, longitude: lon } } },
    variable: { noDataValue: -999999 },
    values: [{ value: [{ value, dateTime: '2026-10-08T12:00:00.000-06:00' }] }],
  }] },
})

const hourly = (period: Record<string, unknown>) => ({ type: 'Feature', properties: { periods: [period, { temperature: 99 }] } })

describe('USGS agents', () => {
  it('water temperature, oxygen, turbidity and flow all read the nearest gauge with a value', () => {
    for (const key of ['OUTDOOR_USGS_WATER_TEMP', 'OUTDOOR_USGS_DISSOLVED_O2', 'OUTDOOR_USGS_TURBIDITY', 'OUTDOOR_USGS_STREAMFLOW_NEAR']) {
      expect(isSpotAgent(key)).toBe(true)
      const r = extractSpotReading(key, usgs('10150500', 40, -111.1, '7.5'), CTX)
      expect(r?.value).toBe(7.5)
      expect(r?.detail).toMatchObject({ kind: 'gauge', site_no: '10150500', site_name: 'Gauge 10150500' })
      expect(r?.detail.distance_mi).toBeGreaterThan(5)
    }
  })

  it('no gauge with a value is no reading', () => {
    expect(extractSpotReading('OUTDOOR_USGS_WATER_TEMP', { value: { timeSeries: [] } }, CTX)).toBeNull()
  })

  it('the state-level agent is not a spot agent and keeps the generic extractor', () => {
    expect(isSpotAgent('OUTDOOR_USGS_STREAMFLOW_STATE')).toBe(false)
  })
})

describe('NWS hourly forecast', () => {
  it('air temperature is the Fahrenheit figure for this hour, as a forecast', () => {
    const r = extractSpotReading('OUTDOOR_NOAA_TEMP', hourly({ temperature: 48, temperatureUnit: 'F' }), CTX)
    expect(r).toEqual({ value: 48, detail: { kind: 'forecast', provider: 'NWS' } })
  })

  it('a Celsius forecast is converted to Fahrenheit', () => {
    expect(extractSpotReading('OUTDOOR_NOAA_TEMP', hourly({ temperature: 10, temperatureUnit: 'C' }), CTX)?.value).toBe(50)
  })

  it('no temperature in the response is no reading', () => {
    expect(extractSpotReading('OUTDOOR_NOAA_TEMP', { properties: { periods: [] } }, CTX)).toBeNull()
    expect(extractSpotReading('OUTDOOR_NOAA_TEMP', { properties: {} }, CTX)).toBeNull()
    expect(extractSpotReading('OUTDOOR_NOAA_TEMP', 'not json', CTX)).toBeNull()
  })

  it('precipitation is the percent chance; a null chance is no reading', () => {
    expect(extractSpotReading('OUTDOOR_NOAA_PRECIP', hourly({ probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 20 } }), CTX)?.value).toBe(20)
    expect(extractSpotReading('OUTDOOR_NOAA_PRECIP', hourly({ probabilityOfPrecipitation: { value: null } }), CTX)).toBeNull()
    expect(extractSpotReading('OUTDOOR_NOAA_PRECIP', hourly({ probabilityOfPrecipitation: { value: 0 } }), CTX)?.value).toBe(0)
  })

  it('wind is the first number of windSpeed in mph, with the gust beside it when given', () => {
    expect(extractSpotReading('OUTDOOR_WINDY_API', hourly({ windSpeed: '10 to 20 mph' }), CTX)).toEqual({ value: 10, detail: { kind: 'forecast', provider: 'NWS' } })
    expect(extractSpotReading('OUTDOOR_WINDY_API', hourly({ windSpeed: '8 mph', windGust: '25 mph' }), CTX)).toEqual({
      value: 8, detail: { kind: 'forecast', provider: 'NWS', gust_mph: 25 },
    })
    expect(extractSpotReading('OUTDOOR_WINDY_API', hourly({}), CTX)).toBeNull()
  })

  it('the forecast detail objects are not shared between readings', () => {
    const a = extractSpotReading('OUTDOOR_WINDY_API', hourly({ windSpeed: '8 mph', windGust: '25 mph' }), CTX)
    const b = extractSpotReading('OUTDOOR_WINDY_API', hourly({ windSpeed: '9 mph' }), CTX)
    expect(a?.detail).not.toBe(b?.detail)
    expect(b?.detail).not.toHaveProperty('gust_mph')
  })
})

// Pa to inHg is 0.00029530: 101325 Pa is 29.92 inHg.
const obs = (rows: Array<[string, number | null]>) => ({
  type: 'FeatureCollection',
  features: rows.map(([timestamp, pa]) => ({ properties: { timestamp, barometricPressure: { unitCode: 'wmoUnit:Pa', value: pa } } })),
})

describe('NWS station pressure (OUTDOOR_NOAA_BAROMETRIC)', () => {
  it('converts Pa to inHg and records the change over the span', () => {
    const r = pressureFromObservations(obs([
      ['2026-10-08T18:00:00+00:00', 101325],
      ['2026-10-08T17:00:00+00:00', 101000],
      ['2026-10-08T16:00:00+00:00', 100800],
      ['2026-10-08T15:00:00+00:00', 100400],
    ]), 'KPVU')
    expect(r?.value).toBe(29.92)
    expect(r?.detail).toMatchObject({ kind: 'station', station_id: 'KPVU', change_hours: 3 })
    expect(r?.detail.change_inhg).toBeCloseTo(0.27, 2)
  })

  it('skips observations without pressure; none at all is no reading', () => {
    expect(pressureFromObservations(obs([['2026-10-08T18:00:00+00:00', null], ['2026-10-08T17:00:00+00:00', 101000]]), 'K')?.value).toBe(29.83)
    expect(pressureFromObservations(obs([['2026-10-08T18:00:00+00:00', null]]), 'K')).toBeNull()
    expect(pressureFromObservations({}, 'K')).toBeNull()
  })

  it('takes the first listed station that reports pressure, with its distance', async () => {
    const stations = { features: [
      { geometry: { coordinates: [-111.1, 40.0] }, properties: { stationIdentifier: 'NOPRESSURE' } },
      { geometry: { coordinates: [-111.2, 40.0] }, properties: { stationIdentifier: 'KPVU' } },
    ] }
    const urls: string[] = []
    const fakeFetch = (async (url: string) => {
      urls.push(url)
      const body = url.endsWith('/stations') ? stations
        : url.includes('/NOPRESSURE/') ? obs([['2026-10-08T18:00:00+00:00', null]])
        : obs([['2026-10-08T18:00:00+00:00', 101325], ['2026-10-08T15:00:00+00:00', 101000]])
      return { ok: true, status: 200, json: async () => body }
    }) as unknown as typeof fetch
    const r = await fetchStationPressure({ office: 'SLC', x: 90, y: 130, lat: 40.0, lon: -111.0 }, fakeFetch)
    expect(r?.detail).toMatchObject({ kind: 'station', station_id: 'KPVU' })
    expect(r?.detail.distance_mi).toBeGreaterThan(10)
    expect(urls[0]).toBe('https://api.weather.gov/gridpoints/SLC/90,130/stations')
    expect(urls[1]).toBe('https://api.weather.gov/stations/NOPRESSURE/observations?limit=4')
    // The Grand Junction placeholder is gone.
    expect(urls.join(' ')).not.toContain('GJT')
  })

  it('an HTTP error is thrown, so the runner logs an error and projects nothing', async () => {
    const failing = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
    await expect(fetchStationPressure({ office: 'SLC', x: 90, y: 130 }, failing)).rejects.toThrow('HTTP 503')
  })
})
