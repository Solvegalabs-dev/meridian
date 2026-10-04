import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildWindows,
  splitWindowInHalf,
  binEventsForAggregate,
  classifyMovebankError,
  filterEventsBySpeciesForJob,
  topTaxonNameCounts,
} from './jobRunner'
import type { MovebankEventWithTaxon, MovebankIndividual } from '../movebankCollarFetch'
import { decodeGeohash } from '@/lib/geo/geohash'

const { fetchMovebankStudyMetaMock } = vi.hoisted(() => ({ fetchMovebankStudyMetaMock: vi.fn() }))

// --- Shared mock Supabase client for the claim/requeue/runOneJob/license
// integration tests below. Each `.from(table)` call gets its own
// thenable+maybeSingle-able builder so chains ending either way work,
// matching real supabase-js query builder behavior. ---
type Thenable<T> = PromiseLike<T> & { maybeSingle: () => Promise<T>; select: (cols?: string) => Thenable<T> }

function makeTableRecorder() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return { calls }
}

function chain<T>(resolver: () => Promise<T>, record?: (method: string, args: unknown[]) => void): Thenable<T> {
  const self: Record<string, unknown> = {
    eq: (...args: unknown[]) => { record?.('eq', args); return self },
    lt: (...args: unknown[]) => { record?.('lt', args); return self },
    or: (...args: unknown[]) => { record?.('or', args); return self },
    limit: (...args: unknown[]) => { record?.('limit', args); return self },
    update: (...args: unknown[]) => { record?.('update', args); return self },
    upsert: (...args: unknown[]) => { record?.('upsert', args); return self },
    select: (...args: unknown[]) => { record?.('select', args); return self },
    maybeSingle: resolver,
    then: (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) => resolver().then(onFulfilled, onRejected),
  }
  return self as unknown as Thenable<T>
}

type MockSupabaseConfig = {
  rpcResult?: { data: unknown; error: unknown }
  licenseAcceptanceExists?: boolean
  catalogRow?: { license_type: string | null; taxon_ids: string | null; citation: string | null } | null
}

function makeMockSupabase(config: MockSupabaseConfig) {
  const recorder = makeTableRecorder()
  const rpcMock = vi.fn(async () => config.rpcResult ?? { data: null, error: null })

  const client = {
    rpc: rpcMock,
    from: (table: string) => {
      recorder.calls.push({ method: `from:${table}`, args: [] })

      if (table === 'movebank_license_acceptances') {
        return chain(async () => ({ data: config.licenseAcceptanceExists ? { study_id: 1 } : null }), (m, a) => recorder.calls.push({ method: `${table}.${m}`, args: a }))
      }
      if (table === 'movebank_study_catalog') {
        return chain(async () => ({ data: config.catalogRow ?? null }), (m, a) => recorder.calls.push({ method: `${table}.${m}`, args: a }))
      }
      if (table === 'collar_jobs') {
        return chain(async () => ({ data: [] }), (m, a) => recorder.calls.push({ method: `${table}.${m}`, args: a }))
      }
      if (table === 'collar_study_aggregates') {
        return chain(async () => ({ data: null }), (m, a) => recorder.calls.push({ method: `${table}.${m}`, args: a }))
      }
      return chain(async () => ({ data: null }), (m, a) => recorder.calls.push({ method: `${table}.${m}`, args: a }))
    },
  }
  return { client, recorder, rpcMock }
}

describe('buildWindows (A1 — season_month +/-1 intersected with the study range)', () => {
  it('returns [] when the study has no date range', () => {
    expect(buildWindows(10, null, null)).toEqual([])
  })

  it('returns [] when the range is inverted', () => {
    expect(buildWindows(10, new Date('2020-01-01'), new Date('2019-01-01'))).toEqual([])
  })

  it('covers Sep/Oct/Nov as half-month windows for an October hunt within a single-year range', () => {
    const windows = buildWindows(10, new Date('2019-01-01T00:00:00Z'), new Date('2019-12-31T00:00:00Z'))
    // 3 months x 2 halves = 6 windows, all within 2019.
    expect(windows).toHaveLength(6)
    expect(windows[0].start.getUTCMonth()).toBe(8) // September (0-indexed)
    expect(windows.every(w => w.start.getUTCFullYear() === 2019)).toBe(true)
  })

  it('clips windows to the study range rather than running past it', () => {
    // Study ends May 16 2020 — mirrors the real study (7364502758) from the
    // live probe findings. A June hunt's window (May/Jun/Jul) should only
    // produce windows that exist before the study ends.
    const windows = buildWindows(6, new Date('2019-01-01T00:00:00Z'), new Date('2020-05-16T00:00:00Z'))
    for (const w of windows) {
      expect(w.end.getTime()).toBeLessThanOrEqual(new Date('2020-05-16T00:00:00Z').getTime())
    }
    // May 2020's second half (16th-31st) and June/July 2020 entirely are out of range.
    const has2020SecondHalf = windows.some(w => w.start.getUTCFullYear() === 2020 && w.start.getUTCMonth() === 4 && w.start.getUTCDate() === 16)
    expect(has2020SecondHalf).toBe(false)
  })

  it('returns [] for a window that falls entirely outside the study range', () => {
    // Study only covers 2019 — a January hunt's "Dec/Jan/Feb" would need
    // December 2018, which is before the study even starts.
    const windows = buildWindows(1, new Date('2019-06-01T00:00:00Z'), new Date('2019-06-30T00:00:00Z'))
    expect(windows).toEqual([]) // Dec 2018, Jan 2019, Feb 2019 all miss the June-only range
  })

  it('handles year rollover correctly for a January hunt (needs December of the PREVIOUS year)', () => {
    const windows = buildWindows(1, new Date('2018-12-01T00:00:00Z'), new Date('2019-02-28T00:00:00Z'))
    const hasDecember2018 = windows.some(w => w.start.getUTCFullYear() === 2018 && w.start.getUTCMonth() === 11)
    expect(hasDecember2018).toBe(true)
  })

  it('handles year rollover correctly for a December hunt (needs January of the NEXT year)', () => {
    const windows = buildWindows(12, new Date('2019-11-01T00:00:00Z'), new Date('2020-01-31T00:00:00Z'))
    const hasJanuary2020 = windows.some(w => w.start.getUTCFullYear() === 2020 && w.start.getUTCMonth() === 0)
    expect(hasJanuary2020).toBe(true)
  })
})

describe('splitWindowInHalf (A1 — truncation response)', () => {
  it('splits a window at its exact midpoint', () => {
    const window = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-15T00:00:00Z') }
    const [first, second] = splitWindowInHalf(window)
    expect(first.start).toEqual(window.start)
    expect(first.end).toEqual(second.start)
    expect(second.end).toEqual(window.end)
    expect(first.end.getTime() - first.start.getTime()).toBe(second.end.getTime() - second.start.getTime())
  })
})

function event(isoUtc: string, individualId: string, taxonCanonicalName = '', lat = 40.5, lon = -110.0): MovebankEventWithTaxon {
  return { individualId, timestamp: isoUtc.replace('T', ' ').replace('Z', ''), lat, lon, taxonCanonicalName }
}

describe('binEventsForAggregate (local-hour binning + A7 years_present)', () => {
  it('bins across a DST boundary using the correct offset per event', () => {
    // America/Denver spring-forward 2026: 2026-03-08 02:00 MST -> 03:00 MDT.
    const events = [
      event('2026-03-08T08:00:00Z', 'ind-1'), // still MST (UTC-7) -> 01:00 local
      event('2026-03-09T08:00:00Z', 'ind-1'), // now MDT (UTC-6) -> 02:00 local
    ]
    const result = binEventsForAggregate(events, 'America/Denver')
    expect(result.hourlyCounts['3'][1]).toBe(1) // March, hour 1
    expect(result.hourlyCounts['3'][2]).toBe(1) // March, hour 2
    expect(result.nFixes).toBe(2)
  })

  it('records distinct years present and tracks individuals/first-last timestamps', () => {
    const events = [
      event('2019-10-01T13:00:00Z', 'ind-1'),
      event('2019-10-15T13:00:00Z', 'ind-2'),
      event('2020-10-01T13:00:00Z', 'ind-1'),
    ]
    const result = binEventsForAggregate(events, 'America/Denver')
    expect(result.yearsPresent).toEqual([2019, 2020])
    expect(result.individualIds.size).toBe(2)
    expect(result.firstTs?.toISOString()).toBe('2019-10-01T13:00:00.000Z')
    expect(result.lastTs?.toISOString()).toBe('2020-10-01T13:00:00.000Z')
  })

  it('returns zeroed counts and no years for an empty event list', () => {
    const result = binEventsForAggregate([], 'America/Denver')
    expect(result.nFixes).toBe(0)
    expect(result.yearsPresent).toEqual([])
    expect(result.hourlyCounts['1']).toEqual(new Array(24).fill(0))
  })
})

describe('classifyMovebankError', () => {
  it('classifies HTTP 429 and 5xx from the Movebank HTTP <status> message', () => {
    expect(classifyMovebankError(new Error('Movebank HTTP 429'))).toBe('429')
    expect(classifyMovebankError(new Error('Movebank HTTP 503'))).toBe('5xx')
  })

  it('classifies DOMException-style timeout/abort errors by name', () => {
    const timeoutErr = new Error('The operation was aborted due to timeout')
    timeoutErr.name = 'TimeoutError'
    expect(classifyMovebankError(timeoutErr)).toBe('timeout')

    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    expect(classifyMovebankError(abortErr)).toBe('abort')
  })

  it('classifies anything else as other', () => {
    expect(classifyMovebankError(new Error('license handshake rejected'))).toBe('other')
    expect(classifyMovebankError('not even an Error')).toBe('other')
  })
})

describe('filterEventsBySpeciesForJob (A2 — multi-species study, never mix species)', () => {
  const SCIENTIFIC_NAMES = ['Cervus elaphus', 'Cervus canadensis']

  it('filters using the primary event-level individual_taxon_canonical_name attribute when populated', async () => {
    const events: MovebankEventWithTaxon[] = [
      event('2019-10-01T13:00:00Z', 'elk-1', 'Cervus elaphus'),
      event('2019-10-01T14:00:00Z', 'deer-1', 'Odocoileus hemionus'),
      event('2019-10-01T15:00:00Z', 'pronghorn-1', 'Antilocapra americana'),
    ]
    const result = await filterEventsBySpeciesForJob('123', 'Cervus elaphus,Odocoileus hemionus,Antilocapra americana', events, SCIENTIFIC_NAMES)

    expect(result.outcome).toBe('filtered')
    if (result.outcome === 'filtered') {
      expect(result.events.map(e => e.individualId)).toEqual(['elk-1'])
    }
  })

  it('falls back to the individuals table when the event attribute is empty for every row', async () => {
    const fetchIndividualsMock = vi.fn(async (): Promise<MovebankIndividual[]> => [
      { id: 'elk-1', localIdentifier: 'E1', taxonCanonicalName: 'Cervus elaphus' },
      { id: 'deer-1', localIdentifier: 'D1', taxonCanonicalName: 'Odocoileus hemionus' },
    ])
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankIndividuals: fetchIndividualsMock }
    })
    vi.resetModules()
    const { filterEventsBySpeciesForJob: filterWithMock } = await import('./jobRunner')

    const events: MovebankEventWithTaxon[] = [
      event('2019-10-01T13:00:00Z', 'elk-1', ''), // no taxon on the event itself
      event('2019-10-01T14:00:00Z', 'deer-1', ''),
    ]
    const result = await filterWithMock('123', 'Cervus elaphus,Odocoileus hemionus', events, SCIENTIFIC_NAMES)

    expect(fetchIndividualsMock).toHaveBeenCalled()
    expect(result.outcome).toBe('filtered')
    if (result.outcome === 'filtered') {
      expect(result.events.map(e => e.individualId)).toEqual(['elk-1'])
    }
  })

  it('uses all events for a genuinely single-species study when both attribute sources are unavailable', async () => {
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankIndividuals: vi.fn().mockRejectedValue(new Error('500')) }
    })
    vi.resetModules()
    const { filterEventsBySpeciesForJob: filterWithMock } = await import('./jobRunner')

    const events: MovebankEventWithTaxon[] = [event('2019-10-01T13:00:00Z', 'elk-1', '')]
    const result = await filterWithMock('123', 'Cervus elaphus', events, SCIENTIFIC_NAMES)

    expect(result.outcome).toBe('filtered')
    if (result.outcome === 'filtered') expect(result.events).toHaveLength(1)
  })

  it('marks the job dead when a multi-species study cannot be separated by either attribute source', async () => {
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankIndividuals: vi.fn().mockResolvedValue([]) }
    })
    vi.resetModules()
    const { filterEventsBySpeciesForJob: filterWithMock } = await import('./jobRunner')

    const events: MovebankEventWithTaxon[] = [event('2019-10-01T13:00:00Z', 'elk-1', '')]
    const result = await filterWithMock('123', 'Cervus elaphus,Odocoileus hemionus', events, SCIENTIFIC_NAMES)

    expect(result).toEqual({ outcome: 'dead', reason: 'species_not_separable' })
  })

  it('returns an empty filtered result without any network call for an empty event list', async () => {
    const fetchIndividualsSpy = vi.fn()
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankIndividuals: fetchIndividualsSpy }
    })
    vi.resetModules()
    const { filterEventsBySpeciesForJob: filterWithMock } = await import('./jobRunner')

    const result = await filterWithMock('123', 'Cervus elaphus', [], SCIENTIFIC_NAMES)
    expect(result).toEqual({ outcome: 'filtered', events: [] })
    expect(fetchIndividualsSpy).not.toHaveBeenCalled()
  })
})

describe('topTaxonNameCounts (fix round item 1 — stats diagnostics, counts only)', () => {
  it('returns the top 5 distinct names sorted by count, descending', () => {
    const events = [
      ...Array(10).fill(0).map(() => event('2020-01-01T00:00:00Z', 'i', 'Cervus elaphus')),
      ...Array(5).fill(0).map(() => event('2020-01-01T00:00:00Z', 'i', 'Odocoileus hemionus')),
      ...Array(3).fill(0).map(() => event('2020-01-01T00:00:00Z', 'i', 'Antilocapra americana')),
      ...Array(2).fill(0).map(() => event('2020-01-01T00:00:00Z', 'i', 'Canis latrans')),
      ...Array(1).fill(0).map(() => event('2020-01-01T00:00:00Z', 'i', 'Puma concolor')),
      ...Array(1).fill(0).map(() => event('2020-01-01T00:00:00Z', 'i', 'Ursus americanus')), // 6th distinct name, must be dropped
    ]
    const result = topTaxonNameCounts(events)
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ name: 'Cervus elaphus', count: 10 })
    expect(result[4]).toEqual({ name: 'Puma concolor', count: 1 })
    expect(result.some(r => r.name === 'Ursus americanus')).toBe(false)
  })

  it('groups a missing/empty taxon name under "(empty)"', () => {
    const events = [event('2020-01-01T00:00:00Z', 'i', ''), event('2020-01-01T00:00:00Z', 'i', '')]
    expect(topTaxonNameCounts(events)).toEqual([{ name: '(empty)', count: 2 }])
  })

  it('returns [] for an empty event list', () => {
    expect(topTaxonNameCounts([])).toEqual([])
  })
})

describe('claimJob / requeueStaleJobs (DB-level atomic claim)', () => {
  // The true FOR UPDATE SKIP LOCKED concurrency guarantee is enforced by
  // Postgres inside claim_collar_job() (migration 20261001) — not
  // unit-testable without a real database. What IS testable here: the
  // client correctly calls the RPC and interprets both of its possible
  // "nothing to claim" shapes (a true null, and the all-NULL row the
  // function returns when its UPDATE affects zero rows).
  afterEach(() => { vi.doUnmock('@/lib/supabase/server'); vi.resetModules() })

  it('returns the claimed job when the RPC returns a populated row', async () => {
    const job = { id: 'job-1', objective_id: 'obj-1', species_taxon_key: 'elk.bull', role: 'primary', study_id: 123, geo_hash: '9xyz5', local_tz: 'America/Denver', window_start: '2019-10-01T00:00:00Z', window_end: '2019-10-16T00:00:00Z', split_depth: 0, status: 'running', attempts: 1, max_attempts: 3, run_after: '2019-10-01T00:00:00Z', locked_until: null, last_error: null }
    const { client } = makeMockSupabase({ rpcResult: { data: job, error: null } })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.resetModules()

    const { claimJob } = await import('./jobRunner')
    const result = await claimJob()
    expect(result).toEqual(job)
  })

  it('returns null when the RPC returns an all-NULL row (nothing claimable)', async () => {
    const allNullRow = { id: null, objective_id: null, species_taxon_key: null, role: null, study_id: null, geo_hash: null, local_tz: null, window_start: null, window_end: null, split_depth: null, status: null, attempts: null, max_attempts: null, run_after: null, locked_until: null, last_error: null }
    const { client } = makeMockSupabase({ rpcResult: { data: allNullRow, error: null } })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.resetModules()

    const { claimJob } = await import('./jobRunner')
    expect(await claimJob()).toBeNull()
  })

  it('returns null and logs (never throws) when the RPC itself errors', async () => {
    const { client } = makeMockSupabase({ rpcResult: { data: null, error: { message: 'db unavailable' } } })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.resetModules()

    const { claimJob } = await import('./jobRunner')
    expect(await claimJob()).toBeNull()
  })

  it('requeueStaleJobs updates running jobs whose lock has expired', async () => {
    const { client, recorder } = makeMockSupabase({})
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.resetModules()

    const { requeueStaleJobs } = await import('./jobRunner')
    await requeueStaleJobs()

    const updateCall = recorder.calls.find(c => c.method === 'collar_jobs.update')
    expect(updateCall?.args[0]).toMatchObject({ status: 'queued', locked_until: null })
  })
})

describe('ensureLicenseRecordedForStudy (A5 — record on first use, not only on handshake)', () => {
  beforeEach(() => {
    fetchMovebankStudyMetaMock.mockReset()
  })
  afterEach(() => { vi.doUnmock('@/lib/supabase/server'); vi.doUnmock('../movebankCollarFetch'); vi.resetModules() })

  it('does nothing when a license_acceptances row already exists for the study', async () => {
    const { client } = makeMockSupabase({ licenseAcceptanceExists: true })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankStudyMeta: fetchMovebankStudyMetaMock }
    })
    vi.resetModules()

    const { ensureLicenseRecordedForStudy } = await import('./jobRunner')
    const result = await ensureLicenseRecordedForStudy('123')

    expect(fetchMovebankStudyMetaMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })

  it('fetches study metadata and inserts once with source=study_metadata when no row exists', async () => {
    fetchMovebankStudyMetaMock.mockResolvedValue({
      timestampFirstDeployedLocation: '', timestampLastDeployedLocation: '', numberOfDeployedLocations: '',
      sensorTypeIds: '', taxonIds: '', numberOfIndividuals: '', licenseTerms: 'You may use this data for...',
    })
    const { client, recorder } = makeMockSupabase({ licenseAcceptanceExists: false })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankStudyMeta: fetchMovebankStudyMetaMock }
    })
    vi.resetModules()

    const { ensureLicenseRecordedForStudy } = await import('./jobRunner')
    const result = await ensureLicenseRecordedForStudy('123')

    expect(fetchMovebankStudyMetaMock).toHaveBeenCalledTimes(1)
    const upsertCall = recorder.calls.find(c => c.method === 'movebank_license_acceptances.upsert')
    expect(upsertCall?.args[0]).toMatchObject({ study_id: 123, source: 'study_metadata' })
    expect(JSON.stringify(upsertCall?.args)).not.toContain('testuser') // sanity: no credentials ever flow through this path
    expect(result).toEqual({ ok: true })
  })

  it('does not insert when the study metadata has no license_terms', async () => {
    fetchMovebankStudyMetaMock.mockResolvedValue({
      timestampFirstDeployedLocation: '', timestampLastDeployedLocation: '', numberOfDeployedLocations: '',
      sensorTypeIds: '', taxonIds: '', numberOfIndividuals: '', licenseTerms: '',
    })
    const { client, recorder } = makeMockSupabase({ licenseAcceptanceExists: false })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankStudyMeta: fetchMovebankStudyMetaMock }
    })
    vi.resetModules()

    const { ensureLicenseRecordedForStudy } = await import('./jobRunner')
    const result = await ensureLicenseRecordedForStudy('123')

    expect(recorder.calls.find(c => c.method === 'movebank_license_acceptances.upsert')).toBeUndefined()
    expect(result).toEqual({ ok: false, reason: 'license_not_recorded' })
  })

  it('fails closed (does not throw) when the study metadata fetch itself rejects', async () => {
    fetchMovebankStudyMetaMock.mockRejectedValue(new Error('Movebank HTTP 500'))
    const { client, recorder } = makeMockSupabase({ licenseAcceptanceExists: false })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankStudyMeta: fetchMovebankStudyMetaMock }
    })
    vi.resetModules()

    const { ensureLicenseRecordedForStudy } = await import('./jobRunner')
    const result = await ensureLicenseRecordedForStudy('123')

    expect(recorder.calls.find(c => c.method === 'movebank_license_acceptances.upsert')).toBeUndefined()
    expect(result).toEqual({ ok: false, reason: 'license_not_recorded' })
  })

  it('fails closed when the insert itself errors', async () => {
    fetchMovebankStudyMetaMock.mockResolvedValue({
      timestampFirstDeployedLocation: '', timestampLastDeployedLocation: '', numberOfDeployedLocations: '',
      sensorTypeIds: '', taxonIds: '', numberOfIndividuals: '', licenseTerms: 'You may use this data for...',
    })
    const { client } = makeMockSupabase({ licenseAcceptanceExists: false })
    const originalFrom = client.from
    const patchedFrom = (table: string) => {
      if (table === 'movebank_license_acceptances') {
        return {
          select: function () { return this },
          eq: function () { return this },
          limit: function () { return this },
          maybeSingle: async () => ({ data: null }),
          upsert: () => ({ then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ error: { message: 'duplicate key' } }).then(onFulfilled) }),
        }
      }
      return originalFrom(table)
    }
    client.from = patchedFrom as unknown as typeof client.from
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return { ...actual, fetchMovebankStudyMeta: fetchMovebankStudyMetaMock }
    })
    vi.resetModules()

    const { ensureLicenseRecordedForStudy } = await import('./jobRunner')
    const result = await ensureLicenseRecordedForStudy('123')

    expect(result).toEqual({ ok: false, reason: 'license_not_recorded' })
  })
})

// --- Integration: real movebankCollarFetch (fetch-level mock only), so the
// actual serialize()/rate-limit choke point runs for real. ---
describe('runOneJob integration (truncation split + no-overlap guarantee)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'testpass'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('../movebankCollarFetch')
    vi.resetModules()
  })

  function fakeCsvResponse(body: string) {
    const bytes = new TextEncoder().encode(body)
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close() } })
    return {
      ok: true, status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      body: stream,
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response
  }

  it('splits a truncated window into two queued jobs and writes no aggregate', async () => {
    const job = {
      id: 'job-1', objective_id: 'obj-1', species_taxon_key: 'elk.bull', role: 'primary' as const,
      study_id: 123, geo_hash: '9xyz5', local_tz: 'America/Denver',
      window_start: '2019-10-01T00:00:00.000Z', window_end: '2019-10-16T00:00:00.000Z',
      split_depth: 0, status: 'running', attempts: 1, max_attempts: 3,
      run_after: '2019-10-01T00:00:00.000Z', locked_until: null, last_error: null,
    }
    const { client, recorder } = makeMockSupabase({
      rpcResult: { data: job, error: null },
      licenseAcceptanceExists: true, // skip the metadata fetch for this test
      catalogRow: { license_type: 'CC_0', taxon_ids: 'Cervus elaphus', citation: 'Test (2020)' },
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))

    // MAX_RESPONSE_BYTES (20MB) isn't practical to actually exceed in a unit
    // test, so this verifies the split-and-requeue plumbing by mocking
    // movebankCollarFetch to report truncated:true directly — the exact
    // contract jobRunner.ts depends on, regardless of which cap tripped it.
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return {
        ...actual,
        fetchMovebankEventsForWindow: vi.fn().mockResolvedValue({ events: [], handshake: 'not_required', truncated: true }),
      }
    })
    vi.resetModules()

    const { runOneJob } = await import('./jobRunner')
    const result = await runOneJob()

    expect(result.status).toBe('done') // parent is "done with split", not dead or failed
    const splitUpsert = recorder.calls.find(c => c.method === 'collar_jobs.upsert')
    expect(splitUpsert?.args[0]).toHaveLength(2)
    const [first, second] = splitUpsert!.args[0] as Array<{ split_depth: number; window_start: string; window_end: string }>
    expect(first.split_depth).toBe(1)
    expect(second.split_depth).toBe(1)
    expect(first.window_end).toBe(second.window_start) // contiguous halves
    expect(recorder.calls.find(c => c.method === 'collar_study_aggregates.upsert')).toBeUndefined()
  })

  it('never has more than one Movebank request in flight at a time', async () => {
    const job = {
      id: 'job-1', objective_id: 'obj-1', species_taxon_key: 'elk.bull', role: 'primary' as const,
      study_id: 123, geo_hash: '9xyz5', local_tz: 'America/Denver',
      window_start: '2019-10-01T00:00:00.000Z', window_end: '2019-10-16T00:00:00.000Z',
      split_depth: 0, status: 'running', attempts: 1, max_attempts: 3,
      run_after: '2019-10-01T00:00:00.000Z', locked_until: null, last_error: null,
    }
    const { client } = makeMockSupabase({
      rpcResult: { data: job, error: null },
      licenseAcceptanceExists: false, // forces a study-metadata fetch BEFORE the event fetch
      catalogRow: { license_type: 'CC_0', taxon_ids: 'Cervus elaphus', citation: '' },
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
    vi.resetModules()

    let inFlight = 0
    let maxInFlight = 0
    fetchMock.mockImplementation(async (url: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 5)) // hold the "connection" open briefly
      inFlight--
      // The study-metadata call must report real license_terms so the A5
      // fail-closed check passes and processing actually reaches the event
      // fetch — otherwise this test would only ever see 1 real call.
      if (url.includes('entity_type=study')) {
        return fakeCsvResponse(
          'timestamp_first_deployed_location,timestamp_last_deployed_location,number_of_deployed_locations,sensor_type_ids,taxon_ids,number_of_individuals,license_terms\n'
          + '2019-01-01,2020-05-16,1000,GPS,Cervus elaphus,2695,"You may use this data for..."\n'
        )
      }
      return fakeCsvResponse('individual_id,timestamp,location_lat,location_long,individual_taxon_canonical_name\n')
    })

    const { runOneJob } = await import('./jobRunner')
    await runOneJob()

    // Metadata fetch + event fetch both hit the real movebankRequest choke
    // point (serialize()) — this proves they never overlapped.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(maxInFlight).toBe(1)
  })

  it('A5 fail-closed: requeues (not dead) when license recording fails, and never fetches events', async () => {
    const job = {
      id: 'job-1', objective_id: 'obj-1', species_taxon_key: 'elk.bull', role: 'primary' as const,
      study_id: 123, geo_hash: '9xyz5', local_tz: 'America/Denver',
      window_start: '2019-10-01T00:00:00.000Z', window_end: '2019-10-16T00:00:00.000Z',
      split_depth: 0, status: 'running', attempts: 1, max_attempts: 3,
      run_after: '2019-10-01T00:00:00.000Z', locked_until: null, last_error: null,
    }
    const { client, recorder } = makeMockSupabase({
      rpcResult: { data: job, error: null },
      licenseAcceptanceExists: false, // forces an attempt to record the license before any event fetch
      catalogRow: { license_type: 'CC_0', taxon_ids: 'Cervus elaphus', citation: '' },
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))

    const fetchEventsMock = vi.fn()
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return {
        ...actual,
        fetchMovebankStudyMeta: vi.fn().mockRejectedValue(new Error('Movebank HTTP 500')),
        fetchMovebankEventsForWindow: fetchEventsMock,
      }
    })
    vi.resetModules()

    const { runOneJob } = await import('./jobRunner')
    const result = await runOneJob()

    expect(result.status).toBe('requeued')
    expect(result.reason).toBe('license_not_recorded')
    expect(fetchEventsMock).not.toHaveBeenCalled()

    // requeueStaleJobs() (called first by runOneJob) also issues a
    // collar_jobs.update — the one under test here is the LAST one, written
    // by requeueWithBackoffOrDie after the license-recording failure.
    const updateCalls = recorder.calls.filter(c => c.method === 'collar_jobs.update')
    const update = updateCalls[updateCalls.length - 1]
    expect(update?.args[0]).toMatchObject({ status: 'queued', last_error: 'license_not_recorded' })
    expect(update?.args[0]).toHaveProperty('run_after')
  })

  it('A5 fail-closed: marks the job dead once attempts reach max_attempts, still without fetching events', async () => {
    const job = {
      id: 'job-1', objective_id: 'obj-1', species_taxon_key: 'elk.bull', role: 'primary' as const,
      study_id: 123, geo_hash: '9xyz5', local_tz: 'America/Denver',
      window_start: '2019-10-01T00:00:00.000Z', window_end: '2019-10-16T00:00:00.000Z',
      split_depth: 0, status: 'running', attempts: 3, max_attempts: 3,
      run_after: '2019-10-01T00:00:00.000Z', locked_until: null, last_error: null,
    }
    const { client, recorder } = makeMockSupabase({
      rpcResult: { data: job, error: null },
      licenseAcceptanceExists: false,
      catalogRow: { license_type: 'CC_0', taxon_ids: 'Cervus elaphus', citation: '' },
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))

    const fetchEventsMock = vi.fn()
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return {
        ...actual,
        fetchMovebankStudyMeta: vi.fn().mockRejectedValue(new Error('Movebank HTTP 500')),
        fetchMovebankEventsForWindow: fetchEventsMock,
      }
    })
    vi.resetModules()

    const { runOneJob } = await import('./jobRunner')
    await runOneJob()

    expect(fetchEventsMock).not.toHaveBeenCalled()
    const updateCalls = recorder.calls.filter(c => c.method === 'collar_jobs.update')
    const update = updateCalls[updateCalls.length - 1]
    expect(update?.args[0]).toMatchObject({ status: 'dead', last_error: 'license_not_recorded' })
  })

  it('writes stats (counts only, no raw rows/license text) to collar_jobs on a successful run', async () => {
    const job = {
      id: 'job-1', objective_id: 'obj-1', species_taxon_key: 'elk.bull', role: 'primary' as const,
      study_id: 123, geo_hash: '9xyz5', local_tz: 'America/Denver',
      window_start: '2019-10-01T00:00:00.000Z', window_end: '2019-10-16T00:00:00.000Z',
      split_depth: 0, status: 'running', attempts: 1, max_attempts: 3,
      run_after: '2019-10-01T00:00:00.000Z', locked_until: null, last_error: null,
    }
    const { client, recorder } = makeMockSupabase({
      rpcResult: { data: job, error: null },
      licenseAcceptanceExists: true, // skip the metadata fetch for this test
      catalogRow: { license_type: 'CC_0', taxon_ids: 'Cervus elaphus', citation: 'Test (2020)' },
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))

    // Decode the job's actual geo_hash so the "near" events land inside the
    // real 150km radius guard and the "far" one lands well outside it,
    // rather than guessing coordinates against an opaque geohash string.
    const { lat: objLat, lon: objLon } = decodeGeohash(job.geo_hash)
    const events = [
      { individualId: 'i1', timestamp: '2019-10-01 08:00:00', lat: objLat, lon: objLon, taxonCanonicalName: 'Cervus elaphus' },
      { individualId: 'i2', timestamp: '2019-10-02 08:00:00', lat: objLat, lon: objLon, taxonCanonicalName: 'Cervus elaphus' },
      { individualId: 'i3', timestamp: '2019-10-03 08:00:00', lat: objLat + 5, lon: objLon, taxonCanonicalName: 'Cervus elaphus' }, // ~555km north, well outside the 150km radius
    ]
    vi.doMock('../movebankCollarFetch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
      return {
        ...actual,
        fetchMovebankEventsForWindow: vi.fn().mockResolvedValue({ events, handshake: 'not_required', truncated: false }),
      }
    })
    vi.resetModules()

    const { runOneJob } = await import('./jobRunner')
    const result = await runOneJob()

    expect(result.status).toBe('done')
    const updateCalls = recorder.calls.filter(c => c.method === 'collar_jobs.update')
    const update = updateCalls[updateCalls.length - 1]
    const stats = (update?.args[0] as { stats: Record<string, unknown> }).stats
    expect(stats).toMatchObject({
      rows_fetched: 3,
      rows_species_match: 3,
      rows_in_radius: 2,
      truncated: false,
      handshake: 'not_required',
      top_taxon_names: [{ name: 'Cervus elaphus', count: 3 }],
    })
    expect(typeof stats.elapsed_ms).toBe('number')
    expect(JSON.stringify(stats)).not.toContain('license') // no raw license text ever stored here
  })
})
