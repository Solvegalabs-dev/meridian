'use client'

import { useState, useEffect, useRef } from 'react'

type FieldNote = {
  id: string
  objective_id: string
  user_id: string
  note_text: string
  location: { lat: number; lon: number; label: string } | null
  community_consented: boolean
  created_at: string
}

type Props = { objectiveId: string }

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function captureLocation(): Promise<{ lat: number; lon: number; label: string }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not available'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
      }),
      reject,
      { timeout: 10000, enableHighAccuracy: true }
    )
  })
}

export default function StrikeNotesPanel({ objectiveId }: Props) {
  const [notes, setNotes] = useState<FieldNote[]>([])
  const [loading, setLoading] = useState(true)
  const [showMore, setShowMore] = useState(false)
  const [composing, setComposing] = useState(false)

  // Compose state
  const [noteText, setNoteText] = useState('')
  const [location, setLocation] = useState<{ lat: number; lon: number; label: string } | null>(null)
  const [locLoading, setLocLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nowTs, setNowTs] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/strike/notes?objective_id=${encodeURIComponent(objectiveId)}`)
      .then(r => r.json())
      .then(d => setNotes(d.notes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [objectiveId])

  const openCompose = () => {
    setNoteText('')
    setLocation(null)
    setNowTs(formatTs(new Date().toISOString()))
    setComposing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const addLocation = async () => {
    setLocLoading(true)
    try {
      const loc = await captureLocation()
      setLocation(loc)
    } catch {
      alert('Could not get location. Check browser permissions.')
    } finally {
      setLocLoading(false)
    }
  }

  const save = async () => {
    if (noteText.trim().length < 3 || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/strike/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective_id: objectiveId,
          note_text: noteText.trim(),
          location: location ?? null,
        }),
      })
      const d = await res.json()
      if (d.note) {
        setNotes(prev => [d.note as FieldNote, ...prev])
        setComposing(false)
      }
    } catch {}
    setSaving(false)
  }

  const deleteNote = async (id: string) => {
    const confirmed = window.confirm('Delete this note?')
    if (!confirmed) return
    await fetch(`/api/strike/notes/${id}`, { method: 'DELETE' })
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  // Compose view
  if (composing) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-900 pb-8">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-700">
          <button
            onClick={() => setComposing(false)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Back
          </button>
          <span className="text-xs font-mono text-slate-500">{nowTs}</span>
        </div>

        <div className="flex-1 px-4 pt-4">
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="What are you seeing out here?"
            className="w-full min-h-[120px] bg-slate-800 text-slate-100 text-sm rounded-xl p-4 border border-slate-700 resize-none placeholder-slate-600 focus:outline-none focus:border-blue-600"
            rows={5}
          />

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={addLocation}
              disabled={locLoading}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 py-2 px-3 rounded-lg bg-slate-800 border border-slate-700"
            >
              📍 {locLoading ? 'Locating…' : location ? location.label : 'Add location'}
            </button>
            {location && (
              <button
                onClick={() => setLocation(null)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={save}
            disabled={noteText.trim().length < 3 || saving}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
              noteText.trim().length >= 3 && !saving
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    )
  }

  // List view
  const visible = showMore ? notes : notes.slice(0, 3)

  return (
    <div className="p-4 pb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-400 uppercase tracking-wider">Field notes</div>
        <button
          onClick={openCompose}
          className="text-xs text-blue-400 hover:text-blue-300 py-1 px-3 rounded-lg bg-slate-800 border border-slate-700"
        >
          + New note
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : notes.length === 0 ? (
        <div className="text-slate-500 text-sm">
          No field notes yet. Tap <span className="text-blue-400">+ New note</span> to add one.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {visible.map(note => (
              <div key={note.id} className="bg-slate-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono text-slate-500">{formatTs(note.created_at)}</span>
                  {note.location && (
                    <span className="text-xs text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">
                      📍 {(note.location as { label?: string }).label ?? 'GPS'}
                    </span>
                  )}
                  {note.community_consented && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="Community data shared" />
                  )}
                  <button
                    onClick={() => deleteNote(note.id)}
                    className="ml-auto text-slate-600 hover:text-red-400 text-xs"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed">{note.note_text}</p>
              </div>
            ))}
          </div>

          {notes.length > 3 && !showMore && (
            <button
              onClick={() => setShowMore(true)}
              className="mt-2 w-full py-2 text-xs text-slate-400 hover:text-slate-200"
            >
              Show {notes.length - 3} more
            </button>
          )}
        </>
      )}
    </div>
  )
}
