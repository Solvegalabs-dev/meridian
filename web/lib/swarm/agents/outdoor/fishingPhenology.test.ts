// FF-100: the hatch score is computed from THIS objective's water temperature, only when a gauge near the spot read it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fakeSupabase'

const h = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.db }))

import { computeHatchWindow, hatchScoreFromTempC } from './fishingPhenology'

const NOW = new Date('2026-10-08T15:00:00Z')

function setup(row: Record<string, unknown> | null) {
  const db = fakeSupabase(() => ({ data: row }))
  h.db = db
  return db
}

const NEAR = { kind: 'gauge', site_no: '10152000', site_name: 'Provo River', distance_mi: 4.2 }

beforeEach(() => { h.db = null })

describe('computeHatchWindow', () => {
  it('uses this objective\'s own nearby-gauge water temperature and carries the gauge', async () => {
    const db = setup({ observed_value: 8.5, source_detail: NEAR, recorded_at: '2026-10-08T06:00:00Z' })
    const r = await computeHatchWindow('obj-1', NOW)
    expect(r?.value).toBeCloseTo(0.3333, 3)
    expect(r?.detail).toEqual({ kind: 'gauge', derived_from: 'OUTDOOR_USGS_WATER_TEMP', site_no: '10152000', site_name: 'Provo River', distance_mi: 4.2 })
    const filters = db.calls[0].filters
    expect(filters).toContainEqual(['objective_id', 'eq', 'obj-1'])
    expect(filters).toContainEqual(['agent_key', 'eq', 'OUTDOOR_USGS_WATER_TEMP'])
  })

  it('an old row from the fixed Alaska gauge (no source detail) gives no score', async () => {
    setup({ observed_value: 8.5, source_detail: null, recorded_at: '2026-10-08T06:00:00Z' })
    expect(await computeHatchWindow('obj-1', NOW)).toBeNull()
  })

  it('a distant gauge gives no score', async () => {
    setup({ observed_value: 8.5, source_detail: { ...NEAR, distance_mi: 40 }, recorded_at: '2026-10-08T06:00:00Z' })
    expect(await computeHatchWindow('obj-1', NOW)).toBeNull()
  })

  it('a water temperature older than 3 days gives no score', async () => {
    setup({ observed_value: 8.5, source_detail: NEAR, recorded_at: '2026-10-04T06:00:00Z' })
    expect(await computeHatchWindow('obj-1', NOW)).toBeNull()
  })

  it('no objective, or no reading, gives no score', async () => {
    setup(null)
    expect(await computeHatchWindow(undefined, NOW)).toBeNull()
    expect(await computeHatchWindow('obj-1', NOW)).toBeNull()
  })
})

describe('hatchScoreFromTempC', () => {
  it('is the fraction of species whose window holds the temperature', () => {
    expect(hatchScoreFromTempC(8.5)).toBeCloseTo(0.3333, 3) // BWO only
    expect(hatchScoreFromTempC(17)).toBeCloseTo(0.6667, 3) // PMD and PED
    expect(hatchScoreFromTempC(2)).toBe(0)
  })
})
