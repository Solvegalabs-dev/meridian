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

  it('direct study_id mode skips catalog discovery entirely', async () => {
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
    expect(fetchMovebankEventsDetailedMock).toHaveBeenCalledWith('999', 'CC_BY')
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
  })
})
