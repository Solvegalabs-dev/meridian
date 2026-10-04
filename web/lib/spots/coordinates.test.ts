import { describe, it, expect } from 'vitest'
import { accuracyLabel, isLowAccuracy, parseCoordinatePair, validateCoordinates, COORDINATE_MESSAGE } from './coordinates'

describe('parseCoordinatePair', () => {
  it('accepts a comma-separated pair', () => {
    expect(parseCoordinatePair('40.917, -111.397')).toEqual({ lat: 40.917, lon: -111.397 })
  })

  it('accepts a space-separated pair', () => {
    expect(parseCoordinatePair('40.917 -111.397')).toEqual({ lat: 40.917, lon: -111.397 })
  })

  it('accepts a comma with no space', () => {
    expect(parseCoordinatePair('40.917,-111.397')).toEqual({ lat: 40.917, lon: -111.397 })
  })

  it('rejects text that is not a pair', () => {
    expect(parseCoordinatePair('elizabeth pass')).toBeNull()
    expect(parseCoordinatePair('40.917')).toBeNull()
    expect(parseCoordinatePair('')).toBeNull()
  })

  it('rejects a pair outside the valid ranges', () => {
    expect(parseCoordinatePair('91, 0')).toBeNull()
    expect(parseCoordinatePair('40, -181')).toBeNull()
  })
})

describe('validateCoordinates', () => {
  it('accepts valid coordinates, including strings from a form', () => {
    expect(validateCoordinates('40.917', '-111.397')).toBeNull()
  })

  it('rejects missing and out-of-range values with the original message', () => {
    expect(validateCoordinates(null, -111)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('abc', 1)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(-90.1, 0)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(0, 180.5)).toBe(COORDINATE_MESSAGE)
  })
})

describe('accuracy', () => {
  it('formats the reported accuracy', () => {
    expect(accuracyLabel(12.4)).toBe('accurate to ±12 m')
    expect(accuracyLabel(null)).toBeNull()
  })

  it('warns only above 100 m', () => {
    expect(isLowAccuracy(100)).toBe(false)
    expect(isLowAccuracy(101)).toBe(true)
    expect(isLowAccuracy(null)).toBe(false)
  })
})
