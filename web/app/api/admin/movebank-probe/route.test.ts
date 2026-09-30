import { describe, it, expect, beforeEach, vi } from 'vitest'

const { fetchMovebankStudiesDetailedMock, fetchMovebankEventsDetailedMock } = vi.hoisted(() => ({
  fetchMovebankStudiesDetailedMock: vi.fn(),
  fetchMovebankEventsDetailedMock: vi.fn(),
}))

vi.mock('@/lib/swarm/agents/outdoor/movebankCollarFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/swarm/agents/outdoor/movebankCollarFetch')>()
  return {
    ...actual,
    fetchMovebankStudiesDetailed: fetchMovebankStudiesDetailedMock,
    fetchMovebankEventsDetailed: fetchMovebankEventsDetailedMock,
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

  it('discovery mode reports raw_row_count, response_bytes, truncated, taxon_sample, and species_probe', async () => {
    const rawRows = [
      { id: '1', name: 'Elk Study', main_location_lat: '40.5', main_location_long: '-110.0', number_of_individuals: '10', taxon_ids: 'Cervus canadensis', license_type: 'CC_0', citation: 'Elk et al.', i_have_download_access: 'true' },
      { id: '2', name: 'Deer Study', main_location_lat: '41.0', main_location_long: '-111.0', number_of_individuals: '5', taxon_ids: 'Odocoileus hemionus', license_type: 'CC_BY', citation: 'Deer et al.', i_have_download_access: 'true' },
      { id: '3', name: 'No-taxon Study', main_location_lat: '39.0', main_location_long: '-109.0', number_of_individuals: '2', taxon_ids: '', license_type: 'CUSTOM', citation: '', i_have_download_access: 'true' },
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
      raw_row_count: 3,
      total_studies: 3,
      response_bytes: 1234,
      truncated: false,
      species_match_count: 1,
    })
    expect(body.taxon_sample.empty_taxon_ids_count).toBe(1)
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
})
