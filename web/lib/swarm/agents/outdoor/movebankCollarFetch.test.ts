import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { resolveMovebankTaxon, taxonMatchesAny, parseCsv, normalizeLicenseType, isCommercialSafeLicense } from './movebankCollarFetch'

// Controlled Supabase spy for the whole file — lets the "record" gating
// tests assert whether a database write happened, and keeps the earlier
// handshake tests from hitting a real (env-less) Supabase client and
// swallowing errors silently.
const { upsertSpy, fromSpy } = vi.hoisted(() => {
  const upsertSpy = vi.fn(async () => ({ error: null }))
  const fromSpy = vi.fn(() => ({ upsert: upsertSpy }))
  return { upsertSpy, fromSpy }
})

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: fromSpy }),
}))

describe('resolveMovebankTaxon (Fix 5 — single source of truth for species keys)', () => {
  it('resolves a fully-qualified elk taxonomy key to BOTH acceptable Movebank names', () => {
    // The live catalog tags elk studies as "Cervus elaphus", not just the
    // North American "Cervus canadensis" originally assumed — a species can
    // have more than one acceptable name, but still one speciesTaxonKey.
    expect(resolveMovebankTaxon('elk.bull.archery.HD316')).toEqual({
      scientificNames: ['Cervus elaphus', 'Cervus canadensis'],
      speciesTaxonKey: 'elk.bull',
    })
  })

  it('resolves mule deer', () => {
    expect(resolveMovebankTaxon('deer.mule.archery')).toEqual({
      scientificNames: ['Odocoileus hemionus'],
      speciesTaxonKey: 'deer.mule',
    })
  })

  it('resolves single-segment species keys (moose, caribou, pronghorn)', () => {
    // These species have no sub-segment in their taxonomy_key, unlike elk/deer —
    // the old fallback (first two dot-segments) broke on 'moose.bull.x'.
    expect(resolveMovebankTaxon('moose.bull.x')).toEqual({
      scientificNames: ['Alces alces'],
      speciesTaxonKey: 'moose',
    })
    expect(resolveMovebankTaxon('caribou')).toEqual({
      scientificNames: ['Rangifer tarandus'],
      speciesTaxonKey: 'caribou',
    })
    expect(resolveMovebankTaxon('pronghorn')).toEqual({
      scientificNames: ['Antilocapra americana'],
      speciesTaxonKey: 'pronghorn',
    })
  })

  it('returns null for salmon (removed from this agent\'s scope — not GPS-collared)', () => {
    expect(resolveMovebankTaxon('salmon.king.river_migration')).toBeNull()
  })

  it('returns null for an unrecognized taxonomy key', () => {
    expect(resolveMovebankTaxon('trout.rainbow.fly_fishing')).toBeNull()
  })

  it('keeps whitetail deer independently resolvable, never merged with elk/mule-deer', () => {
    // No cross-species "analog" substitution exists anywhere in this module —
    // whitetail resolves to its own name/key and nothing else references it.
    expect(resolveMovebankTaxon('deer.whitetail.archery')).toEqual({
      scientificNames: ['Odocoileus virginianus'],
      speciesTaxonKey: 'deer.whitetail',
    })
  })
})

describe('taxonMatchesAny (addendum 3 — multi-name species matching)', () => {
  it('matches when taxon_ids contains any one of several acceptable names', () => {
    expect(taxonMatchesAny('Cervus elaphus', ['Cervus elaphus', 'Cervus canadensis'])).toBe(true)
    expect(taxonMatchesAny('Cervus canadensis', ['Cervus elaphus', 'Cervus canadensis'])).toBe(true)
  })

  it('matches a name alongside other comma-joined taxon_ids values', () => {
    expect(taxonMatchesAny('Odocoileus hemionus,Cervus elaphus', ['Cervus elaphus', 'Cervus canadensis'])).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(taxonMatchesAny('cervus elaphus', ['Cervus elaphus', 'Cervus canadensis'])).toBe(true)
  })

  it('does not match on partial/substring overlap — segments must match exactly', () => {
    expect(taxonMatchesAny('Cervus elaphus nelsoni', ['Cervus elaphus'])).toBe(false)
  })

  it('returns false when none of the names are present', () => {
    expect(taxonMatchesAny('Odocoileus hemionus', ['Cervus elaphus', 'Cervus canadensis'])).toBe(false)
  })
})

describe('parseCsv (Fix 6c — RFC 4180 parsing)', () => {
  it('splits a simple unquoted CSV', () => {
    const rows = parseCsv('id,name\n1,Elk Study\n2,Deer Study\n', 100)
    expect(rows).toEqual([
      { id: '1', name: 'Elk Study' },
      { id: '2', name: 'Deer Study' },
    ])
  })

  it('handles quoted fields containing commas', () => {
    const csv = 'id,name,citation\n1,"Elk Study, Utah Herd","Smith, J. (2020). Elk movement."\n'
    const rows = parseCsv(csv, 100)
    expect(rows).toEqual([
      { id: '1', name: 'Elk Study, Utah Herd', citation: 'Smith, J. (2020). Elk movement.' },
    ])
  })

  it('handles escaped double-quotes inside quoted fields', () => {
    const csv = 'id,name\n1,"The ""Big Horn"" Study"\n'
    const rows = parseCsv(csv, 100)
    expect(rows).toEqual([{ id: '1', name: 'The "Big Horn" Study' }])
  })

  it('handles multi-value cells (Movebank taxon_ids/sensor_type_ids style)', () => {
    const csv = 'id,taxon_ids\n1,"Cervus canadensis,Odocoileus hemionus"\n'
    const rows = parseCsv(csv, 100)
    expect(rows[0].taxon_ids).toBe('Cervus canadensis,Odocoileus hemionus')
  })

  it('returns an empty array for a header-only or empty response', () => {
    expect(parseCsv('id,name\n', 100)).toEqual([])
    expect(parseCsv('', 100)).toEqual([])
  })
})

describe('normalizeLicenseType / isCommercialSafeLicense (Fix 3 — addendum)', () => {
  it.each([
    ['CC_0', true], ['CC-0', true], ['cc_0', true], ['CC 0', true],
    ['CC_BY', true], ['CC-BY', true], ['cc_by', true], ['CC BY', true],
  ])('%s is commercial-safe', (raw, expected) => {
    expect(isCommercialSafeLicense(raw)).toBe(expected)
  })

  it.each([
    ['CC_BY_NC', false],
    ['CC-BY-NC', false],
    ['CC_BY_ND', false],
    ['CC_BY_SA', false],
    ['CC_BY_NC_SA', false],
    ['CUSTOM', false],
    ['', false],
  ])('%s is NOT commercial-safe', (raw, expected) => {
    expect(isCommercialSafeLicense(raw)).toBe(expected)
  })

  it('normalizes separators and case consistently', () => {
    expect(normalizeLicenseType('cc-by')).toBe('CC_BY')
    expect(normalizeLicenseType('CC BY')).toBe('CC_BY')
    expect(normalizeLicenseType('  cc_by  ')).toBe('CC_BY')
  })
})

// --- License handshake (addendum Fix 1) ---
// Constructs a real ReadableStream-backed Response-like object so the
// module's own byte-capped reader (readBodyCapped) is exercised genuinely,
// not bypassed.
function fakeResponse(opts: { status?: number; headers?: Record<string, string>; setCookies?: string[]; body: string }) {
  const bodyBytes = new TextEncoder().encode(opts.body)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bodyBytes)
      controller.close()
    },
  })
  const headerEntries = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: {
      get: (k: string) => headerEntries.get(k.toLowerCase()) ?? null,
      getSetCookie: () => opts.setCookies ?? [],
    },
    body: stream,
    arrayBuffer: async () => bodyBytes.buffer,
  } as unknown as Response
}

const LICENSE_HTML = '<html>You may only download it if you agree with the terms listed below.</html>'
const NONCOMMERCIAL_LICENSE_HTML = '<html>Terms: NonCommercial use only.</html>'
const CSV_DATA = 'individual_id,timestamp,location_lat,location_long\nind-1,2026-06-15 07:00:00.000,40.5,-110.0\n'

describe('movebankRequest license handshake (addendum Fix 1)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'testpass'
    upsertSpy.mockClear()
    fromSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts the license once, hashes the exact bytes, carries the cookie, and retries exactly once', async () => {
    const expectedMd5 = createHash('md5').update(Buffer.from(new TextEncoder().encode(LICENSE_HTML))).digest('hex')

    fetchMock
      .mockResolvedValueOnce(fakeResponse({
        headers: { 'accept-license': 'true' },
        setCookies: ['JSESSIONID=abc123; Path=/; HttpOnly'],
        body: LICENSE_HTML,
      }))
      .mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsDetailed('999', 'CC_BY')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.handshake).toBe('accepted')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].individualId).toBe('ind-1')

    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }]
    expect(secondUrl).toContain(`license-md5=${expectedMd5}`)
    expect(secondInit.headers.Cookie).toBe('JSESSIONID=abc123')
    // Never a bare re-encoded string — the exact response bytes were hashed.
    expect(secondUrl).not.toContain(encodeURIComponent(LICENSE_HTML))
  })

  it('throws "license handshake rejected" if the retry still demands a license', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')

    await expect(fetchMovebankEventsDetailed('999', 'CC_BY')).rejects.toThrow('license handshake rejected')
    expect(fetchMock).toHaveBeenCalledTimes(2) // exactly one retry attempt, not a retry loop
  })

  it('aborts without retrying when the license text mentions NonCommercial terms', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: NONCOMMERCIAL_LICENSE_HTML }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsDetailed('999', 'CC_BY')

    expect(fetchMock).toHaveBeenCalledTimes(1) // no retry — use of the study was aborted
    expect(result.handshake).toBe('aborted_noncommercial')
    expect(result.events).toEqual([])
  })

  it('never logs credentials, cookies, or the Authorization header', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: NONCOMMERCIAL_LICENSE_HTML }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    await fetchMovebankEventsDetailed('999', 'CC_BY')

    const loggedText = warnSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(loggedText).not.toContain('testuser')
    expect(loggedText).not.toContain('testpass')
    expect(loggedText).not.toContain(NONCOMMERCIAL_LICENSE_HTML)
    warnSpy.mockRestore()
  })

  it('skips the handshake entirely for a normal (CC_0) response', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsDetailed('999', 'CC_0')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.handshake).toBe('not_required')
    expect(result.events).toHaveLength(1)
  })
})

describe('license acceptance recording gated by the `record` flag (probe safety)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'testpass'
    upsertSpy.mockClear()
    fromSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes no Supabase call when record=false, even on an accepted handshake', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))
      .mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsDetailed('999', 'CC_BY', false)

    expect(result.handshake).toBe('accepted') // the handshake itself still ran
    expect(fromSpy).not.toHaveBeenCalled()
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('calls Supabase to record the acceptance when record=true', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))
      .mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsDetailed('999', 'CC_BY', true)

    expect(result.handshake).toBe('accepted')
    expect(fromSpy).toHaveBeenCalledWith('movebank_license_acceptances')
    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })

  it('defaults to record=true when the flag is omitted, so the production extractor is unaffected', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))
      .mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    await fetchMovebankEventsDetailed('999', 'CC_BY') // no 3rd argument

    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })

  it('never calls Supabase for a NonCommercial-aborted study, regardless of record', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: NONCOMMERCIAL_LICENSE_HTML }))

    const { fetchMovebankEventsDetailed } = await import('./movebankCollarFetch')
    await fetchMovebankEventsDetailed('999', 'CC_BY', true)

    expect(fromSpy).not.toHaveBeenCalled()
  })
})

describe('STUDY_QUERY_PARAM_NAMES (addendum 4 item 4 — catalog determinism)', () => {
  it('reports the exact parameter names the study catalog request uses', async () => {
    const { STUDY_QUERY_PARAM_NAMES } = await import('./movebankCollarFetch')
    expect(STUDY_QUERY_PARAM_NAMES).toEqual(['entity_type', 'i_have_download_access', 'attributes'])
  })
})

describe('fetchMovebankIndividuals / fetchMovebankStudyMeta / fetchMovebankEventsVariant (addendum 4)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'testpass'
    upsertSpy.mockClear()
    fromSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('batch1c: fetchMovebankIndividuals uses taxon_canonical_name (study-level entity, not individual_taxon_canonical_name)', async () => {
    // Batch1c: entity_type=individual uses `taxon_canonical_name`, not
    // `individual_taxon_canonical_name` (which is an EVENT attribute and causes
    // a 5xx on the individuals endpoint — confirmed live Oct 6 2026).
    const csv = 'id,local_identifier,taxon_canonical_name\n1,E1,Cervus elaphus\n2,E2,Odocoileus hemionus\n'
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: csv }))

    const { fetchMovebankIndividuals } = await import('./movebankCollarFetch')
    const result = await fetchMovebankIndividuals('999', 'CC_0')

    expect(result).toEqual([
      { id: '1', localIdentifier: 'E1', taxonCanonicalName: 'Cervus elaphus' },
      { id: '2', localIdentifier: 'E2', taxonCanonicalName: 'Odocoileus hemionus' },
    ])
    expect(fetchMock.mock.calls[0][0]).toContain('entity_type=individual')
    expect(fetchMock.mock.calls[0][0]).toContain('study_id=999')
    // Must request taxon_canonical_name, not individual_taxon_canonical_name.
    expect(fetchMock.mock.calls[0][0]).toContain('taxon_canonical_name')
    expect(fetchMock.mock.calls[0][0]).not.toContain('individual_taxon_canonical_name')
  })

  it('fetchMovebankIndividuals never records a license acceptance itself', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))
      .mockResolvedValueOnce(fakeResponse({ body: 'id,local_identifier,taxon_canonical_name\n1,E1,Cervus elaphus\n' }))

    const { fetchMovebankIndividuals } = await import('./movebankCollarFetch')
    await fetchMovebankIndividuals('999', 'CC_BY')

    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('fetchMovebankStudyMeta requests the diagnostic attributes (incl. license_terms) and no names/citation', async () => {
    const csv = 'timestamp_first_deployed_location,timestamp_last_deployed_location,number_of_deployed_locations,sensor_type_ids,taxon_ids,number_of_individuals,license_terms\n'
      + '2018-01-01,2025-01-01,5000,GPS,Cervus elaphus,50,"You may use this data for..."\n'
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: csv }))

    const { fetchMovebankStudyMeta } = await import('./movebankCollarFetch')
    const meta = await fetchMovebankStudyMeta('999')

    expect(meta).toEqual({
      timestampFirstDeployedLocation: '2018-01-01',
      timestampLastDeployedLocation: '2025-01-01',
      numberOfDeployedLocations: '5000',
      sensorTypeIds: 'GPS',
      taxonIds: 'Cervus elaphus',
      numberOfIndividuals: '50',
      licenseTerms: 'You may use this data for...',
    })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('entity_type=study&study_id=999')
    expect(url).toContain('license_terms')
    expect(url).not.toContain('name')
    expect(url).not.toContain('citation')
  })

  it('fetchMovebankStudyMeta returns null for an empty/not-found response', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'timestamp_first_deployed_location\n' }))
    const { fetchMovebankStudyMeta } = await import('./movebankCollarFetch')
    expect(await fetchMovebankStudyMeta('999')).toBeNull()
  })

  it('fetchMovebankEventsVariant reports header column names and line count, never rows', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsVariant } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsVariant('999', { sensorFilter: true, timestampStart: true, maxBytes: 2 * 1024 * 1024 })

    expect(result.http_ok).toBe(true)
    expect(result.header_columns).toEqual(['individual_id', 'timestamp', 'location_lat', 'location_long'])
    expect(result.data_line_count).toBe(1)
    expect(result.access_denied_message).toBe(false)
    expect(JSON.stringify(result)).not.toContain('ind-1') // no raw row data anywhere in the diagnostic result

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('sensor_type_id=653')
    expect(url).toContain('timestamp_start=')
  })

  it('fetchMovebankEventsVariant omits filters when the variant asks for none, and filters by individual_local_identifier (not individual_id, per the docs)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsVariant } = await import('./movebankCollarFetch')
    await fetchMovebankEventsVariant('999', { sensorFilter: false, timestampStart: false, individualLocalIdentifier: 'E1', maxBytes: 2 * 1024 * 1024 })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('sensor_type_id=')
    expect(url).not.toContain('timestamp_start=')
    expect(url).toContain('individual_local_identifier=E1')
  })

  it('fetchMovebankEventsVariant reports truncated=true when the byte cap is hit', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: CSV_DATA }))

    const { fetchMovebankEventsVariant } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsVariant('999', { sensorFilter: false, timestampStart: false, maxBytes: 10 })

    expect(result.truncated).toBe(true)
  })

  it('fetchMovebankEventsVariant reports http_ok=false on a request failure, without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const { fetchMovebankEventsVariant } = await import('./movebankCollarFetch')
    const result = await fetchMovebankEventsVariant('999', { sensorFilter: false, timestampStart: false, maxBytes: 2 * 1024 * 1024 })

    expect(result.http_ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('probeStudyAttribute (fix round item 3 — bisect diagnostics, HTTP class only)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'testpass'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports ok:true, http_status_class 2xx on a successful single-attribute request', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'id\n999\n' }))

    const { probeStudyAttribute } = await import('./movebankCollarFetch')
    const result = await probeStudyAttribute('999', 'id')

    expect(result).toMatchObject({ ok: true, http_status_class: '2xx' })
    expect(typeof result.elapsed_ms).toBe('number')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('entity_type=study&study_id=999')
    expect(url).toContain('attributes=id')
  })

  it('classifies a 4xx failure without throwing or including the response body', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 404, body: 'not found' }))

    const { probeStudyAttribute } = await import('./movebankCollarFetch')
    const result = await probeStudyAttribute('999', 'bogus_attribute_name')

    expect(result).toMatchObject({ ok: false, http_status_class: '4xx' })
    expect(JSON.stringify(result)).not.toContain('not found')
  })

  it('classifies a 5xx failure', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 503, body: 'service unavailable' }))

    const { probeStudyAttribute } = await import('./movebankCollarFetch')
    const result = await probeStudyAttribute('999', 'license_terms')

    expect(result).toMatchObject({ ok: false, http_status_class: '5xx' })
  })

  it('never records a license acceptance, even if the account somehow demands the handshake for a metadata call', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ headers: { 'accept-license': 'true' }, body: LICENSE_HTML }))
      .mockResolvedValueOnce(fakeResponse({ body: 'id\n999\n' }))

    const { probeStudyAttribute } = await import('./movebankCollarFetch')
    const result = await probeStudyAttribute('999', 'id')

    expect(result.ok).toBe(true)
    expect(fromSpy).not.toHaveBeenCalled() // no `context` passed to movebankRequest — never recorded
  })

  it('applies shape A (i_have_download_access=true, study_id kept) to the request URL', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'taxon_ids\nCervus elaphus\n' }))

    const { probeStudyAttribute, STUDY_PARAM_SHAPES } = await import('./movebankCollarFetch')
    await probeStudyAttribute('999', 'taxon_ids', STUDY_PARAM_SHAPES.A)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('entity_type=study&study_id=999')
    expect(url).toContain('i_have_download_access=true')
    expect(url).not.toContain('&id=999')
  })

  it('applies shape B (id= instead of study_id=, no download-access param) to the request URL', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'taxon_ids\nCervus elaphus\n' }))

    const { probeStudyAttribute, STUDY_PARAM_SHAPES } = await import('./movebankCollarFetch')
    await probeStudyAttribute('999', 'taxon_ids', STUDY_PARAM_SHAPES.B)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('entity_type=study&id=999')
    expect(url).not.toContain('study_id=999')
    expect(url).not.toContain('i_have_download_access')
  })

  it('applies shape C (id= AND i_have_download_access=true) to the request URL', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'taxon_ids\nCervus elaphus\n' }))

    const { probeStudyAttribute, STUDY_PARAM_SHAPES } = await import('./movebankCollarFetch')
    await probeStudyAttribute('999', 'taxon_ids', STUDY_PARAM_SHAPES.C)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('entity_type=study&id=999')
    expect(url).not.toContain('study_id=999')
    expect(url).toContain('i_have_download_access=true')
  })

  it('without a shape argument, the request is byte-for-byte identical to the pre-existing default (no regression for bisect=study_meta)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'id\n999\n' }))

    const { probeStudyAttribute } = await import('./movebankCollarFetch')
    await probeStudyAttribute('999', 'id')

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://www.movebank.org/movebank/service/direct-read?entity_type=study&study_id=999&attributes=id')
  })
})

describe('fetchMovebankEventsForWindow sensor filter toggle (fix round item 3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'testpass'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes sensor_type_id by default (sensorFilter defaults true — production behavior unchanged)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'individual_id,timestamp,location_lat,location_long,individual_taxon_canonical_name\n' }))

    const { fetchMovebankEventsForWindow } = await import('./movebankCollarFetch')
    await fetchMovebankEventsForWindow('999', new Date('2019-10-01T00:00:00Z'), new Date('2019-10-16T00:00:00Z'), 'CC_0', false)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('sensor_type_id=653')
  })

  it('omits sensor_type_id when sensorFilter is explicitly false', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: 'individual_id,timestamp,location_lat,location_long,individual_taxon_canonical_name\n' }))

    const { fetchMovebankEventsForWindow } = await import('./movebankCollarFetch')
    await fetchMovebankEventsForWindow('999', new Date('2019-10-01T00:00:00Z'), new Date('2019-10-16T00:00:00Z'), 'CC_0', false, false)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('sensor_type_id=')
  })
})
