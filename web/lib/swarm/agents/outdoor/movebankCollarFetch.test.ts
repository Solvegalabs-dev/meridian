import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { resolveMovebankTaxon, parseCsv, normalizeLicenseType, isCommercialSafeLicense } from './movebankCollarFetch'

describe('resolveMovebankTaxon (Fix 5 — single source of truth for species keys)', () => {
  it('resolves a fully-qualified elk taxonomy key', () => {
    expect(resolveMovebankTaxon('elk.bull.archery.HD316')).toEqual({
      scientificName: 'Cervus canadensis',
      speciesTaxonKey: 'elk.bull',
    })
  })

  it('resolves mule deer', () => {
    expect(resolveMovebankTaxon('deer.mule.archery')).toEqual({
      scientificName: 'Odocoileus hemionus',
      speciesTaxonKey: 'deer.mule',
    })
  })

  it('resolves single-segment species keys (moose, caribou, pronghorn)', () => {
    // These species have no sub-segment in their taxonomy_key, unlike elk/deer —
    // the old fallback (first two dot-segments) broke on 'moose.bull.x'.
    expect(resolveMovebankTaxon('moose.bull.x')).toEqual({
      scientificName: 'Alces alces',
      speciesTaxonKey: 'moose',
    })
    expect(resolveMovebankTaxon('caribou')).toEqual({
      scientificName: 'Rangifer tarandus',
      speciesTaxonKey: 'caribou',
    })
    expect(resolveMovebankTaxon('pronghorn')).toEqual({
      scientificName: 'Antilocapra americana',
      speciesTaxonKey: 'pronghorn',
    })
  })

  it('returns null for salmon (removed from this agent\'s scope — not GPS-collared)', () => {
    expect(resolveMovebankTaxon('salmon.king.river_migration')).toBeNull()
  })

  it('returns null for an unrecognized taxonomy key', () => {
    expect(resolveMovebankTaxon('trout.rainbow.fly_fishing')).toBeNull()
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
