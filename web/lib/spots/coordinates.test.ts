import { describe, it, expect } from 'vitest'
import {
  accuracyLabel,
  isLowAccuracy,
  parseCoordinatePair,
  readPaste,
  validateCoordinates,
  COORDINATE_MESSAGE,
  PASTE_UNREADABLE_MESSAGE,
} from './coordinates'

// Within 0.000001 degrees, the precision the parser rounds to.
function near(text: string, lat: number, lon: number) {
  const r = parseCoordinatePair(text)
  expect(r, `could not read: ${text}`).not.toBeNull()
  expect(Math.abs(r!.lat - lat)).toBeLessThanOrEqual(0.000001)
  expect(Math.abs(r!.lon - lon)).toBeLessThanOrEqual(0.000001)
}

describe('parseCoordinatePair: decimal pairs (unchanged)', () => {
  it('accepts a comma-separated pair', () => {
    expect(parseCoordinatePair('40.917, -111.397')).toEqual({ lat: 40.917, lon: -111.397 })
  })

  it('accepts a space-separated pair', () => {
    expect(parseCoordinatePair('40.917 -111.397')).toEqual({ lat: 40.917, lon: -111.397 })
  })

  it('accepts a comma with no space', () => {
    expect(parseCoordinatePair('40.917,-111.397')).toEqual({ lat: 40.917, lon: -111.397 })
  })

  it('accepts the Google Maps decimal text that worked before', () => {
    expect(parseCoordinatePair('40.12739, -111.02011')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('accepts two positive decimals separated by a space (latitude then longitude)', () => {
    expect(parseCoordinatePair('40.917 111.397')).toEqual({ lat: 40.917, lon: 111.397 })
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

describe('parseCoordinatePair: degrees, minutes, seconds', () => {
  it('reads the Google Maps string exactly: 40°07\'38.5"N 111°01\'13.7"W', () => {
    near('40°07\'38.5"N 111°01\'13.7"W', 40.127361, -111.020472)
  })

  it('rounds the result to six decimal places', () => {
    expect(parseCoordinatePair('40°07\'38.5"N 111°01\'13.7"W')).toEqual({ lat: 40.127361, lon: -111.020472 })
  })

  it('reads spaces around the marks and a comma between: 40° 7\' 38.5" N, 111° 1\' 13.7" W', () => {
    near('40° 7\' 38.5" N, 111° 1\' 13.7" W', 40.127361, -111.020472)
  })

  it('reads the pair with nothing between the two values', () => {
    near('40°07\'38.5"N111°01\'13.7"W', 40.127361, -111.020472)
  })

  it('reads a pair with no hemisphere letters as latitude then longitude', () => {
    near('40°07\'38.5" 111°01\'13.7"', 40.127361, 111.020472)
  })

  it('rejects 60 or more minutes or seconds', () => {
    expect(parseCoordinatePair('40°07\'75"N 111°01\'13.7"W')).toBeNull()
    expect(parseCoordinatePair('40°60\'10"N 111°01\'13.7"W')).toBeNull()
    expect(parseCoordinatePair('40°07\'38.5"N 111°01\'60"W')).toBeNull()
    expect(parseCoordinatePair('40°07\'38.5"N 111°75\'13.7"W')).toBeNull()
  })

  it('rejects degrees out of range', () => {
    expect(parseCoordinatePair('91°07\'38.5"N 111°01\'13.7"W')).toBeNull()
    expect(parseCoordinatePair('40°07\'38.5"N 181°01\'13.7"W')).toBeNull()
  })
})

describe('parseCoordinatePair: degrees and decimal minutes', () => {
  it('reads 40°07.642\'N 111°01.228\'W', () => {
    near('40°07.642\'N 111°01.228\'W', 40.127367, -111.020467)
  })

  it('reads N 40 07.642 W 111 01.228 (no marks, letters first)', () => {
    near('N 40 07.642 W 111 01.228', 40.127367, -111.020467)
  })

  it('reads 40 07.642 N 111 01.228 W (letters last)', () => {
    near('40 07.642 N 111 01.228 W', 40.127367, -111.020467)
  })

  it('does not guess at four bare numbers with no letters or marks', () => {
    expect(parseCoordinatePair('40 07.642 111 01.228')).toBeNull()
  })

  it('rejects decimal degrees followed by minutes', () => {
    expect(parseCoordinatePair('40.5°07\'N 111°01\'W')).toBeNull()
  })
})

describe('parseCoordinatePair: decimal degrees with a hemisphere letter', () => {
  it('reads 40.12739 N, 111.02011 W', () => {
    expect(parseCoordinatePair('40.12739 N, 111.02011 W')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('reads N40.12739 W111.02011', () => {
    expect(parseCoordinatePair('N40.12739 W111.02011')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('reads 40.12739N 111.02011W and 40.12739° N 111.02011° W', () => {
    expect(parseCoordinatePair('40.12739N 111.02011W')).toEqual({ lat: 40.12739, lon: -111.02011 })
    expect(parseCoordinatePair('40.12739° N 111.02011° W')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('is case-insensitive about the letters', () => {
    expect(parseCoordinatePair('40.12739 n, 111.02011 w')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('S and W are negative, N and E are positive', () => {
    expect(parseCoordinatePair('33.5 S, 151.2 E')).toEqual({ lat: -33.5, lon: 151.2 })
    expect(parseCoordinatePair('33.5 N, 151.2 W')).toEqual({ lat: 33.5, lon: -151.2 })
  })
})

describe('parseCoordinatePair: hemisphere letter wins over a minus sign', () => {
  it('-111.02011 W and 111.02011 W both give -111.02011', () => {
    expect(parseCoordinatePair('40.12739 N, -111.02011 W')).toEqual({ lat: 40.12739, lon: -111.02011 })
    expect(parseCoordinatePair('40.12739 N, 111.02011 W')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('a letter says the value is positive even with a minus sign', () => {
    expect(parseCoordinatePair('40.12739 N, -111.02011 E')).toEqual({ lat: 40.12739, lon: 111.02011 })
  })

  it('a letter on one value only is allowed when the other is plain decimal', () => {
    expect(parseCoordinatePair('40.12739, 111.02011 W')).toEqual({ lat: 40.12739, lon: -111.02011 })
    expect(parseCoordinatePair('40.12739 N, -111.02011')).toEqual({ lat: 40.12739, lon: -111.02011 })
    expect(parseCoordinatePair('N 40.12739 -111.02011')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })
})

describe('parseCoordinatePair: order', () => {
  it('accepts longitude first when the letters make it unambiguous', () => {
    expect(parseCoordinatePair('111.02011 W, 40.12739 N')).toEqual({ lat: 40.12739, lon: -111.02011 })
    near('111°01\'13.7"W 40°07\'38.5"N', 40.127361, -111.020472)
    expect(parseCoordinatePair('W111.02011 N40.12739')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })

  it('a lone letter on the second value fixes the order', () => {
    expect(parseCoordinatePair('111.02011, 40.12739 N')).toEqual({ lat: 40.12739, lon: 111.02011 })
  })

  it('rejects two values that name the same axis', () => {
    expect(parseCoordinatePair('40.1 N, 41.2 S')).toBeNull()
    expect(parseCoordinatePair('111.0 W, 110.0 E')).toBeNull()
  })
})

describe('parseCoordinatePair: symbol variants from phones and browsers', () => {
  it('reads º and ˚ for degrees', () => {
    near('40º07\'38.5"N 111˚01\'13.7"W', 40.127361, -111.020472)
  })

  it('reads ′ ’ ‘ for minutes and ″ ” “ for seconds', () => {
    near('40°07′38.5″N 111°01′13.7″W', 40.127361, -111.020472)
    near('40°07’38.5”N 111°01’13.7”W', 40.127361, -111.020472)
    near('40°07‘38.5“N 111°01‘13.7“W', 40.127361, -111.020472)
  })

  it('reads two apostrophes for seconds', () => {
    near('40°07\'38.5\'\'N 111°01\'13.7\'\'W', 40.127361, -111.020472)
  })

  it('reads non-breaking spaces, surrounding spaces and a trailing period', () => {
    near('  40°07\'38.5"N 111°01\'13.7"W  ', 40.127361, -111.020472)
    near('40°07\'38.5"N 111°01\'13.7"W.', 40.127361, -111.020472)
    expect(parseCoordinatePair('40.12739, -111.02011.')).toEqual({ lat: 40.12739, lon: -111.02011 })
  })
})

describe('parseCoordinatePair: text that is not coordinates', () => {
  it('returns null for words and stray letters', () => {
    for (const text of ['abc', 'elizabeth pass', 'north fork, 40.1', '40.1 foo, 111.0 W', 'NE 40.1 111.0', 'Green River', '40.1 N N 111.0']) {
      expect(parseCoordinatePair(text), text).toBeNull()
    }
  })

  it('returns null for one number, three numbers, an empty string or only symbols', () => {
    for (const text of ['40.12739', '40.1 41.2 42.3', '', '   ', '°\'"', ',']) {
      expect(parseCoordinatePair(text), text).toBeNull()
    }
  })

  it('returns null for exactly 0, 0', () => {
    expect(parseCoordinatePair('0, 0')).toBeNull()
    expect(parseCoordinatePair('0°0\'0"N 0°0\'0"E')).toBeNull()
  })

  it('never splits inside a number', () => {
    expect(parseCoordinatePair('40.917')).toBeNull()
    expect(parseCoordinatePair('4091711139')).toBeNull()
  })
})

describe('readPaste', () => {
  it('is empty for blank text, so no message shows', () => {
    expect(readPaste('')).toEqual({ status: 'empty' })
    expect(readPaste('   ')).toEqual({ status: 'empty' })
  })

  it('returns the decimal pair when the text can be read', () => {
    expect(readPaste('40°07\'38.5"N 111°01\'13.7"W')).toEqual({ status: 'ok', lat: 40.127361, lon: -111.020472 })
  })

  it('returns the message when text is present but cannot be read', () => {
    expect(readPaste('abc')).toEqual({ status: 'unreadable', message: PASTE_UNREADABLE_MESSAGE })
    expect(PASTE_UNREADABLE_MESSAGE).toBe("Couldn't read those coordinates. Try 40.127, -111.020.")
  })
})

describe('validateCoordinates', () => {
  it('accepts valid coordinates, including strings from a form and plain numbers', () => {
    expect(validateCoordinates('40.917', '-111.397')).toBeNull()
    expect(validateCoordinates(40.917, -111.397)).toBeNull()
    expect(validateCoordinates(0, 45)).toBeNull() // the equator is fine; only exactly 0, 0 is not
    expect(validateCoordinates('45', '0')).toBeNull()
  })

  it('rejects missing and out-of-range values with the original message', () => {
    expect(validateCoordinates(null, -111)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('abc', 1)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(-90.1, 0)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(0, 180.5)).toBe(COORDINATE_MESSAGE)
  })

  it('rejects empty and whitespace-only strings, which Number() would turn into 0', () => {
    expect(validateCoordinates('', '')).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(' ', ' ')).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('', '-111.397')).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('40.917', '')).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('40.917', '   ')).toBe(COORDINATE_MESSAGE)
  })

  it('rejects null and undefined on either side', () => {
    expect(validateCoordinates(undefined, undefined)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(null, null)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(40, undefined)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(undefined, -111)).toBe(COORDINATE_MESSAGE)
  })

  it('rejects exactly 0, 0 in every spelling', () => {
    expect(validateCoordinates(0, 0)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('0', '0')).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates('0.0', '-0')).toBe(COORDINATE_MESSAGE)
  })

  it('rejects values that are not numbers or strings', () => {
    expect(validateCoordinates(true, false)).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates([], [])).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates({}, {})).toBe(COORDINATE_MESSAGE)
    expect(validateCoordinates(NaN, 1)).toBe(COORDINATE_MESSAGE)
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
