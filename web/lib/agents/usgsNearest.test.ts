// FF-100 Part 1: the nearest gauge that actually has the parameter. Recorded-shape fixtures, no network.
import { describe, it, expect } from 'vitest'
import { milesBetween, nearestGaugeReading } from './usgsNearest'

type Point = { value: string; dateTime?: string; qualifiers?: string[] }

const series = (siteNo: string, siteName: string, lat: number, lon: number, points: Point[], noData = -999999) => ({
  sourceInfo: { siteName, siteCode: [{ value: siteNo, agencyCode: 'USGS' }], geoLocation: { geogLocation: { latitude: lat, longitude: lon } } },
  variable: { variableCode: [{ value: '00010' }], noDataValue: noData },
  values: [{ value: points }],
})
const response = (...s: unknown[]) => ({ value: { timeSeries: s } })

const SPOT = { lat: 40.0, lon: -111.0 }
const T = '2026-10-08T12:00:00.000-06:00'

describe('nearestGaugeReading', () => {
  it('only the second-nearest gauge reports the parameter: that one is used', () => {
    // The nearest gauge (A) measures flow only, so it is simply absent from a temperature response.
    const body = response(series('B', 'Second River', 40.0, -111.2, [{ value: '7.5', dateTime: T }]))
    const r = nearestGaugeReading(body, ['A', 'B', 'C'], SPOT)
    expect(r).toMatchObject({ value: 7.5, site_no: 'B', site_name: 'Second River' })
    expect(r?.distance_mi).toBeGreaterThan(10)
    expect(r?.distance_mi).toBeLessThan(11.5)
  })

  it('follows the order of the pin gauge list, not the order of the response', () => {
    const body = response(
      series('C', 'Far', 40.0, -111.5, [{ value: '9', dateTime: T }]),
      series('A', 'Near', 40.0, -111.01, [{ value: '6', dateTime: T }]),
    )
    expect(nearestGaugeReading(body, ['A', 'B', 'C'], SPOT)?.site_no).toBe('A')
    expect(nearestGaugeReading(body, ['C', 'A'], SPOT)?.site_no).toBe('C')
  })

  it('none of the gauges has it: null', () => {
    expect(nearestGaugeReading(response(), ['A', 'B'], SPOT)).toBeNull()
    expect(nearestGaugeReading(response(series('Z', 'Elsewhere', 40, -111, [{ value: '5' }])), ['A', 'B'], SPOT)).toBeNull()
    expect(nearestGaugeReading({}, ['A'], SPOT)).toBeNull()
    expect(nearestGaugeReading(null, ['A'], SPOT)).toBeNull()
  })

  it('skips the no-data value and moves to the next gauge', () => {
    const body = response(
      series('A', 'Dead sensor', 40.0, -111.01, [{ value: '-999999', dateTime: T }]),
      series('B', 'Working', 40.0, -111.1, [{ value: '8.1', dateTime: T }]),
    )
    expect(nearestGaugeReading(body, ['A', 'B'], SPOT)).toMatchObject({ site_no: 'B', value: 8.1 })
  })

  it('skips the response noDataValue even when it is not -999999', () => {
    const body = response(series('A', 'Odd', 40, -111, [{ value: '-9999' }], -9999))
    expect(nearestGaugeReading(body, ['A'], SPOT)).toBeNull()
  })

  it('skips blank values and values flagged as equipment, ice or maintenance, but keeps provisional ones', () => {
    const body = response(
      series('A', 'Blank', 40, -111, [{ value: '' }]),
      series('B', 'Ice', 40, -111, [{ value: '0.0', qualifiers: ['P', 'Ice'] }]),
      series('C', 'Equipment', 40, -111, [{ value: '4', qualifiers: ['P', 'Eqp'] }]),
      series('D', 'Provisional', 40, -111.1, [{ value: '6.2', qualifiers: ['P'] }]),
    )
    expect(nearestGaugeReading(body, ['A', 'B', 'C', 'D'], SPOT)).toMatchObject({ site_no: 'D', value: 6.2 })
  })

  it('takes the newest usable value of a gauge', () => {
    const body = response(series('A', 'Two points', 40, -111, [
      { value: '5', dateTime: '2026-10-08T10:00:00.000-06:00' },
      { value: '6', dateTime: '2026-10-08T11:00:00.000-06:00' },
      { value: '-999999', dateTime: '2026-10-08T12:00:00.000-06:00' },
    ]))
    expect(nearestGaugeReading(body, ['A'], SPOT)?.value).toBe(6)
  })

  it('a gauge with two sensors uses the newest usable reading among them', () => {
    const body = response(
      series('A', 'Two sensors', 40, -111, [{ value: '5', dateTime: '2026-10-08T10:00:00.000-06:00' }]),
      series('A', 'Two sensors', 40, -111, [{ value: '5.5', dateTime: '2026-10-08T11:30:00.000-06:00' }]),
    )
    expect(nearestGaugeReading(body, ['A'], SPOT)?.value).toBe(5.5)
  })

  it('no coordinates for the spot gives a null distance, never a made-up one', () => {
    const body = response(series('A', 'Near', 40, -111.01, [{ value: '6', dateTime: T }]))
    expect(nearestGaugeReading(body, ['A'], { lat: null, lon: null })?.distance_mi).toBeNull()
  })
})

describe('milesBetween', () => {
  it('one degree of latitude is about 69 miles', () => {
    expect(milesBetween(40, -111, 41, -111)).toBeGreaterThan(68.9)
    expect(milesBetween(40, -111, 41, -111)).toBeLessThan(69.3)
  })

  it('zero for the same point', () => {
    expect(milesBetween(40, -111, 40, -111)).toBe(0)
  })

  it('shrinks with longitude at higher latitude', () => {
    expect(milesBetween(40, -111, 40, -110)).toBeCloseTo(52.9, 0)
  })
})
