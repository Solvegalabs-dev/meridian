import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fetchMovebankStudiesDetailedMock } = vi.hoisted(() => ({
  fetchMovebankStudiesDetailedMock: vi.fn(),
}))

vi.mock('../movebankCollarFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../movebankCollarFetch')>()
  return { ...actual, fetchMovebankStudiesDetailed: fetchMovebankStudiesDetailedMock }
})

const upsertCalls: Array<Array<Record<string, unknown>>> = []
const { supabaseClient } = vi.hoisted(() => ({ supabaseClient: { current: null as unknown } }))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => supabaseClient.current,
}))

function makeCatalogClient(selectResult: unknown) {
  return {
    from: (table: string) => {
      if (table !== 'movebank_study_catalog') throw new Error(`unexpected table ${table}`)
      return {
        upsert: (rows: Array<Record<string, unknown>>) => {
          upsertCalls.push(rows)
          return Promise.resolve({ data: null, error: null })
        },
        select: () => Promise.resolve({ data: selectResult }),
      }
    },
  }
}

beforeEach(() => {
  fetchMovebankStudiesDetailedMock.mockReset()
  upsertCalls.length = 0
})

describe('refreshCatalog', () => {
  it('upserts studies in batches of 500', async () => {
    const studies = Array.from({ length: 1200 }, (_, i) => ({
      id: String(i), name: `Study ${i}`, lat: 40.5, lon: -110.0,
      numberOfIndividuals: 1, taxonIds: 'Cervus elaphus', licenseType: 'CC_0',
      citation: '', hasDownloadAccess: true,
      timestampFirstDeployedLocation: '2018-01-01', timestampLastDeployedLocation: '2025-01-01',
    }))
    fetchMovebankStudiesDetailedMock.mockResolvedValue({ studies, rawRowCount: 1200, responseBytes: 999, truncated: false })
    supabaseClient.current = makeCatalogClient([])

    const { refreshCatalog } = await import('./catalog')
    const result = await refreshCatalog()

    expect(result.studiesFetched).toBe(1200)
    expect(result.batchesUpserted).toBe(3) // 500 + 500 + 200
    expect(upsertCalls).toHaveLength(3)
    expect(upsertCalls[0]).toHaveLength(500)
    expect(upsertCalls[2]).toHaveLength(200)
    expect(upsertCalls[0][0]).toMatchObject({ study_id: 0, license_type: 'CC_0', has_download_access: true })
  })

  it('parses study timestamps into real dates for the catalog row', async () => {
    fetchMovebankStudiesDetailedMock.mockResolvedValue({
      studies: [{
        id: '1', name: 'A', lat: 40.5, lon: -110.0, numberOfIndividuals: 1,
        taxonIds: 'Cervus elaphus', licenseType: 'CC_0', citation: '', hasDownloadAccess: true,
        timestampFirstDeployedLocation: '2019-01-01', timestampLastDeployedLocation: '2020-05-16',
      }],
      rawRowCount: 1, responseBytes: 1, truncated: false,
    })
    supabaseClient.current = makeCatalogClient([])

    const { refreshCatalog } = await import('./catalog')
    await refreshCatalog()

    expect(upsertCalls[0][0].timestamp_first).toBe(new Date('2019-01-01T00:00:00Z').toISOString())
    expect(upsertCalls[0][0].timestamp_last).toBe(new Date('2020-05-16T00:00:00Z').toISOString())
  })
})

describe('getEligibleStudies', () => {
  const rows = [
    { study_id: 1, main_lat: 40.5, main_lon: -110.0, taxon_ids: 'Cervus elaphus', license_type: 'CC_0', number_of_individuals: 10, timestamp_first: '2019-01-01', timestamp_last: '2020-01-01' },
    { study_id: 2, main_lat: 41.0, main_lon: -110.5, taxon_ids: 'Odocoileus hemionus', license_type: 'CC_BY', number_of_individuals: 5, timestamp_first: null, timestamp_last: null },
    { study_id: 3, main_lat: 40.5, main_lon: -110.0, taxon_ids: 'Cervus elaphus', license_type: 'CUSTOM', number_of_individuals: 20, timestamp_first: null, timestamp_last: null }, // excluded — license
    { study_id: 4, main_lat: 60.0, main_lon: -150.0, taxon_ids: 'Cervus elaphus', license_type: 'CC_0', number_of_individuals: 1, timestamp_first: null, timestamp_last: null }, // excluded — too far
  ]

  it('filters by species, license allow-list, and radius; never calls Movebank', async () => {
    supabaseClient.current = makeCatalogClient(rows)

    const { getEligibleStudies } = await import('./catalog')
    const result = await getEligibleStudies(['Cervus elaphus', 'Cervus canadensis'], 40.5, -110.0, 500)

    expect(result.map(r => r.studyId)).toEqual(['1'])
    expect(fetchMovebankStudiesDetailedMock).not.toHaveBeenCalled()
  })

  it('sorts nearest-first, falling back to individual count', async () => {
    supabaseClient.current = makeCatalogClient([
      { study_id: 10, main_lat: 41.0, main_lon: -110.5, taxon_ids: 'Cervus elaphus', license_type: 'CC_0', number_of_individuals: 5, timestamp_first: null, timestamp_last: null },
      { study_id: 11, main_lat: 40.5, main_lon: -110.0, taxon_ids: 'Cervus elaphus', license_type: 'CC_0', number_of_individuals: 50, timestamp_first: null, timestamp_last: null },
    ])

    const { getEligibleStudies } = await import('./catalog')
    const result = await getEligibleStudies(['Cervus elaphus'], 40.5, -110.0, 500)

    expect(result.map(r => r.studyId)).toEqual(['11', '10']) // study 11 is exactly at the point (0km)
  })
})
