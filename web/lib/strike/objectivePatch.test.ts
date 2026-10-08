import { describe, it, expect } from 'vitest'
import { buildDetailsPatch, type DetailsDraft } from './objectivePatch'

const NOW = new Date('2026-10-08T15:00:00Z')
const saved: DetailsDraft = { title: 'Green River opener', tripStart: '2026-10-01', tripEnd: '2026-10-31', note: '' }

describe('buildDetailsPatch (what the Objective details form sends)', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildDetailsPatch(saved, { ...saved }, NOW)).toEqual({ ok: true, body: {} })
  })

  it('sends only the fields that changed, so an untouched title is never written back', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-11-10' }, NOW)).toEqual({ ok: true, body: { trip_end: '2026-11-10' } })
    expect(buildDetailsPatch(saved, { ...saved, title: 'New name', note: 'waders' }, NOW)).toEqual({
      ok: true,
      body: { title: 'New name', note: 'waders' },
    })
  })

  it('turns a cleared date or note into null', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '', note: '' }, NOW)).toEqual({ ok: true, body: { trip_end: null } })
    expect(buildDetailsPatch({ ...saved, note: 'old' }, { ...saved, note: '' }, NOW)).toEqual({ ok: true, body: { note: null } })
  })

  it('rejects an empty or over-long title', () => {
    expect(buildDetailsPatch(saved, { ...saved, title: '' }, NOW)).toMatchObject({ ok: false })
    expect(buildDetailsPatch(saved, { ...saved, title: 'x'.repeat(121) }, NOW)).toMatchObject({ ok: false })
  })

  it('rejects an end before the start, whichever of the two was edited', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-09-30' }, NOW)).toEqual({ ok: false, error: 'The trip end cannot be before the trip start.' })
    expect(buildDetailsPatch(saved, { ...saved, tripStart: '2026-11-15' }, NOW)).toEqual({ ok: false, error: 'The trip end cannot be before the trip start.' })
    expect(buildDetailsPatch(saved, { ...saved, tripStart: '2026-11-15', tripEnd: '2026-11-20' }, NOW)).toMatchObject({ ok: true })
  })

  it('allows a start with no end, and an end equal to the start', () => {
    expect(buildDetailsPatch({ ...saved, tripEnd: '' }, { ...saved, tripEnd: '', tripStart: '2026-12-01' }, NOW)).toMatchObject({ ok: true })
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-10-01' }, NOW)).toMatchObject({ ok: true })
  })

  it('rejects a date that is not a real calendar date', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-02-30' }, NOW)).toMatchObject({ ok: false })
  })
})

describe('trip date range (FF-096b)', () => {
  const RANGE = 'Trip dates must be between 2025 and 2029.'

  it('PATCH validation rejects a year outside last year to three years ahead, with a clear message', async () => {
    const { validateObjectivePatch } = await import('./objectivePatch')
    expect(validateObjectivePatch({ trip_end: '2030-01-01' }, NOW)).toEqual({ ok: false, error: RANGE })
    expect(validateObjectivePatch({ trip_start: '2024-12-31' }, NOW)).toEqual({ ok: false, error: RANGE })
    expect(validateObjectivePatch({ trip_start: '0027-10-15' }, NOW)).toMatchObject({ ok: false })
    expect(validateObjectivePatch({ trip_start: '2025-01-01', trip_end: '2029-12-31' }, NOW)).toMatchObject({ ok: true })
  })

  it('the Objective details form shows the same message before sending anything', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2031-05-01' }, NOW)).toEqual({ ok: false, error: RANGE })
    expect(buildDetailsPatch(saved, { ...saved, tripStart: '0027-10-01' }, NOW)).toMatchObject({ ok: false })
  })

  it('clearing a date is always allowed, and a title-only edit does not look at the saved dates', async () => {
    const { validateObjectivePatch } = await import('./objectivePatch')
    expect(validateObjectivePatch({ trip_end: null }, NOW)).toMatchObject({ ok: true })
    // An objective already saved with a bad year can still be renamed.
    expect(buildDetailsPatch({ ...saved, tripStart: '0027-10-01' }, { ...saved, tripStart: '0027-10-01', title: 'Fixed name' }, NOW))
      .toEqual({ ok: true, body: { title: 'Fixed name' } })
  })
})
