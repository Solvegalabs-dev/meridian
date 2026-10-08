// Coordinate rules for hunt and fishing spots. Pure functions, shared by the API and the form.

export const ACCURACY_WARN_METERS = 100

// Same message for a missing and an out-of-range value, as the original location route returned.
export const COORDINATE_MESSAGE = 'Latitude must be -90 to 90 and longitude -180 to 180.'

export const PASTE_UNREADABLE_MESSAGE = "Couldn't read those coordinates. Try 40.127, -111.020."

function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

// A missing or empty value is invalid. Number('') is 0, so without this check an empty form box passed as
// latitude 0, and the server then failed at the NWS lookup with a misleading message. Exactly 0, 0 (a point in
// the ocean off Africa, and what an unset pair looks like) is refused too.
export function validateCoordinates(lat: unknown, lon: unknown): string | null {
  const usable = (v: unknown) => typeof v === 'number' || typeof v === 'string'
  if (isBlank(lat) || isBlank(lon) || !usable(lat) || !usable(lon)) return COORDINATE_MESSAGE
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return COORDINATE_MESSAGE
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return COORDINATE_MESSAGE
  if (la === 0 && lo === 0) return COORDINATE_MESSAGE
  return null
}

// ─── Reading pasted coordinates ──────────────────────────────────────────────

type Axis = 'lat' | 'lon'
type Hemisphere = 'N' | 'S' | 'E' | 'W'

const HEMISPHERE_AXIS: Record<Hemisphere, Axis> = { N: 'lat', S: 'lat', E: 'lon', W: 'lon' }
const NEGATIVE: ReadonlySet<Hemisphere> = new Set<Hemisphere>(['S', 'W'])

// Phones and browsers produce several look-alike marks. Map them all to plain °, ' and ".
function normalize(text: string): string {
  return text
    .replace(/[  -   　]/g, ' ')
    .replace(/[º˚∘]/g, '°')          // º ˚ ∘ -> °
    .replace(/[′’‘ʹ´`]/g, "'")  // ′ ’ ‘ ʹ ´ ` -> '
    .replace(/[″”“ʺ]/g, '"')         // ″ ” “ ʺ -> "
    .replace(/''/g, '"')                                  // two apostrophes for seconds
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '')                               // a trailing period
}

const NUM = String.raw`\d+(?:\.\d+)?`
// One value, with the hemisphere letter already taken off: 40.5 | 40.5° | 40°7.6' | 40°7'38.5"
const VALUE_BODY = new RegExp(String.raw`^(-?${NUM})\s*°?(?:\s*(${NUM})\s*'?(?:\s*(${NUM})\s*"?)?)?$`)

type Parsed = { value: number; hemisphere: Hemisphere | null }

function parseValue(raw: string): Parsed | null {
  let body = raw.trim()
  let hemisphere: Hemisphere | null = null

  const lead = /^([NSEW])\s*(.*)$/i.exec(body)
  if (lead) { hemisphere = lead[1].toUpperCase() as Hemisphere; body = lead[2] }
  const trail = /^(.*?)\s*([NSEW])$/i.exec(body)
  if (trail) {
    if (hemisphere) return null // a letter on both ends
    hemisphere = trail[2].toUpperCase() as Hemisphere
    body = trail[1]
  }

  const m = VALUE_BODY.exec(body.trim())
  if (!m) return null
  const [, degRaw, minRaw, secRaw] = m
  const negative = degRaw.startsWith('-')
  const degrees = Math.abs(Number(degRaw))

  let magnitude = degrees
  if (minRaw !== undefined) {
    // Minutes follow whole degrees, seconds follow whole minutes, and both stay under 60.
    if (!Number.isInteger(degrees)) return null
    const minutes = Number(minRaw)
    if (minutes >= 60) return null
    magnitude += minutes / 60
    if (secRaw !== undefined) {
      if (!Number.isInteger(minutes)) return null
      const seconds = Number(secRaw)
      if (seconds >= 60) return null
      magnitude += seconds / 3600
    }
  }

  // A hemisphere letter wins over a minus sign.
  const value = hemisphere ? (NEGATIVE.has(hemisphere) ? -magnitude : magnitude) : (negative ? -magnitude : magnitude)
  return { value, hemisphere }
}

// Gives each value an axis. A letter names its own axis and leaves the other to the other value; with no
// letters the order is latitude then longitude. Two letters must name different axes.
function assignAxes(a: Parsed, b: Parsed): { lat: number; lon: number } | null {
  const axisA = a.hemisphere ? HEMISPHERE_AXIS[a.hemisphere] : null
  const axisB = b.hemisphere ? HEMISPHERE_AXIS[b.hemisphere] : null
  if (axisA && axisB) return axisA === axisB ? null : (axisA === 'lat' ? { lat: a.value, lon: b.value } : { lat: b.value, lon: a.value })
  if (axisA) return axisA === 'lat' ? { lat: a.value, lon: b.value } : { lat: b.value, lon: a.value }
  if (axisB) return axisB === 'lat' ? { lat: b.value, lon: a.value } : { lat: a.value, lon: b.value }
  return { lat: a.value, lon: b.value }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

// Reads one pasted string holding a latitude and a longitude:
//   decimal pairs        40.917, -111.397 | 40.917 -111.397
//   with hemispheres     40.12739 N, 111.02011 W | N40.12739 W111.02011 | -111.02011 W
//   degrees and minutes  40°07.642'N 111°01.228'W | N 40 07.642 W 111 01.228
//   deg, min, sec        40°07'38.5"N 111°01'13.7"W
// Separated by a comma, a space or nothing. Returns decimal degrees to 6 places, or null.
export function parseCoordinatePair(text: string): { lat: number; lon: number } | null {
  const s = normalize(text)
  if (!s || /[^0-9NSEWnsew°'"\s,.\-+]/.test(s) || /[A-Za-z]{2,}/.test(s)) return null

  // With no letters and no degree marks, only a plain decimal pair is unambiguous: "40 07.642 111 01.228" is not.
  const marked = /[NSEWnsew°'"]/.test(s)
  const candidates: Array<[string, string]> = []
  if (s.includes(',')) {
    const parts = s.split(',')
    if (parts.length === 2) candidates.push([parts[0], parts[1]])
  } else {
    // Cut only at a real boundary: whitespace, or next to a hemisphere letter or degree mark. Never inside a number.
    for (let i = 1; i < s.length; i++) {
      const boundary = /\s/.test(s[i - 1]) || /\s/.test(s[i]) || /[NSEWnsew°'"]/.test(s[i - 1]) || /[NSEWnsew]/.test(s[i])
      if (boundary) candidates.push([s.slice(0, i), s.slice(i)])
    }
  }

  for (const [left, right] of candidates) {
    if (!marked) {
      const plain = new RegExp(String.raw`^-?${NUM}$`)
      if (!plain.test(left.trim()) || !plain.test(right.trim())) continue
    }
    const a = parseValue(left)
    const b = parseValue(right)
    if (!a || !b) continue
    const axes = assignAxes(a, b)
    if (!axes) continue
    const lat = round6(axes.lat)
    const lon = round6(axes.lon)
    if (validateCoordinates(lat, lon) === null) return { lat, lon }
  }
  return null
}

// What the paste box shows. Empty text is neither read nor an error. Text that cannot be read is an error
// and leaves Latitude and Longitude alone.
export type PasteResult =
  | { status: 'empty' }
  | { status: 'ok'; lat: number; lon: number }
  | { status: 'unreadable'; message: string }

export function readPaste(text: string): PasteResult {
  if (text.trim() === '') return { status: 'empty' }
  const pair = parseCoordinatePair(text)
  return pair ? { status: 'ok', ...pair } : { status: 'unreadable', message: PASTE_UNREADABLE_MESSAGE }
}

// Phone accuracy text. Null when no accuracy was reported.
export function accuracyLabel(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters)) return null
  return `accurate to ±${Math.round(meters)} m`
}

export function isLowAccuracy(meters: number | null | undefined): boolean {
  return meters != null && Number.isFinite(meters) && meters > ACCURACY_WARN_METERS
}
