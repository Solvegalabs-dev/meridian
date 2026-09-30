import { describe, it, expect, vi } from 'vitest'
import { localParts, extractMovementWindows } from './collarPatternExtractor'
import type { MovebankEvent } from './movebankCollarFetch'

describe('localParts (Fix 2 — local-hour binning across a DST boundary)', () => {
  it('applies MST before the spring-forward transition and MDT after it', () => {
    // America/Denver spring-forward 2026: 2026-03-08 02:00 MST -> 03:00 MDT
    // (transition instant is 2026-03-08T09:00:00Z).
    const beforeTransition = new Date('2026-03-08T08:00:00Z') // still MST (UTC-7)
    const afterTransition = new Date('2026-03-09T08:00:00Z')  // now MDT (UTC-6)

    expect(localParts(beforeTransition, 'America/Denver').hour).toBe(1)
    expect(localParts(afterTransition, 'America/Denver').hour).toBe(2)
  })

  it('reads the local month, not the UTC month, near a month/timezone edge', () => {
    // 2026-02-01T05:00:00Z is still 2026-01-31 22:00 local in America/Denver (UTC-7).
    const nearMidnight = new Date('2026-02-01T05:00:00Z')
    expect(localParts(nearMidnight, 'America/Denver').month).toBe(1)
  })
})

function eventAt(isoUtc: string, individualId: string, lat = 40.5, lon = -110.0): MovebankEvent {
  // Movebank's own space-separated format, so this exercises the same
  // string shape the extractor actually receives in production.
  return { individualId, timestamp: isoUtc.replace('T', ' ').replace('Z', ''), lat, lon }
}

describe('extractMovementWindows (Fix 6d — never cache an empty pattern)', () => {
  it('finds an IQR peak window for a clear pre-dawn spike', () => {
    const events: MovebankEvent[] = []
    for (let i = 0; i < 40; i++) events.push(eventAt('2026-06-15T13:00:00Z', 'ind-1')) // 07:00 MDT
    for (let i = 0; i < 5; i++) events.push(eventAt('2026-06-15T20:00:00Z', 'ind-1'))  // 14:00 MDT (quiet)

    const windows = extractMovementWindows(events, 'America/Denver')
    expect(windows).not.toBeNull()
    expect(windows!.some(w => w.window_start_hour === 7)).toBe(true)
  })

  it('falls back to the 1.5x-mean threshold when IQR finds no outliers', () => {
    // A linear ramp (counts[hour] = hour, 0..23) has enough spread that
    // Q3 + 1.5*IQR (18 + 1.5*12 = 36) exceeds the max count (23), so the IQR
    // method flags nothing. Mean is 11.5, so 1.5x mean (17.25) is cleared by
    // hours 18-23 — proving the fallback branch, not just IQR, runs here.
    // Uses UTC directly to keep the math exact (no local-offset arithmetic).
    const events: MovebankEvent[] = []
    for (let hour = 0; hour < 24; hour++) {
      for (let i = 0; i < hour; i++) {
        events.push(eventAt(`2026-06-15T${String(hour).padStart(2, '0')}:00:00Z`, `ind-${i % 3}`))
      }
    }

    const windows = extractMovementWindows(events, 'UTC')
    expect(windows).not.toBeNull()
    expect(windows!.some(w => w.window_start_hour >= 18 && w.window_end_hour === 24)).toBe(true)
  })

  it('returns null (not an empty array) for a perfectly uniform distribution', () => {
    const events: MovebankEvent[] = []
    for (let hour = 0; hour < 24; hour++) {
      for (let i = 0; i < 10; i++) {
        events.push(eventAt(`2026-06-15T${String(hour).padStart(2, '0')}:00:00Z`, `ind-${i % 3}`))
      }
    }

    expect(extractMovementWindows(events, 'America/Denver')).toBeNull()
  })
})

// --- Integration: a uniform (no-pattern) sample must return null and must
// never write a row (Fix 6d's other half — the caller must not cache it). ---

const PROFILE = { taxonomy_key: 'elk.bull.archery', lat: 40.5, lon: -110.0, state: 'UT', hunt_unit_id: 'HD-316' }
const STUDY = {
  id: '123', name: 'Test Study', lat: 40.5, lon: -110.0,
  numberOfIndividuals: 5, taxonIds: 'Cervus canadensis', licenseType: 'CC_0',
  citation: 'Test citation (2020)', hasDownloadAccess: true,
}

function uniformEvents(): MovebankEvent[] {
  const events: MovebankEvent[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (let i = 0; i < 25; i++) {
      events.push(eventAt(`2026-06-15T${String(hour).padStart(2, '0')}:00:00Z`, `ind-${i % 3}`, 40.5, -110.0))
    }
  }
  return events
}

const upsertSpy = vi.fn(async () => ({ error: null }))

function makeChain(finalValue: unknown) {
  type Chain = Record<string, unknown>
  const chain: Chain = {}
  ;['select', 'eq', 'order', 'limit', 'like', 'in', 'not'].forEach(m => {
    chain[m] = vi.fn(() => chain)
  })
  chain.maybeSingle = vi.fn(async () => finalValue)
  chain.upsert = upsertSpy
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'objective_profiles') return makeChain({ data: PROFILE })
      if (table === 'collar_pattern_library') return makeChain({ data: null })
      if (table === 'terrain_cache') return makeChain({ data: null })
      return makeChain({ data: null })
    },
  }),
}))

vi.mock('./movebankCollarFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./movebankCollarFetch')>()
  return {
    ...actual,
    hasMovebankCredentials: () => true,
    fetchMovebankStudies: async () => [STUDY],
    fetchMovebankEvents: async () => uniformEvents(),
  }
})

describe('computeCollarPatterns (Fix 6d integration)', () => {
  it('returns null and never upserts when no movement pattern is discernible', async () => {
    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')
    expect(result).toBeNull()
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})
