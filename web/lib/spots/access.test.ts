import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireObjectiveOwner, spotErrorResponse } from './access'
import { SpotError } from './applySpot'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
const createClientMock = vi.mocked(createClient)

// User-scoped client: the caller is user-1, and objectives are scoped by user_id.
function userClient(objectives: Array<{ id: string; user_id: string }>, user: { id: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => {
      const filters: Array<(o: { id: string; user_id: string }) => boolean> = []
      const q = {
        select: () => q,
        eq: (col: 'id' | 'user_id', val: string) => { filters.push(o => o[col] === val); return q },
        maybeSingle: async () => ({ data: objectives.find(o => filters.every(f => f(o))) ?? null, error: null }),
      }
      return q
    },
  }
}

beforeEach(() => {
  createClientMock.mockReset()
})

describe('requireObjectiveOwner', () => {
  it('no session is 401', async () => {
    createClientMock.mockReturnValue(userClient([], null) as never)
    const res = await requireObjectiveOwner('obj-1')
    expect(res).toBeInstanceOf(NextResponse)
    expect((res as NextResponse).status).toBe(401)
  })

  it("another user's objective returns 404, not the data", async () => {
    createClientMock.mockReturnValue(userClient([{ id: 'obj-1', user_id: 'user-2' }], { id: 'user-1' }) as never)
    const res = await requireObjectiveOwner('obj-1')
    expect(res).toBeInstanceOf(NextResponse)
    expect((res as NextResponse).status).toBe(404)
  })

  it('the owner gets through', async () => {
    createClientMock.mockReturnValue(userClient([{ id: 'obj-1', user_id: 'user-1' }], { id: 'user-1' }) as never)
    const res = await requireObjectiveOwner('obj-1')
    expect(res).toEqual({ userId: 'user-1', objectiveId: 'obj-1' })
  })
})

describe('spotErrorResponse', () => {
  it('a SpotError keeps its status and extra fields', async () => {
    const res = spotErrorResponse(new SpotError('Spot limit reached.', 403, { code: 'spot_limit_reached', limit: 3 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Spot limit reached.', code: 'spot_limit_reached', limit: 3 })
  })

  it('an unexpected error becomes a generic 500 with no detail', async () => {
    const res = spotErrorResponse(new Error('db exploded at 40.9,-111.3'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/40\.9|db exploded/)
  })
})
