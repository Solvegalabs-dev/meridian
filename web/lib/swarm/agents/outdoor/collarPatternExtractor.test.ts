import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

function study(overrides: Partial<{ id: string; taxonIds: string }> = {}) {
  return {
    id: '123', name: 'Test Study', lat: 40.5, lon: -110.0,
    numberOfIndividuals: 5, taxonIds: 'Cervus canadensis', licenseType: 'CC_0',
    citation: 'Test citation (2020)', hasDownloadAccess: true,
    ...overrides,
  }
}
const STUDY = study()

function uniformEvents(): MovebankEvent[] {
  const events: MovebankEvent[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (let i = 0; i < 25; i++) {
      events.push(eventAt(`2026-06-15T${String(hour).padStart(2, '0')}:00:00Z`, `ind-${i % 3}`, 40.5, -110.0))
    }
  }
  return events
}

// A clearly-peaked, threshold-clearing sample (>=500 fixes, >=3 individuals)
// so extractMovementWindows finds a real pattern and the minimum-evidence
// gate passes — used to prove filtering/truncation logic by checking
// exactly how many fixes made it into the written row.
function peakedEvents(individualIds: string[], fixesPerIndividual: number): MovebankEvent[] {
  const events: MovebankEvent[] = []
  for (const id of individualIds) {
    for (let i = 0; i < fixesPerIndividual; i++) {
      const hour = i % 10 === 0 ? 20 : 13 // ~90% at 13:00Z = 07:00 MDT in June
      events.push(eventAt(`2026-06-15T${String(hour).padStart(2, '0')}:00:00Z`, id))
    }
  }
  return events
}

const upsertSpy = vi.fn(async (row: Record<string, unknown>) => { void row; return { error: null } })

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

const { fetchMovebankStudiesMock, fetchMovebankEventsDetailedMock, fetchMovebankIndividualsMock } = vi.hoisted(() => ({
  fetchMovebankStudiesMock: vi.fn(),
  fetchMovebankEventsDetailedMock: vi.fn(),
  fetchMovebankIndividualsMock: vi.fn(),
}))

vi.mock('./movebankCollarFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./movebankCollarFetch')>()
  return {
    ...actual,
    hasMovebankCredentials: () => true,
    fetchMovebankStudies: fetchMovebankStudiesMock,
    fetchMovebankEventsDetailed: fetchMovebankEventsDetailedMock,
    fetchMovebankIndividuals: fetchMovebankIndividualsMock,
  }
})

describe('computeCollarPatterns (Fix 6d integration + addendum 4 species/truncation filtering)', () => {
  beforeEach(() => {
    upsertSpy.mockClear()
    fetchMovebankStudiesMock.mockReset()
    fetchMovebankEventsDetailedMock.mockReset()
    fetchMovebankIndividualsMock.mockReset()
    // The only plain `fetch` call left once movebankCollarFetch is mocked out
    // is queryElevation()'s call to USGS EPQS — stub it so tests that reach
    // a written pattern don't make a real network call.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ value: 8500 }) })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null and never upserts when no movement pattern is discernible', async () => {
    fetchMovebankStudiesMock.mockResolvedValue([STUDY])
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: uniformEvents(), handshake: 'not_required', truncated: false })
    // Empty individuals list triggers the single-taxon fallback — STUDY's
    // taxon_ids lists exactly one species (already matched to be eligible),
    // so all events still pass through, preserving this test's intent.
    fetchMovebankIndividualsMock.mockResolvedValue([])

    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')
    expect(result).toBeNull()
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('filters a multi-species study down to only the requested species (P0 data integrity)', async () => {
    // Mirrors a real study found in a live probe: elk, mule deer, and
    // pronghorn all tagged in the same taxon_ids.
    const multiSpeciesStudy = study({ taxonIds: 'Cervus canadensis,Odocoileus hemionus,Antilocapra americana' })
    fetchMovebankStudiesMock.mockResolvedValue([multiSpeciesStudy])

    const elkIds = ['elk-1', 'elk-2', 'elk-3']
    const deerIds = ['deer-1', 'deer-2']
    fetchMovebankIndividualsMock.mockResolvedValue([
      ...elkIds.map(id => ({ id, localIdentifier: id, taxonCanonicalName: 'Cervus canadensis' })),
      ...deerIds.map(id => ({ id, localIdentifier: id, taxonCanonicalName: 'Odocoileus hemionus' })),
    ])

    const elkEvents = peakedEvents(elkIds, 200)   // 600 fixes — clears the 500/3 minimum evidence gate
    const deerEvents = peakedEvents(deerIds, 200) // would also clear it alone — must never be counted
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [...elkEvents, ...deerEvents], handshake: 'not_required', truncated: false })

    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')

    expect(result).toBe(600) // elk fixes only — deer fixes excluded
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const upserted = upsertSpy.mock.calls[0][0]
    expect(upserted.individual_count).toBe(3)
    expect(upserted.gps_fix_count).toBe(600)
  })

  it('falls back to using all events for a genuinely single-species study when individuals data is unavailable', async () => {
    fetchMovebankStudiesMock.mockResolvedValue([STUDY]) // taxon_ids: 'Cervus canadensis' — exactly one species
    fetchMovebankIndividualsMock.mockRejectedValue(new Error('individuals endpoint down'))
    fetchMovebankEventsDetailedMock.mockResolvedValue({
      events: peakedEvents(['ind-1', 'ind-2', 'ind-3'], 200),
      handshake: 'not_required',
      truncated: false,
    })

    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')

    expect(result).toBe(600)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })

  it('skips a multi-species study entirely when individuals data is unavailable (never mixes species)', async () => {
    const multiSpeciesStudy = study({ taxonIds: 'Cervus canadensis,Odocoileus hemionus' })
    fetchMovebankStudiesMock.mockResolvedValue([multiSpeciesStudy])
    fetchMovebankIndividualsMock.mockRejectedValue(new Error('individuals endpoint down'))
    fetchMovebankEventsDetailedMock.mockResolvedValue({
      events: peakedEvents(['ind-1', 'ind-2', 'ind-3'], 200),
      handshake: 'not_required',
      truncated: false,
    })

    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')

    expect(result).toBeNull() // no eligible study contributed any events
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('truncation safety: a truncated event response is skipped, never treated as the study pattern', async () => {
    fetchMovebankStudiesMock.mockResolvedValue([STUDY])
    fetchMovebankIndividualsMock.mockResolvedValue([])
    fetchMovebankEventsDetailedMock.mockResolvedValue({
      events: peakedEvents(['ind-1', 'ind-2', 'ind-3'], 200), // would otherwise clear every threshold
      handshake: 'not_required',
      truncated: true,
    })

    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')

    expect(result).toBeNull()
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('truncation safety: a non-truncated response with the same data proceeds normally', async () => {
    fetchMovebankStudiesMock.mockResolvedValue([STUDY])
    fetchMovebankIndividualsMock.mockResolvedValue([])
    fetchMovebankEventsDetailedMock.mockResolvedValue({
      events: peakedEvents(['ind-1', 'ind-2', 'ind-3'], 200),
      handshake: 'not_required',
      truncated: false,
    })

    const { computeCollarPatterns } = await import('./collarPatternExtractor')
    const result = await computeCollarPatterns('obj-1')

    expect(result).toBe(600)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })
})
