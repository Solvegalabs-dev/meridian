// Validation for the objective edit form and PATCH /api/strike/objectives/[id] (FF-096 Part 2).
// Pure and client-safe: the form checks with it before sending, and the route checks again on the server.
import { parseCalendarDate } from '@/lib/objectives/windowState'

export const MAX_TITLE_LENGTH = 120
export const MAX_NOTE_LENGTH = 1000

export type ObjectivePatch = {
  title?: string
  trip_start?: string | null
  trip_end?: string | null
  note?: string | null
}

export type PatchValidation = { ok: true; value: ObjectivePatch } | { ok: false; error: string }

// Only title, trip_start, trip_end and note are read. Everything else in the body is ignored.
export function validateObjectivePatch(body: Record<string, unknown>): PatchValidation {
  const value: ObjectivePatch = {}

  if ('title' in body) {
    if (typeof body.title !== 'string') return { ok: false, error: 'Title must be text.' }
    const title = body.title.replace(/\s+/g, ' ').trim()
    if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `Title must be 1 to ${MAX_TITLE_LENGTH} characters.` }
    }
    value.title = title
  }

  for (const key of ['trip_start', 'trip_end'] as const) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null || raw === '') { value[key] = null; continue }
    const parsed = parseCalendarDate(raw)
    if (!parsed) return { ok: false, error: `${key === 'trip_start' ? 'Trip start' : 'Trip end'} must be a date like 2026-10-15.` }
    value[key] = parsed
  }

  if ('note' in body) {
    if (body.note === null) value.note = null
    else if (typeof body.note !== 'string') return { ok: false, error: 'Note must be text.' }
    else {
      const note = body.note.trim()
      if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` }
      value.note = note === '' ? null : note
    }
  }

  if (Object.keys(value).length === 0) return { ok: false, error: 'Nothing to update.' }
  return { ok: true, value }
}

export type DetailsDraft = { title: string; tripStart: string; tripEnd: string; note: string }

// What the details form sends: only the fields that changed, so an untouched title is never written back.
// Returns the request body, or the message to show. `body` is empty when nothing changed.
export function buildDetailsPatch(saved: DetailsDraft, draft: DetailsDraft):
  { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const body: Record<string, unknown> = {}
  if (draft.title !== saved.title) body.title = draft.title
  if (draft.tripStart !== saved.tripStart) body.trip_start = draft.tripStart || null
  if (draft.tripEnd !== saved.tripEnd) body.trip_end = draft.tripEnd || null
  if (draft.note !== saved.note) body.note = draft.note || null
  if (Object.keys(body).length === 0) return { ok: true, body }

  const checked = validateObjectivePatch(body)
  if (!checked.ok) return { ok: false, error: checked.error }

  // The end is judged against the other date as it will be saved, not only against what was typed.
  const start = checked.value.trip_start !== undefined ? checked.value.trip_start : (draft.tripStart || null)
  const end = checked.value.trip_end !== undefined ? checked.value.trip_end : (draft.tripEnd || null)
  if (start && end && end < start) return { ok: false, error: 'The trip end cannot be before the trip start.' }
  return { ok: true, body }
}
