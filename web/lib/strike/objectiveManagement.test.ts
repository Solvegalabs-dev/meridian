import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDb } from '@/lib/spots/testDb'
import {
  archiveObjective,
  restoreObjective,
  updateObjective,
  validateObjectivePatch,
  ManagementError,
  REMOVED_REASON,
  type ManagedProfile,
} from './objectiveManagement'

const NOW = new Date('2026-10-08T15:00:00Z') // Oct 8 in Utah

let db: FakeDb
let touched: string[]
const asDb = () => db as unknown as SupabaseClient

function profileRow(over: Record<string, unknown> = {}) {
  return {
    id: 'prof-1', objective_id: 'arc-1', user_id: 'u1', org_source: 'strike', status: 'active',
    timing: { trip_start: '2026-10-01', trip_end: '2026-10-31', cadence: 'weekly' },
    taxonomy_key: 'trout.rainbow.fly_fishing', state: 'UT', lat: null, lon: null, hunt_unit_id: null,
    hunt_code: null, domain: 'fishing', ended_at: null, ended_reason: null, ...over,
  }
}

// Tables the Arc abandon flow writes to. Remove must never touch them.
const ABANDON_TABLES = ['objective_outcomes', 'objective_episodes', 'predictions', 'abandonment_patterns', 'confidence_scores']

beforeEach(() => {
  db = new FakeDb({
    objective_profiles: [profileRow()],
    objectives: [{ id: 'arc-1', user_id: 'u1', title: 'Rainbow trout', status: 'active', notes: null, target_date: '2026-10-31', archive_reason: null, archive_date: null }],
    campaign_units: [],
    hunt_seasons: [],
    objective_spots: [{ id: 's1', objective_id: 'arc-1', is_active: true }, { id: 's2', objective_id: 'arc-1', is_active: false }],
    objective_outcomes: [{ id: 'o1', objective_id: 'arc-1' }],
    objective_episodes: [{ id: 'e1', objective_id: 'arc-1' }],
    predictions: [{ id: 'p1', objective_id: 'arc-1' }],
    abandonment_patterns: [],
    strike_briefs: [{ id: 'b1', objective_id: 'arc-1', go_no_go: 'GO' }],
  })
  touched = []
  const realFrom = db.from.bind(db)
  db.from = ((table: string) => { touched.push(table); return realFrom(table) }) as typeof db.from
})

const profile = () => db.tables.objective_profiles[0] as unknown as ManagedProfile
const objective = () => db.tables.objectives[0]
const snapshot = (tables: string[]) => JSON.stringify(tables.map(t => db.tables[t]))

describe('archiveObjective', () => {
  it('sets both rows to archived with the reason and date, and nothing else', async () => {
    const result = await archiveObjective(asDb(), profile(), NOW)

    expect(result).toEqual({ status: 'archived', changed: true })
    expect(db.tables.objective_profiles[0].status).toBe('archived')
    expect(objective()).toMatchObject({ status: 'archived', archive_reason: REMOVED_REASON, archive_date: '2026-10-08' })
  })

  it('writes no outcome, episode, prediction or abandonment record, and deletes no spot, brief or run', async () => {
    const before = snapshot([...ABANDON_TABLES, 'objective_spots', 'strike_briefs'])
    await archiveObjective(asDb(), profile(), NOW)

    expect(snapshot([...ABANDON_TABLES, 'objective_spots', 'strike_briefs'])).toBe(before)
    // It does not even read the Arc abandon tables.
    expect(touched.filter(t => ABANDON_TABLES.includes(t))).toEqual([])
    expect(db.tables.objective_profiles).toHaveLength(1)
    expect(db.tables.objectives).toHaveLength(1)
  })

  it('is idempotent: a second remove changes nothing and keeps the first archive date', async () => {
    await archiveObjective(asDb(), profile(), NOW)
    const again = await archiveObjective(asDb(), profile(), new Date('2026-10-20T15:00:00Z'))

    expect(again).toEqual({ status: 'archived', changed: false })
    expect(objective().archive_date).toBe('2026-10-08')
  })

  it('repairs a half-finished remove: profile archived, objectives row still active', async () => {
    db.tables.objective_profiles[0].status = 'archived'
    await archiveObjective(asDb(), profile(), NOW)
    expect(objective()).toMatchObject({ status: 'archived', archive_reason: REMOVED_REASON })
  })

  it('refuses an objective that belongs to a campaign unit', async () => {
    db.tables.campaign_units.push({ id: 'cu1', objective_id: 'arc-1' })
    await expect(archiveObjective(asDb(), profile(), NOW)).rejects.toMatchObject({ status: 409, code: 'campaign_unit' })
    expect(db.tables.objective_profiles[0].status).toBe('active')
    expect(objective().status).toBe('active')
  })

  it('removes an unlinked profile (no objectives row) by its status alone', async () => {
    db.tables.objective_profiles[0].objective_id = null
    await archiveObjective(asDb(), profile(), NOW)
    expect(db.tables.objective_profiles[0].status).toBe('archived')
    expect(objective().status).toBe('active') // the other row is not this profile's
  })

  it('puts the profile back when the objectives write fails', async () => {
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => table === 'objectives'
      ? { update: () => ({ eq: async () => ({ error: { message: 'boom' } }) }) }
      : realFrom(table)) as typeof db.from

    await expect(archiveObjective(asDb(), profile(), NOW)).rejects.toBeInstanceOf(ManagementError)
    expect(db.tables.objective_profiles[0].status).toBe('active')
  })
})

describe('restoreObjective', () => {
  async function removed() {
    await archiveObjective(asDb(), profile(), NOW)
  }

  it('sets both rows back to active and clears the archive reason and date', async () => {
    await removed()
    const result = await restoreObjective(asDb(), profile(), NOW)

    expect(result).toEqual({ status: 'active', changed: true })
    expect(db.tables.objective_profiles[0].status).toBe('active')
    expect(objective()).toMatchObject({ status: 'active', archive_reason: null, archive_date: null })
  })

  it('refuses an objective whose trip window has ended, with a clear message, and changes nothing', async () => {
    db.tables.objective_profiles[0].timing = { trip_start: '2026-09-01', trip_end: '2026-09-15' }
    await removed()

    await expect(restoreObjective(asDb(), profile(), NOW)).rejects.toMatchObject({
      status: 409,
      code: 'window_ended',
      message: expect.stringContaining("can't be restored"),
    })
    expect(db.tables.objective_profiles[0].status).toBe('archived')
    expect(objective().status).toBe('archived')
  })

  it('leaves spots, and the one-active-spot rule, untouched', async () => {
    const spots = snapshot(['objective_spots'])
    await removed()
    await restoreObjective(asDb(), profile(), NOW)

    expect(snapshot(['objective_spots'])).toBe(spots)
    expect(db.tables.objective_spots.filter(s => s.is_active)).toHaveLength(1)
    expect(touched).not.toContain('objective_spots')
  })

  it('is idempotent and leaves a non-removed objective exactly as it is', async () => {
    const active = await restoreObjective(asDb(), profile(), NOW)
    expect(active).toEqual({ status: 'active', changed: false })

    db.tables.objective_profiles[0].status = 'completed'
    db.tables.objective_profiles[0].ended_at = '2026-09-16T00:00:00Z'
    const completed = await restoreObjective(asDb(), profile(), NOW)
    expect(completed).toEqual({ status: 'completed', changed: false })
    expect(db.tables.objective_profiles[0].status).toBe('completed')
  })

  it('puts the profile back to archived when the objectives write fails', async () => {
    await removed()
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => table === 'objectives'
      ? { update: () => ({ eq: async () => ({ error: { message: 'boom' } }) }) }
      : realFrom(table)) as typeof db.from

    await expect(restoreObjective(asDb(), profile(), NOW)).rejects.toBeInstanceOf(ManagementError)
    expect(db.tables.objective_profiles[0].status).toBe('archived')
  })
})

describe('validateObjectivePatch', () => {
  const ok = (body: Record<string, unknown>) => validateObjectivePatch(body, NOW)

  it('accepts a valid title, dates and note, trimming the text', () => {
    expect(ok({ title: '  Green  River   opener ', trip_start: '2026-10-10', trip_end: '2026-10-14', note: ' bring waders ' })).toEqual({
      ok: true,
      value: { title: 'Green River opener', trip_start: '2026-10-10', trip_end: '2026-10-14', note: 'bring waders' },
    })
  })

  it('title must be 1 to 120 characters', () => {
    expect(ok({ title: '' })).toMatchObject({ ok: false })
    expect(ok({ title: '   ' })).toMatchObject({ ok: false })
    expect(ok({ title: 'x'.repeat(121) })).toMatchObject({ ok: false })
    expect(ok({ title: 'x'.repeat(120) })).toMatchObject({ ok: true })
    expect(ok({ title: 42 })).toMatchObject({ ok: false })
  })

  it('dates must be plain, real YYYY-MM-DD calendar dates', () => {
    for (const bad of ['10/10/2026', '2026-1-5', '2026-02-30', '2026-10-10T00:00:00Z', 'soon', 20261010]) {
      expect(ok({ trip_start: bad })).toMatchObject({ ok: false })
    }
    expect(ok({ trip_start: '2026-02-28' })).toMatchObject({ ok: true })
  })

  it('null or an empty string clears a date, and a note', () => {
    expect(ok({ trip_end: null, note: '' })).toEqual({ ok: true, value: { trip_end: null, note: null } })
  })

  it('ignores every other field, and rejects a body with nothing to update', () => {
    expect(ok({ title: 'A', taxonomy_key: 'elk.bull.archery', state: 'MT', hunt_code: 'EA2004', user_id: 'x', status: 'archived' }))
      .toEqual({ ok: true, value: { title: 'A' } })
    expect(ok({ taxonomy_key: 'elk.bull.archery', state: 'MT' })).toEqual({ ok: false, error: 'Nothing to update.' })
    expect(ok({})).toMatchObject({ ok: false })
  })

  it('rejects a note over the limit', () => {
    expect(ok({ note: 'n'.repeat(1001) })).toMatchObject({ ok: false })
  })
})

describe('updateObjective', () => {
  it('writes only the whitelisted fields: title and note to objectives, dates to the profile timing', async () => {
    await updateObjective(asDb(), profile(), { title: 'Green River opener', note: 'bring waders', trip_start: '2026-10-05' }, NOW)

    expect(objective()).toMatchObject({ title: 'Green River opener', notes: 'bring waders' })
    expect((db.tables.objective_profiles[0].timing as Record<string, unknown>).trip_start).toBe('2026-10-05')
    // Nothing else on either row moved.
    expect(db.tables.objective_profiles[0]).toMatchObject({ taxonomy_key: 'trout.rainbow.fly_fishing', state: 'UT', hunt_code: null, status: 'active' })
    expect(objective()).toMatchObject({ status: 'active', user_id: 'u1' })
  })

  it('keeps every other timing key', async () => {
    await updateObjective(asDb(), profile(), { trip_end: '2026-11-05' }, NOW)
    expect(db.tables.objective_profiles[0].timing).toEqual({ trip_start: '2026-10-01', trip_end: '2026-11-05', cadence: 'weekly' })
  })

  it('moves objectives.target_date with the trip end, and clears it when the end is cleared', async () => {
    await updateObjective(asDb(), profile(), { trip_end: '2026-11-05' }, NOW)
    expect(objective().target_date).toBe('2026-11-05')

    await updateObjective(asDb(), profile(), { trip_end: null }, NOW)
    expect(objective().target_date).toBeNull()
    expect(db.tables.objective_profiles[0].timing).toEqual({ trip_start: '2026-10-01', cadence: 'weekly' })
  })

  it('leaves target_date alone when the trip end is not part of the edit', async () => {
    await updateObjective(asDb(), profile(), { title: 'New name' }, NOW)
    expect(objective().target_date).toBe('2026-10-31')
  })

  it('rejects an end before the start, judged against the saved date when only one is sent', async () => {
    await expect(updateObjective(asDb(), profile(), { trip_end: '2026-09-30' }, NOW)).rejects.toMatchObject({ status: 400, code: 'invalid_dates' })
    await expect(updateObjective(asDb(), profile(), { trip_start: '2026-11-15' }, NOW)).rejects.toMatchObject({ status: 400 })
    expect(db.tables.objective_profiles[0].timing).toEqual({ trip_start: '2026-10-01', trip_end: '2026-10-31', cadence: 'weekly' })
  })

  it('refuses to edit a removed objective', async () => {
    db.tables.objective_profiles[0].status = 'archived'
    await expect(updateObjective(asDb(), profile(), { title: 'x' }, NOW)).rejects.toMatchObject({ status: 409, code: 'archived' })
  })

  it('refuses a title or note for a profile with no objectives row, but still saves dates', async () => {
    db.tables.objective_profiles[0].objective_id = null
    await expect(updateObjective(asDb(), profile(), { title: 'x' }, NOW)).rejects.toMatchObject({ code: 'not_linked' })
    await updateObjective(asDb(), profile(), { trip_end: '2026-11-01' }, NOW)
    expect((db.tables.objective_profiles[0].timing as Record<string, unknown>).trip_end).toBe('2026-11-01')
  })

  it('puts the timing back when the objectives write fails', async () => {
    const realFrom = db.from.bind(db)
    db.from = ((table: string) => table === 'objectives'
      ? { update: () => ({ eq: async () => ({ error: { message: 'boom' } }) }) }
      : realFrom(table)) as typeof db.from

    await expect(updateObjective(asDb(), profile(), { trip_end: '2026-11-05' }, NOW)).rejects.toBeInstanceOf(ManagementError)
    expect((db.tables.objective_profiles[0].timing as Record<string, unknown>).trip_end).toBe('2026-10-31')
  })

  describe('moving the trip end into the future on a closed profile', () => {
    const ended = { trip_start: '2026-09-01', trip_end: '2026-09-15' }

    it('reactivates a profile the lifecycle completed (ended_at set)', async () => {
      db.tables.objective_profiles[0].timing = ended
      db.tables.objective_profiles[0].status = 'completed'
      db.tables.objective_profiles[0].ended_at = '2026-09-16T06:00:00Z'
      db.tables.objective_profiles[0].ended_reason = 'trip_ended'

      const result = await updateObjective(asDb(), profile(), { trip_end: '2026-11-15' }, NOW)

      expect(result.reactivated).toBe(true)
      expect(db.tables.objective_profiles[0]).toMatchObject({ status: 'active', ended_at: null, ended_reason: null })
    })

    it('does not reactivate when the new end is still in the past', async () => {
      db.tables.objective_profiles[0].timing = ended
      db.tables.objective_profiles[0].status = 'completed'
      db.tables.objective_profiles[0].ended_at = '2026-09-16T06:00:00Z'

      const result = await updateObjective(asDb(), profile(), { trip_end: '2026-09-20' }, NOW)
      expect(result.reactivated).toBe(false)
      expect(db.tables.objective_profiles[0].status).toBe('completed')
    })

    it('refuses to reopen a hand-completed profile (no ended_at), and leaves it completed', async () => {
      db.tables.objective_profiles[0].timing = ended
      db.tables.objective_profiles[0].status = 'completed'
      db.tables.objective_profiles[0].ended_at = null

      await expect(updateObjective(asDb(), profile(), { trip_end: '2026-11-15' }, NOW)).rejects.toMatchObject({ status: 409, code: 'closed_by_owner' })
      expect(db.tables.objective_profiles[0]).toMatchObject({ status: 'completed', timing: ended })
    })

    it('refuses to reopen a missed profile', async () => {
      db.tables.objective_profiles[0].timing = ended
      db.tables.objective_profiles[0].status = 'missed'
      await expect(updateObjective(asDb(), profile(), { trip_end: '2026-11-15' }, NOW)).rejects.toMatchObject({ code: 'closed_by_owner' })
      expect(db.tables.objective_profiles[0].status).toBe('missed')
    })

    it('still lets a hand-completed or missed profile have its title edited', async () => {
      db.tables.objective_profiles[0].status = 'missed'
      await updateObjective(asDb(), profile(), { title: 'Missed it' }, NOW)
      expect(objective().title).toBe('Missed it')
      expect(db.tables.objective_profiles[0].status).toBe('missed')
    })
  })
})
