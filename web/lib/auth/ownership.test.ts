import { describe, it, expect } from 'vitest'
import { FakeDb } from '@/lib/spots/testDb'
import { ObjectiveAccessError, requireObjectiveAccess, requirePartnerObjective } from './ownership'

function db() {
  return new FakeDb({
    objective_profiles: [
      { id: 'prof-1', objective_id: 'arc-1', user_id: 'user-1', partner_id: null },
      { id: 'prof-2', objective_id: 'arc-2', user_id: 'user-2', partner_id: null },
      { id: 'prof-3', objective_id: 'arc-3', user_id: 'svc-bm', partner_id: 'partner-bm', partner_user_ref: 'cust-1' },
      { id: 'prof-4', objective_id: 'arc-4', user_id: 'svc-other', partner_id: 'partner-other' },
    ],
  })
}

// Cast: FakeDb implements the slice of the Supabase client these helpers use.
const asDb = (d: FakeDb) => d as unknown as Parameters<typeof requireObjectiveAccess>[0]

describe('requireObjectiveAccess (session door)', () => {
  it('returns the row for the owner, by profile PK', async () => {
    const row = await requireObjectiveAccess(asDb(db()), 'user-1', 'prof-1')
    expect(row.id).toBe('prof-1')
  })

  it('returns the row for the owner, by arc objective_id', async () => {
    const row = await requireObjectiveAccess(asDb(db()), 'user-1', 'arc-1')
    expect(row.id).toBe('prof-1')
  })

  it('another user gets a 404 for a PK, not a 403', async () => {
    const err = await requireObjectiveAccess(asDb(db()), 'user-1', 'prof-2').catch(e => e)
    expect(err).toBeInstanceOf(ObjectiveAccessError)
    expect(err.status).toBe(404)
  })

  it('another user gets a 404 for an arc id', async () => {
    await expect(requireObjectiveAccess(asDb(db()), 'user-1', 'arc-2')).rejects.toBeInstanceOf(ObjectiveAccessError)
  })

  it('an unknown id is a 404, the same as someone else\'s id', async () => {
    await expect(requireObjectiveAccess(asDb(db()), 'user-1', 'missing')).rejects.toBeInstanceOf(ObjectiveAccessError)
  })

  it('an empty user id never matches', async () => {
    await expect(requireObjectiveAccess(asDb(db()), '', 'prof-1')).rejects.toBeInstanceOf(ObjectiveAccessError)
  })

  it('a partner-owned profile is not readable by a session user', async () => {
    await expect(requireObjectiveAccess(asDb(db()), 'svc-bm', 'prof-3')).resolves.toMatchObject({ id: 'prof-3' })
    await expect(requireObjectiveAccess(asDb(db()), 'user-1', 'prof-3')).rejects.toBeInstanceOf(ObjectiveAccessError)
  })
})

describe('requirePartnerObjective (partner door)', () => {
  it('returns the row when the profile belongs to the partner', async () => {
    const row = await requirePartnerObjective(asDb(db()), 'partner-bm', 'arc-3')
    expect(row.partner_user_ref).toBe('cust-1')
  })

  it('a different partner gets a 404', async () => {
    await expect(requirePartnerObjective(asDb(db()), 'partner-bm', 'prof-4')).rejects.toBeInstanceOf(ObjectiveAccessError)
  })

  it('a session-created profile (no partner) is a 404 for every partner', async () => {
    await expect(requirePartnerObjective(asDb(db()), 'partner-bm', 'prof-1')).rejects.toBeInstanceOf(ObjectiveAccessError)
  })
})
