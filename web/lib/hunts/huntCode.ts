// UDWR hunt number rules and the pure helpers the lookup uses. No I/O here.
import { inGeometry } from '@/lib/geo/pointInPolygon'

export const HUNT_CODE_RE = /^[A-Z]{2}[0-9]{4}$/
export const CACHE_TTL_DAYS = 30

// Upper-cases and trims, then checks the format. Returns null for anything that is not a hunt number.
export function normalizeHuntCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return HUNT_CODE_RE.test(code) ? code : null
}

// Kill switch. On by default. UDWR_LOOKUP_ENABLED=false (or 0) turns lookups off: manual entry only.
export function udwrLookupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.UDWR_LOOKUP_ENABLED ?? '').trim().toLowerCase()
  return !(v === 'false' || v === '0' || v === 'off')
}

export function isCacheFresh(fetchedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!fetchedAt) return false
  const t = Date.parse(fetchedAt)
  if (Number.isNaN(t)) return false
  return now.getTime() - t < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
}

type FeatureCollection = {
  features?: Array<{ geometry?: { type: string; coordinates: unknown } | null }>
}

// True when the point is inside any polygon of the boundary, false when outside, null when there is no boundary.
export function insideBoundary(boundary: unknown, lat: number, lon: number): boolean | null {
  if (!boundary || typeof boundary !== 'object') return null
  const features = (boundary as FeatureCollection).features ?? []
  const geometries = features
    .map(f => f.geometry)
    .filter((g): g is { type: string; coordinates: unknown } =>
      !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon'))
  if (geometries.length === 0) return null
  return geometries.some(g => inGeometry(lon, lat, g as unknown as Parameters<typeof inGeometry>[2]))
}
