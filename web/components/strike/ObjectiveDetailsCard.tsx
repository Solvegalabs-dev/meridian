'use client'

// "Objective details" card at the top of the Prep tab (FF-096 Part 2): title, trip dates and a note.
// Species, hunt type, state and hunt number are not editable here (the hunt number has its own card).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildDetailsPatch, MAX_TITLE_LENGTH, MAX_NOTE_LENGTH } from '@/lib/strike/objectivePatch'

const INPUT = 'w-full min-h-[44px] rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2 placeholder:text-slate-400'
const DATE_INPUT = `${INPUT} [color-scheme:dark]`

export const DETAILS_LOCKED_NOTE = 'To change the species or state, remove this objective and create a new one.'

type Props = {
  objectiveId: string
  title: string
  tripStart: string | null
  tripEnd: string | null
  note: string | null
}

export default function ObjectiveDetailsCard({ objectiveId, title, tripStart, tripEnd, note }: Props) {
  const router = useRouter()
  const initial = { title, tripStart: tripStart ?? '', tripEnd: tripEnd ?? '', note: note ?? '' }
  const [draft, setDraft] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  // Only the fields the user changed are sent, so an untouched title is never written back.
  const patch = buildDetailsPatch(saved, draft)
  const dirty = patch.ok ? Object.keys(patch.body).length > 0 : true

  function set<K extends keyof typeof draft>(key: K, value: string) {
    setDraft(d => ({ ...d, [key]: value }))
    setMessage(null)
  }

  async function save() {
    if (!patch.ok) { setMessage({ text: patch.error, ok: false }); return }
    const body = patch.body

    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/strike/objectives/${objectiveId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; reactivated?: boolean }
      if (!res.ok) { setMessage({ text: json.error ?? 'Could not save the changes. Try again.', ok: false }); return }
      setSaved(draft)
      setMessage({ text: json.reactivated ? 'Saved. This objective is active again.' : 'Saved.', ok: true })
      router.refresh()
    } catch {
      setMessage({ text: 'Could not save the changes. Try again.', ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-slate-800 rounded-lg px-4 py-4 space-y-3" aria-label="Objective details">
      <h2 className="text-white font-semibold text-base">Objective details</h2>

      <label className="block text-sm text-slate-200">
        Title
        <input className={INPUT} value={draft.title} maxLength={MAX_TITLE_LENGTH} onChange={e => set('title', e.target.value)} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-slate-200">
          Trip start
          <input type="date" className={DATE_INPUT} value={draft.tripStart} onChange={e => set('tripStart', e.target.value)} />
        </label>
        <label className="block text-sm text-slate-200">
          Trip end
          <input type="date" className={DATE_INPUT} value={draft.tripEnd} onChange={e => set('tripEnd', e.target.value)} />
        </label>
      </div>

      <label className="block text-sm text-slate-200">
        Note (optional)
        <textarea className={`${INPUT} min-h-[88px]`} value={draft.note} maxLength={MAX_NOTE_LENGTH} onChange={e => set('note', e.target.value)} />
      </label>

      {message && (
        <p role="status" className={`text-sm ${message.ok ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="w-full min-h-[44px] rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-600 transition-colors disabled:bg-slate-600 disabled:text-slate-300"
      >
        {busy ? 'Saving…' : 'Save details'}
      </button>

      <p className="text-xs text-slate-300">{DETAILS_LOCKED_NOTE}</p>
    </section>
  )
}
