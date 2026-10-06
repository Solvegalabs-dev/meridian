// FF-092 Part 2: the Strike page is server-rendered. These tests call it directly and check the access gate.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import StrikePage from './page'

let db: FakeDb
let sessionUser: { id: string } | null = null

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}))
vi.mock('@/components/strike/StrikeBriefClient', () => ({ default: () => null }))
vi.mock('@/components/strike/LastHuntBrief', () => ({ default: () => null }))
vi.mock('@/lib/swarm/agents/outdoor/collarCalibration', () => ({
  getCollarBriefAugmentation: vi.fn(async () => ({ windows: [] })),
}))
vi.mock('@/lib/objectives/objectiveWindow', () => ({ loadObjectiveWindow: vi.fn(async () => null) }))

beforeEach(() => {
  sessionUser = null
  db = new FakeDb({
    objective_profiles: [
      { id: 'prof-1', objective_id: 'arc-1', user_id: 'user-1', taxonomy_key: 'elk.bull.archery', status: 'active', lat: 40.5, lon: -111.2 },
    ],
    objectives: [{ id: 'arc-1', user_id: 'user-1', title: 'Elk hunt' }],
    strike_briefs: [],
  })
})

describe('Strike page access', () => {
  it('the owner renders the page', async () => {
    sessionUser = { id: 'user-1' }
    await expect(StrikePage({ params: { id: 'prof-1' } })).resolves.toBeTruthy()
  })

  it('the owner can open it by arc objective_id too', async () => {
    sessionUser = { id: 'user-1' }
    await expect(StrikePage({ params: { id: 'arc-1' } })).resolves.toBeTruthy()
  })

  it('another signed-in user gets notFound for the same id', async () => {
    sessionUser = { id: 'user-2' }
    await expect(StrikePage({ params: { id: 'prof-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(StrikePage({ params: { id: 'arc-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('no session gets notFound, not the objective', async () => {
    await expect(StrikePage({ params: { id: 'prof-1' } })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
