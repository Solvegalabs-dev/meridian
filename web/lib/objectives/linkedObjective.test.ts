import { describe, it, expect } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { createLinkedObjective, nextObjNumber, objectiveTargetDate } from './linkedObjective'

const asDb = (d: FakeDb) => d as unknown as Parameters<typeof createLinkedObjective>[0]

describe('helpers', () => {
  it('takes the target date only from a plain YYYY-MM-DD trip_end', () => {
    expect(objectiveTargetDate({ trip_end: '2026-11-15' })).toBe('2026-11-15')
    expect(objectiveTargetDate({ trip_end: 'next fall' })).toBeNull()
    expect(objectiveTargetDate({})).toBeNull()
  })

  it('numbers after the highest existing OBJ-NN and ignores gaps', () => {
    expect(nextObjNumber([])).toBe('OBJ-01')
    expect(nextObjNumber(['OBJ-02', 'OBJ-09', null, 'junk'])).toBe('OBJ-10')
  })
})

describe('createLinkedObjective', () => {
  it('creates the objectives row and links the profile to it', async () => {
    const db = new FakeDb({
      objectives: [{ id: 'o-existing', user_id: 'user-1', obj_id: 'OBJ-03' }],
      objective_profiles: [],
    })

    const out = await createLinkedObjective(asDb(db), {
      ownerUserId: 'user-1',
      taxonomyKey: 'elk.bull.archery',
      huntCode: 'EA2004',
      timing: { trip_end: '2026-11-15' },
      profile: { org_source: 'strike', taxonomy_key: 'elk.bull.archery', status: 'active', state: 'UT' },
    })

    const obj = db.tables.objectives.find(o => o.id === out.objectiveId)!
    expect(obj).toMatchObject({
      user_id: 'user-1',
      obj_id: 'OBJ-04',
      title: 'EA2004 bull elk (Utah)',
      category: 'personal',
      status: 'active',
      target_date: '2026-11-15',
      objective_type: 'elk.bull.archery',
    })

    const profile = db.tables.objective_profiles[0]
    expect(profile.id).toBe(out.profileId)
    expect(profile.objective_id).toBe(out.objectiveId)
    expect(profile.user_id).toBe('user-1')
    expect(out.objId).toBe('OBJ-04')
  })

  it('titles a fishing objective from the water body and state, not the raw key', async () => {
    const db = new FakeDb({ objectives: [], objective_profiles: [] })
    await createLinkedObjective(asDb(db), {
      ownerUserId: 'user-1',
      taxonomyKey: 'trout.rainbow.fly_fishing',
      huntCode: null,
      timing: {},
      profile: { org_source: 'strike', geo: { state: 'ut', water_body: 'Green River', lat: 40.9, lon: -109.4 } },
    })
    const title = db.tables.objectives[0].title as string
    expect(title).toBe('Rainbow trout, fly fishing, Green River (Utah)')
    expect(title).not.toMatch(/\d\.\d/)
    expect(db.tables.objectives[0].outcome).toBe(`Complete the ${title} objective`)
  })

  it('rolls back the objectives row when the profile insert fails', async () => {
    const db = new FakeDb({ objectives: [], objective_profiles: [] })
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => table === 'objective_profiles'
      ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) }
      : realFrom(table)) as typeof db.from

    await expect(createLinkedObjective(asDb(db), {
      ownerUserId: 'user-1',
      taxonomyKey: 'elk.bull.archery',
      huntCode: null,
      timing: {},
      profile: {},
    })).rejects.toThrow('Could not create the objective profile')

    expect(db.tables.objectives).toHaveLength(0)
  })
})
