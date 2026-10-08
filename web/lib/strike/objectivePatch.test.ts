import { describe, it, expect } from 'vitest'
import { buildDetailsPatch, type DetailsDraft } from './objectivePatch'

const saved: DetailsDraft = { title: 'Green River opener', tripStart: '2026-10-01', tripEnd: '2026-10-31', note: '' }

describe('buildDetailsPatch (what the Objective details form sends)', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildDetailsPatch(saved, { ...saved })).toEqual({ ok: true, body: {} })
  })

  it('sends only the fields that changed, so an untouched title is never written back', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-11-10' })).toEqual({ ok: true, body: { trip_end: '2026-11-10' } })
    expect(buildDetailsPatch(saved, { ...saved, title: 'New name', note: 'waders' })).toEqual({
      ok: true,
      body: { title: 'New name', note: 'waders' },
    })
  })

  it('turns a cleared date or note into null', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '', note: '' })).toEqual({ ok: true, body: { trip_end: null } })
    expect(buildDetailsPatch({ ...saved, note: 'old' }, { ...saved, note: '' })).toEqual({ ok: true, body: { note: null } })
  })

  it('rejects an empty or over-long title', () => {
    expect(buildDetailsPatch(saved, { ...saved, title: '' })).toMatchObject({ ok: false })
    expect(buildDetailsPatch(saved, { ...saved, title: 'x'.repeat(121) })).toMatchObject({ ok: false })
  })

  it('rejects an end before the start, whichever of the two was edited', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-09-30' })).toEqual({ ok: false, error: 'The trip end cannot be before the trip start.' })
    expect(buildDetailsPatch(saved, { ...saved, tripStart: '2026-11-15' })).toEqual({ ok: false, error: 'The trip end cannot be before the trip start.' })
    expect(buildDetailsPatch(saved, { ...saved, tripStart: '2026-11-15', tripEnd: '2026-11-20' })).toMatchObject({ ok: true })
  })

  it('allows a start with no end, and an end equal to the start', () => {
    expect(buildDetailsPatch({ ...saved, tripEnd: '' }, { ...saved, tripEnd: '', tripStart: '2026-12-01' })).toMatchObject({ ok: true })
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-10-01' })).toMatchObject({ ok: true })
  })

  it('rejects a date that is not a real calendar date', () => {
    expect(buildDetailsPatch(saved, { ...saved, tripEnd: '2026-02-30' })).toMatchObject({ ok: false })
  })
})
