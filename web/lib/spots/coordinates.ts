// Coordinate rules for hunt spots. Pure functions, shared by the API and the form.

export const ACCURACY_WARN_METERS = 100

// Same message for a missing and an out-of-range value, as the original location route returned.
export const COORDINATE_MESSAGE = 'Latitude must be -90 to 90 and longitude -180 to 180.'

export function validateCoordinates(lat: unknown, lon: unknown): string | null {
  const la = Number(lat)
  const lo = Number(lon)
  if (lat == null || lon == null || !Number.isFinite(la) || !Number.isFinite(lo)) return COORDINATE_MESSAGE
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return COORDINATE_MESSAGE
  return null
}

// Accepts "40.917, -111.397" and "40.917 -111.397". Returns null when the text is not a pair.
export function parseCoordinatePair(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,?\s+(-?\d{1,3}(?:\.\d+)?)$|^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1] ?? m[3])
  const lon = Number(m[2] ?? m[4])
  return validateCoordinates(lat, lon) === null ? { lat, lon } : null
}

// Phone accuracy text. Null when no accuracy was reported.
export function accuracyLabel(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters)) return null
  return `accurate to ±${Math.round(meters)} m`
}

export function isLowAccuracy(meters: number | null | undefined): boolean {
  return meters != null && Number.isFinite(meters) && meters > ACCURACY_WARN_METERS
}
