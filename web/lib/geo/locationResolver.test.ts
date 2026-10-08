// FF-096b: the resolver keeps the nearest gauge's name and distance for the fishing spot row, and the
// snapshot-only field never reaches a profile column.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nearestGauge, readableGaugeName, resolveFullGeography, type FullGeography } from './locationResolver'
import { toProfileColumns } from './profileColumns'

vi.mock('@/lib/geo/nwsGridpoint', () => ({
  resolveNWSGridpoint: vi.fn(async () => ({
    gridOffice: 'SLC', gridX: 90, gridY: 130, zoneId: 'UTZ003', countyZoneId: 'UTC009', gridDataUrl: null,
  })),
}))
vi.mock('@/lib/geo/unitResolver', () => ({ findHuntUnit: vi.fn(async () => null) }))

// Two stream sites; the first is the nearest to the pin at 40.91, -109.40. The second row is the RDB format line.
const RDB = [
  '# USGS site service',
  ['agency_cd', 'site_no', 'station_nm', 'site_tp_cd', 'dec_lat_va', 'dec_long_va'].join('\t'),
  ['5s', '15s', '50s', '7s', '16s', '16s'].join('\t'),
  ['USGS', '09261000', 'GREEN RIVER NEAR JENSEN, UT', 'ST', '40.92', '-109.38'].join('\t'),
  ['USGS', '09229500', 'HENRYS FORK NEAR LONETREE, WY', 'ST', '41.05', '-109.9'].join('\t'),
  '',
].join('\n')

function stubFetch(rdb: string | null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const ok = (body: unknown, text?: string) => ({ ok: true, json: async () => body, text: async () => text ?? '' })
    if (url.includes('waterservices.usgs.gov')) return rdb === null ? { ok: false } : ok(null, rdb)
    if (url.includes('awdbRestApi')) return ok([])
    if (url.includes('epqs.nationalmap.gov')) return ok({ value: 4900 })
    if (url.includes('api.weather.gov/zones/county')) return ok({ properties: { name: 'Daggett' } })
    return { ok: false }
  }))
}

beforeEach(() => stubFetch(RDB))
afterEach(() => vi.unstubAllGlobals())

describe('resolveFullGeography: nearest gauge', () => {
  it('keeps the gauge ids as before and adds the nearest one with its name and distance', async () => {
    const geo = await resolveFullGeography(40.91, -109.4) as FullGeography
    // Both sites are within 50 mi, nearest first, exactly as before this change.
    expect(geo.usgs_gauge_ids).toEqual(['09261000', '09229500'])
    expect(geo.usgs_gauge_nearest).toMatchObject({ site_no: '09261000', name: 'Green River Near Jensen, UT' })
    expect(geo.usgs_gauge_nearest!.distance_mi).toBeGreaterThan(0.5)
    expect(geo.usgs_gauge_nearest!.distance_mi).toBeLessThan(3)
  })

  it('rounds the distance to one decimal', async () => {
    const geo = await resolveFullGeography(40.91, -109.4) as FullGeography
    const d = geo.usgs_gauge_nearest!.distance_mi
    expect(d).toBe(Math.round(d * 10) / 10)
  })

  it('has no nearest gauge when none is within range or the lookup fails, and still resolves the rest', async () => {
    stubFetch(null)
    const geo = await resolveFullGeography(40.91, -109.4) as FullGeography
    expect(geo.usgs_gauge_ids).toEqual([])
    expect(geo.usgs_gauge_nearest).toBeNull()
    expect(geo.nws_grid_office).toBe('SLC')
    expect(geo.county).toBe('Daggett')
  })

  it('has no nearest gauge when the site list has no name column', () => {
    expect(nearestGauge([{ id: '1', name: '', d: 2 }])).toBeNull()
    expect(nearestGauge([])).toBeNull()
  })
})

describe('readableGaugeName', () => {
  it('eases all-capitals site names and keeps the state code upper-case', () => {
    expect(readableGaugeName('GREEN RIVER NEAR GREENDALE, UT')).toBe('Green River Near Greendale, UT')
    expect(readableGaugeName('  PROVO RIVER AT HEBER, UT ')).toBe('Provo River At Heber, UT')
  })

  it('leaves a name that already has mixed case alone', () => {
    expect(readableGaugeName('Green River near Jensen, UT')).toBe('Green River near Jensen, UT')
    expect(readableGaugeName('')).toBe('')
  })
})

describe('toProfileColumns', () => {
  const geo: FullGeography = {
    nws_grid_office: 'SLC', nws_grid_x: 1, nws_grid_y: 2, nws_zone_id: 'UTZ003', state: 'UT', county: 'Daggett',
    usgs_gauge_ids: ['09261000'], snotel_station_ids: [], elevation_ft_avg: 4900, hunt_unit_id: null,
    usgs_gauge_nearest: { site_no: '09261000', name: 'Green River Near Jensen, UT', distance_mi: 1.4 },
  }

  it('drops the snapshot-only nearest gauge and keeps every real column', () => {
    const columns = toProfileColumns(geo)
    expect('usgs_gauge_nearest' in columns).toBe(false)
    expect(columns).toMatchObject({ nws_grid_office: 'SLC', usgs_gauge_ids: ['09261000'], county: 'Daggett', elevation_ft_avg: 4900 })
  })

  it('works on a snapshot saved before the field existed', () => {
    const { usgs_gauge_nearest: _omit, ...old } = geo
    void _omit
    expect(toProfileColumns(old)).toEqual(old)
  })
})
