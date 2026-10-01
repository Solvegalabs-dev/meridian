import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  fetchMovebankStudiesDetailedMock,
  fetchMovebankEventsDetailedMock,
  fetchMovebankStudyMetaMock,
  fetchMovebankIndividualsMock,
  fetchMovebankEventsVariantMock,
  fetchMovebankEventsForWindowMock,
  probeStudyAttributeMock,
} = vi.hoisted(() => ({
  fetchMovebankStudiesDetailedMock: vi.fn(),
  fetchMovebankEventsDetailedMock: vi.fn(),
  fetchMovebankStudyMetaMock: vi.fn(),
  fetchMovebankIndividualsMock: vi.fn(),
  fetchMovebankEventsVariantMock: vi.fn(),
  fetchMovebankEventsForWindowMock: vi.fn(),
  probeStudyAttributeMock: vi.fn(),
}))

vi.mock('@/lib/swarm/agents/outdoor/movebankCollarFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/swarm/agents/outdoor/movebankCollarFetch')>()
  return {
    ...actual,
    fetchMovebankStudiesDetailed: fetchMovebankStudiesDetailedMock,
    fetchMovebankEventsDetailed: fetchMovebankEventsDetailedMock,
    fetchMovebankStudyMeta: fetchMovebankStudyMetaMock,
    fetchMovebankIndividuals: fetchMovebankIndividualsMock,
    fetchMovebankEventsVariant: fetchMovebankEventsVariantMock,
    fetchMovebankEventsForWindow: fetchMovebankEventsForWindowMock,
    probeStudyAttribute: probeStudyAttributeMock,
  }
})

import { GET } from './route'

describe('GET /api/admin/movebank-probe', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.MOVEBANK_USERNAME = 'testuser'
    process.env.MOVEBANK_PASSWORD = 'super-secret-password'
    fetchMovebankStudiesDetailedMock.mockReset()
    fetchMovebankEventsDetailedMock.mockReset()
    fetchMovebankStudyMetaMock.mockReset().mockResolvedValue({
      timestampFirstDeployedLocation: '2018-01-01', timestampLastDeployedLocation: '2025-01-01',
      numberOfDeployedLocations: '5000', sensorTypeIds: 'GPS', taxonIds: 'Cervus elaphus', numberOfIndividuals: '10',
    })
    fetchMovebankIndividualsMock.mockReset().mockResolvedValue([])
    fetchMovebankEventsVariantMock.mockReset().mockResolvedValue({
      http_ok: true, response_bytes: 100, truncated: false, data_line_count: 0,
      access_denied_message: false, header_columns: [], handshake: 'not_required', elapsed_ms: 5,
    })
    fetchMovebankEventsForWindowMock.mockReset()
    probeStudyAttributeMock.mockReset()
  })

  it('returns 401 with no Authorization header, and never leaks the password', async () => {
    const req = new Request('https://example.com/api/admin/movebank-probe')
    const res = await GET(req)
    const bodyText = await res.text()

    expect(res.status).toBe(401)
    expect(JSON.parse(bodyText)).toEqual({ error: 'Unauthorized' })
    expect(bodyText).not.toContain('super-secret-password')
    expect(bodyText).not.toContain('testuser')
  })

  it('returns 401 with an incorrect bearer token', async () => {
    const req = new Request('https://example.com/api/admin/movebank-probe', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('direct study_id mode skips catalog discovery entirely and defaults to record=false', async () => {
    fetchMovebankEventsDetailedMock.mockResolvedValue({
      events: [{ individualId: 'ind-1', timestamp: '2026-06-15 07:00:00.000', lat: 40.5, lon: -110.0 }],
      handshake: 'accepted',
    })

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?study_id=999&license_type=CC_BY',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(fetchMovebankStudiesDetailedMock).not.toHaveBeenCalled()
    // A diagnostic probe run must make zero database writes by default — the
    // `record` flag threaded down to fetchMovebankEventsDetailed is what
    // gates the actual Supabase write (verified at the unit level in
    // movebankCollarFetch.test.ts, since this file mocks that module out).
    expect(fetchMovebankEventsDetailedMock).toHaveBeenCalledWith('999', 'CC_BY', false)
    expect(body.record).toBe(false)
    expect(body.mode).toBe('direct_study')
    expect(body.study_probe).toMatchObject({
      study_id: '999',
      license_type: 'CC_BY',
      commercial_safe: true,
      handshake_result: 'accepted',
      rows_returned: 1,
      distinct_individuals: 1,
    })
  })

  it('passes record=true through only when explicitly requested', async () => {
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [], handshake: 'not_required' })

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?study_id=999&record=true',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(fetchMovebankEventsDetailedMock).toHaveBeenCalledWith('999', undefined, true)
    expect(body.record).toBe(true)
  })

  it('direct study_id mode output contains no raw event rows', async () => {
    fetchMovebankEventsDetailedMock.mockResolvedValue({
      events: [
        { individualId: 'ind-1', timestamp: '2026-06-15 07:00:00.000', lat: 40.5, lon: -110.0 },
        { individualId: 'ind-2', timestamp: '2026-06-15 08:00:00.000', lat: 40.6, lon: -110.1 },
      ],
      handshake: 'accepted',
    })

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?study_id=999&license_type=CC_BY',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const bodyText = await res.text()

    // Aggregate counts (rows_returned: 2) are fine; the individual fixes
    // themselves (ids, per-point lat/lon) must never appear.
    expect(bodyText).not.toContain('ind-1')
    expect(bodyText).not.toContain('ind-2')
    expect(bodyText).not.toContain('40.6')
    expect(bodyText).not.toContain('-110.1')
  })

  it('addendum 4 item 1: direct study_id mode returns study_meta + 4 event variants + individuals counts', async () => {
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [], handshake: 'accepted' })
    fetchMovebankIndividualsMock.mockResolvedValue([
      { id: '1', localIdentifier: 'E1', taxonCanonicalName: 'Cervus elaphus' },
      { id: '2', localIdentifier: 'D1', taxonCanonicalName: 'Odocoileus hemionus' },
    ])

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?study_id=7364502758&license_type=CC_0&species=elk',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.diagnostics.study_meta).toMatchObject({ sensorTypeIds: 'GPS', numberOfIndividuals: '10' })
    expect(body.diagnostics.individuals_total).toBe(2)
    expect(body.diagnostics.individuals_matching_species).toBe(1) // only the Cervus elaphus individual

    const variants = body.diagnostics.variants
    expect(Object.keys(variants)).toEqual([
      'a_sensor_filter_and_timestamp_start_current',
      'b_sensor_filter_no_timestamp_start',
      'c_no_sensor_filter_with_timestamp_start',
      'd_no_filters_single_individual',
    ])
    // Variant (a) mirrors production exactly: sensor filter + timestamp_start, full production byte cap.
    expect(fetchMovebankEventsVariantMock).toHaveBeenNthCalledWith(
      1, '7364502758', { sensorFilter: true, timestampStart: true, maxBytes: 20 * 1024 * 1024 }, 'CC_0'
    )
    // Variant (d) uses the documented individual_local_identifier filter (not individual_id), from the first individual.
    expect(fetchMovebankEventsVariantMock).toHaveBeenNthCalledWith(
      4, '7364502758', { sensorFilter: false, timestampStart: false, individualLocalIdentifier: 'E1', maxBytes: 2 * 1024 * 1024 }, 'CC_0'
    )

    const bodyText = JSON.stringify(body)
    expect(bodyText).not.toContain('super-secret-password')
  })

  it('addendum 4 item 1: skips variant d and explains why when no individuals are available', async () => {
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [], handshake: 'not_required' })
    fetchMovebankIndividualsMock.mockRejectedValue(new Error('individuals endpoint down'))

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?study_id=999',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const body = await res.json()

    expect(body.diagnostics.individuals_error).toBe('individuals endpoint down')
    expect(body.diagnostics.individuals_total).toBe(0)
    expect(body.diagnostics.variants.d_no_filters_single_individual).toMatchObject({ skipped: true })
    expect(fetchMovebankEventsVariantMock).toHaveBeenCalledTimes(3) // a, b, c only — d never attempted
  })

  it('discovery mode reports raw_row_count, response_bytes, truncated, taxon_sample, and species_probe', async () => {
    const rawRows = [
      { id: '1', name: 'Elk Study', main_location_lat: '40.5', main_location_long: '-110.0', number_of_individuals: '10', taxon_ids: 'Cervus canadensis', license_type: 'CC_0', citation: 'Elk et al.', i_have_download_access: 'true' },
      { id: '2', name: 'Deer Study', main_location_lat: '41.0', main_location_long: '-111.0', number_of_individuals: '5', taxon_ids: 'Odocoileus hemionus', license_type: 'CC_BY', citation: 'Deer et al.', i_have_download_access: 'true' },
      { id: '3', name: 'No-taxon Study', main_location_lat: '39.0', main_location_long: '-109.0', number_of_individuals: '2', taxon_ids: '', license_type: 'CUSTOM', citation: '', i_have_download_access: 'true' },
      { id: '4', name: 'No-access Study', main_location_lat: '38.0', main_location_long: '-108.0', number_of_individuals: '1', taxon_ids: '', license_type: 'CC_0', citation: '', i_have_download_access: 'false' },
    ]
    const studies = rawRows.map(r => ({
      id: r.id, name: r.name,
      lat: parseFloat(r.main_location_lat), lon: parseFloat(r.main_location_long),
      numberOfIndividuals: parseInt(r.number_of_individuals, 10),
      taxonIds: r.taxon_ids, licenseType: r.license_type, citation: r.citation,
      hasDownloadAccess: true,
    }))
    fetchMovebankStudiesDetailedMock.mockResolvedValue({
      studies, rawRows, rawRowCount: rawRows.length, responseBytes: 1234, truncated: false,
    })
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [], handshake: 'not_required' })

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?species=elk&lat=40.5&lon=-110.0&limit=1',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.study_catalog).toMatchObject({
      request_params: ['entity_type', 'i_have_download_access', 'attributes'],
      raw_row_count: 4,
      total_studies: 4,
      has_download_access_count: 3,
      without_download_access_count: 1,
      response_bytes: 1234,
      truncated: false,
      species_match_count: 1,
    })
    expect(body.taxon_sample.empty_taxon_ids_count).toBe(2)
    expect(body.taxon_sample.top).toContainEqual({ taxon_ids: 'Cervus canadensis', count: 1 })

    const elkEntry = body.species_probe.find((e: { query: string }) => e.query === 'Cervus canadensis')
    expect(elkEntry.matching_studies).toBe(1)
    expect(elkEntry.within_500km).toBe(1)

    const cervusSubstring = body.species_probe.find((e: { query: string }) => e.query === 'cervus')
    expect(cervusSubstring.match_type).toBe('substring')
    expect(cervusSubstring.matching_studies).toBe(1)

    // Discovery-mode per-study probes must also default to record=false.
    expect(fetchMovebankEventsDetailedMock).toHaveBeenCalledWith('1', 'CC_0', false)

    // Study names ('Elk Study', 'Deer Study', ...) are real attribute data
    // pulled in for taxon/license aggregation — confirm they never surface
    // anywhere in the response, since only counts are meant to leave this
    // route (Fix: no raw event rows, license text, or study names beyond
    // aggregate data).
    const bodyText = JSON.stringify(body)
    expect(bodyText).not.toContain('Elk Study')
    expect(bodyText).not.toContain('Deer Study')
    expect(bodyText).not.toContain('No-taxon Study')
    expect(bodyText).not.toContain('Elk et al.')
    expect(bodyText).not.toContain('super-secret-password')
    expect(bodyText).not.toContain('testuser')
  })

  it('addendum 3: elk_family combines Cervus elaphus + Cervus canadensis, per-species nearest/eligibility fields are correct, whitetail stays unmerged', async () => {
    const row = (over: Partial<Record<string, string>>): Record<string, string> => ({
      id: '0', name: '', main_location_lat: '', main_location_long: '',
      number_of_individuals: '0', taxon_ids: '', license_type: '', citation: '',
      i_have_download_access: 'true', ...over,
    })

    const rawRows = [
      // Cervus elaphus, CC_0, at the query point exactly (0km) — eligible.
      row({ id: '1', name: 'A', main_location_lat: '40.5', main_location_long: '-110.0', number_of_individuals: '20', taxon_ids: 'Cervus elaphus', license_type: 'CC_0' }),
      // Cervus canadensis, CC_BY, ~100km away — eligible, and the OTHER elk name.
      row({ id: '2', name: 'B', main_location_lat: '41.0', main_location_long: '-110.5', number_of_individuals: '15', taxon_ids: 'Cervus canadensis', license_type: 'CC_BY' }),
      // Cervus elaphus, CUSTOM license, ~50km away — within 500km but NOT eligible; must still appear in `nearest`, clearly marked.
      row({ id: '3', name: 'C', main_location_lat: '40.9', main_location_long: '-110.0', number_of_individuals: '8', taxon_ids: 'Cervus elaphus', license_type: 'CUSTOM' }),
      // Whitetail deer, CC_0, far away (~1600km) — simulates "0 studies within
      // 500km of Utah" for whitetail. Must remain its own species entry and
      // never be folded into elk_family or any elk/mule-deer grouping.
      row({ id: '4', name: 'D', main_location_lat: '25.0', main_location_long: '-100.0', number_of_individuals: '30', taxon_ids: 'Odocoileus virginianus', license_type: 'CC_0' }),
    ]
    const studies = rawRows.map(r => ({
      id: r.id, name: r.name,
      lat: parseFloat(r.main_location_lat), lon: parseFloat(r.main_location_long),
      numberOfIndividuals: parseInt(r.number_of_individuals, 10),
      taxonIds: r.taxon_ids, licenseType: r.license_type, citation: r.citation,
      hasDownloadAccess: true,
    }))
    fetchMovebankStudiesDetailedMock.mockResolvedValue({
      studies, rawRows, rawRowCount: rawRows.length, responseBytes: 999, truncated: false,
    })
    fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [], handshake: 'not_required' })

    const req = new Request(
      'https://example.com/api/admin/movebank-probe?species=elk&lat=40.5&lon=-110.0&limit=1',
      { headers: { Authorization: 'Bearer test-cron-secret' } }
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.scientific_names).toEqual(['Cervus elaphus', 'Cervus canadensis'])

    // elk_family: studies 1 + 2 (CC_0 and CC_BY) are eligible within 500km;
    // study 3 (CUSTOM) is excluded from the eligible count despite distance.
    expect(body.elk_family).toEqual({ eligible_within_500km: 2, eligible_within_1000km: 2 })

    const elaphusEntry = body.species_probe.find((e: { query: string }) => e.query === 'Cervus elaphus')
    expect(elaphusEntry.matching_studies).toBe(2) // studies 1 and 3 only — NOT study 2 (tagged canadensis, not elaphus)
    expect(elaphusEntry.eligible_within_500km).toBe(1) // only study 1 (CUSTOM study 3 excluded)
    expect(elaphusEntry.within_500km_by_license).toEqual({ CC_0: 1, CUSTOM: 1 })
    expect(elaphusEntry.nearest).toHaveLength(2)
    expect(elaphusEntry.nearest[0]).toMatchObject({ id: '1', license_type: 'CC_0', commercial_safe: true, distance_km: 0 })
    expect(elaphusEntry.nearest[1]).toMatchObject({ id: '3', license_type: 'CUSTOM', commercial_safe: false }) // included, clearly marked, not filtered out

    const whitetailEntry = body.species_probe.find((e: { query: string }) => e.query === 'Odocoileus virginianus')
    expect(whitetailEntry.matching_studies).toBe(1) // still resolvable as its own species
    expect(whitetailEntry.within_500km).toBe(0)      // but 0 studies within 500km of this (Utah) point
    expect(whitetailEntry.eligible_within_500km).toBe(0)

    // No study names, citations, or contact info anywhere in the response —
    // only the ids/license/distance/individual-count aggregate fields.
    const bodyText = JSON.stringify(body)
    expect(bodyText).not.toMatch(/"name":"[A-D]"/)
  })

  describe('fix round item 3: bisect=study_meta', () => {
    it('requires a study_id', async () => {
      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/study_id/)
      expect(probeStudyAttributeMock).not.toHaveBeenCalled()
    })

    it('reports the baseline (attributes=id) failure and skips per-attribute bisection when it fails', async () => {
      probeStudyAttributeMock.mockResolvedValue({ ok: false, http_status_class: '4xx', elapsed_ms: 12 })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta&study_id=999',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.mode).toBe('bisect_study_meta')
      expect(probeStudyAttributeMock).toHaveBeenCalledTimes(1) // baseline only — never bisects further
      expect(probeStudyAttributeMock).toHaveBeenCalledWith('999', 'id')
      expect(body.baseline).toEqual({ ok: false, http_status_class: '4xx', elapsed_ms: 12 })
      expect(body.note).toMatch(/how this study is identified/)
      expect(body.attributes).toBeUndefined()
    })

    it('bisects all 7 study-meta attributes serially after a successful baseline, reporting HTTP class only', async () => {
      probeStudyAttributeMock.mockImplementation(async (_studyId: string, attributes: string) => {
        if (attributes === 'license_terms') return { ok: false, http_status_class: '5xx', elapsed_ms: 20 }
        return { ok: true, http_status_class: '2xx', elapsed_ms: 10 }
      })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta&study_id=7364502758',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.baseline).toMatchObject({ ok: true })
      // baseline (1) + 7 study-meta attributes, each called alone.
      expect(probeStudyAttributeMock).toHaveBeenCalledTimes(8)
      expect(Object.keys(body.attributes)).toEqual([
        'timestamp_first_deployed_location', 'timestamp_last_deployed_location',
        'number_of_deployed_locations', 'sensor_type_ids', 'taxon_ids',
        'number_of_individuals', 'license_terms',
      ])
      expect(body.attributes.taxon_ids).toEqual({ ok: true, http_status_class: '2xx', elapsed_ms: 10 })
      expect(body.attributes.license_terms).toEqual({ ok: false, http_status_class: '5xx', elapsed_ms: 20 })

      // Never a response body, license text, or raw data — only ok/class/timing.
      const bodyText = JSON.stringify(body)
      expect(bodyText).not.toContain('super-secret-password')
      expect(bodyText).not.toContain('license_text')
    })
  })

  describe('fix round #2: bisect=study_meta_params', () => {
    it('requires a study_id', async () => {
      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta_params',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/study_id/)
      expect(probeStudyAttributeMock).not.toHaveBeenCalled()
    })

    it('tests shapes A, B, C serially with taxon_ids, and reports working_shape:null + stops when none work', async () => {
      probeStudyAttributeMock.mockResolvedValue({ ok: false, http_status_class: '5xx', elapsed_ms: 15 })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta_params&study_id=7364502758',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.mode).toBe('bisect_study_meta_params')
      // Exactly 3 calls (A, B, C), each with 'taxon_ids' — no license_terms call, since nothing worked.
      expect(probeStudyAttributeMock).toHaveBeenCalledTimes(3)
      expect(probeStudyAttributeMock).toHaveBeenNthCalledWith(1, '7364502758', 'taxon_ids', { idParam: 'study_id', includeDownloadAccess: true })
      expect(probeStudyAttributeMock).toHaveBeenNthCalledWith(2, '7364502758', 'taxon_ids', { idParam: 'id', includeDownloadAccess: false })
      expect(probeStudyAttributeMock).toHaveBeenNthCalledWith(3, '7364502758', 'taxon_ids', { idParam: 'id', includeDownloadAccess: true })
      expect(body.taxon_ids_by_shape).toEqual({
        A: { ok: false, http_status_class: '5xx', elapsed_ms: 15 },
        B: { ok: false, http_status_class: '5xx', elapsed_ms: 15 },
        C: { ok: false, http_status_class: '5xx', elapsed_ms: 15 },
      })
      expect(body.working_shape).toBeNull()
      expect(body.license_terms_result).toBeUndefined()
      expect(body.note).toMatch(/not what caused/)
    })

    it('tests all three shapes (A, B, C) even once A already works, picks A as working_shape, and retests license_terms under it', async () => {
      probeStudyAttributeMock.mockImplementation(async (_studyId: string, attributes: string) => {
        if (attributes === 'license_terms') return { ok: true, http_status_class: '2xx', elapsed_ms: 8 }
        return { ok: true, http_status_class: '2xx', elapsed_ms: 10 } // all three shapes happen to succeed
      })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta_params&study_id=999',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.working_shape).toBe('A') // first shape that worked, in A/B/C order
      // A, B, C always all tested (so Jason sees all 3 results), then one more call for license_terms under the winning shape (A).
      expect(probeStudyAttributeMock).toHaveBeenCalledTimes(4)
      expect(probeStudyAttributeMock).toHaveBeenNthCalledWith(4, '999', 'license_terms', { idParam: 'study_id', includeDownloadAccess: true })
      expect(body.taxon_ids_by_shape).toEqual({
        A: { ok: true, http_status_class: '2xx', elapsed_ms: 10 },
        B: { ok: true, http_status_class: '2xx', elapsed_ms: 10 },
        C: { ok: true, http_status_class: '2xx', elapsed_ms: 10 },
      })
      expect(body.license_terms_result).toEqual({ ok: true, http_status_class: '2xx', elapsed_ms: 8 })
      expect(body.note).toMatch(/Shape A worked/)
      expect(body.note).toMatch(/NOT been switched/)
    })

    it('picks shape B as working when A fails but B succeeds, and never reports a response body', async () => {
      probeStudyAttributeMock.mockImplementation(async (_studyId: string, attributes: string, shape?: { idParam: string }) => {
        if (attributes === 'license_terms') return { ok: true, http_status_class: '2xx', elapsed_ms: 9 }
        if (shape?.idParam === 'study_id') return { ok: false, http_status_class: '5xx', elapsed_ms: 11 } // shape A fails
        return { ok: true, http_status_class: '2xx', elapsed_ms: 12 } // shape B (and C) succeed
      })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?bisect=study_meta_params&study_id=999',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(body.working_shape).toBe('B')
      expect(body.taxon_ids_by_shape.A.ok).toBe(false)
      expect(body.taxon_ids_by_shape.B.ok).toBe(true)
      expect(probeStudyAttributeMock).toHaveBeenLastCalledWith('999', 'license_terms', { idParam: 'id', includeDownloadAccess: false })

      const bodyText = JSON.stringify(body)
      expect(bodyText).not.toContain('super-secret-password')
    })
  })

  describe('fix round item 3: windowed probe (window_start/window_end/sensor) in direct study_id mode', () => {
    beforeEach(() => {
      fetchMovebankEventsDetailedMock.mockResolvedValue({ events: [], handshake: 'not_required' })
    })

    it('reports per-stage counts and top taxon names, still gated by record=false by default', async () => {
      fetchMovebankEventsForWindowMock.mockResolvedValue({
        events: [
          { individualId: 'i1', timestamp: '2019-10-01 08:00:00', lat: 40.5, lon: -110.0, taxonCanonicalName: 'Cervus elaphus' },
          { individualId: 'i2', timestamp: '2019-10-02 08:00:00', lat: 40.5, lon: -110.0, taxonCanonicalName: 'Cervus elaphus' },
          { individualId: 'i3', timestamp: '2019-10-03 08:00:00', lat: 60.0, lon: -110.0, taxonCanonicalName: 'Cervus elaphus' }, // outside EVENT_RADIUS_KM of the default lat/lon
        ],
        handshake: 'not_required',
        truncated: false,
      })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?study_id=999&species=elk&window_start=2019-10-01T00:00:00Z&window_end=2019-10-16T00:00:00Z&sensor=0',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(fetchMovebankEventsForWindowMock).toHaveBeenCalledWith(
        '999', new Date('2019-10-01T00:00:00Z'), new Date('2019-10-16T00:00:00Z'), undefined, false, false
      )
      expect(body.windowed_probe).toMatchObject({
        sensor_filter: false,
        handshake: 'not_required',
        truncated: false,
        rows_fetched: 3,
        rows_species_match: 3,
        rows_in_radius: 2,
        top_taxon_names: [{ name: 'Cervus elaphus', count: 3 }],
      })

      const bodyText = JSON.stringify(body)
      expect(bodyText).not.toContain('"i1"')
      expect(bodyText).not.toContain('"i2"')
    })

    it('defaults sensor filter on when sensor param is omitted', async () => {
      fetchMovebankEventsForWindowMock.mockResolvedValue({ events: [], handshake: 'not_required', truncated: false })

      const req = new Request(
        'https://example.com/api/admin/movebank-probe?study_id=999&window_start=2019-10-01T00:00:00Z&window_end=2019-10-16T00:00:00Z',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      await GET(req)

      expect(fetchMovebankEventsForWindowMock).toHaveBeenCalledWith(
        '999', new Date('2019-10-01T00:00:00Z'), new Date('2019-10-16T00:00:00Z'), undefined, false, true
      )
    })

    it('reports an error for an invalid window_start/window_end instead of throwing', async () => {
      const req = new Request(
        'https://example.com/api/admin/movebank-probe?study_id=999&window_start=not-a-date&window_end=also-not-a-date',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.windowed_probe.error).toMatch(/valid date/)
      expect(fetchMovebankEventsForWindowMock).not.toHaveBeenCalled()
    })

    it('omits windowed_probe entirely when window_start/window_end are not provided', async () => {
      const req = new Request(
        'https://example.com/api/admin/movebank-probe?study_id=999',
        { headers: { Authorization: 'Bearer test-cron-secret' } }
      )
      const res = await GET(req)
      const body = await res.json()

      expect(body.windowed_probe).toBeUndefined()
      expect(fetchMovebankEventsForWindowMock).not.toHaveBeenCalled()
    })
  })
})
