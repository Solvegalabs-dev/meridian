import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/lib/spots/testDb'
import { PATCH } from './route'

vi.mock('@/lib/spots/access', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/spots/access')>()
  return { ...real, requireObjectiveOwner: vi.fn(async (id: string) => ({ userId: 'user-1', objectiveId: id })) }
})

let db: FakeDb
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }))

const OBJ = 'obj-1'

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/objectives/${OBJ}/hunt-code`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  db = new FakeDb({
    objective_profiles: [{ objective_id: OBJ, state: null, hunt_code: null, taxonomy_key: 'elk.bull.archery', hunt_unit_id: null, lat: 40.5, lon: -111 }],
    objective_spots: [{ id: 's1', objective_id: OBJ, lat: 40.5, lon: -111, inside_boundary: null }],
    udwr_hunt_cache: [],
  })
})

afterEach(() => {
  delete process.env.UDWR_LOOKUP_ENABLED
  vi.unstubAllGlobals()
})

describe('PATCH /api/objectives/[id]/hunt-code', () => {
  it('lookup off (kill switch): manual entry still saves the number', async () => {
    process.env.UDWR_LOOKUP_ENABLED = 'false'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await PATCH(req({ code: 'ea2004' }), { params: { id: OBJ } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hunt_code).toBe('EA2004')
    expect(body.status).toBe('disabled')
    expect(db.tables.objective_profiles[0].hunt_code).toBe('EA2004')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a malformed number is rejected before anything is saved', async () => {
    const res = await PATCH(req({ code: 'EA20' }), { params: { id: OBJ } })
    expect(res.status).toBe(400)
    expect(db.tables.objective_profiles[0].hunt_code).toBeNull()
  })

  it('clearing the number sets it to null', async () => {
    db.tables.objective_profiles[0].hunt_code = 'EA2004'
    const res = await PATCH(req({ code: null }), { params: { id: OBJ } })
    expect(res.status).toBe(200)
    expect(db.tables.objective_profiles[0].hunt_code).toBeNull()
  })

  it('a failed lookup still saves the number and does not set state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down') }))
    const res = await PATCH(req({ code: 'EA2004' }), { params: { id: OBJ } })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('error')
    expect(db.tables.objective_profiles[0].hunt_code).toBe('EA2004')
    expect(db.tables.objective_profiles[0].state).toBeNull()
  })
})
