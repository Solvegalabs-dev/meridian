'use client'

import { useEffect, useState } from 'react'
import { normalizeHuntCode, HUNT_CODE_RE } from '@/lib/hunts/huntCode'

// Shared classes. Opaque backgrounds, 14 px body, 44 px touch targets.
const BTN = 'min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors'
const INPUT = 'w-full min-h-[44px] rounded-lg bg-slate-800 border border-slate-600 text-white text-sm px-3 py-2 placeholder:text-slate-400'

type Info = {
  hunt_code: string | null
  season_text: string | null
  boundary_found: boolean
  season_on_file: boolean
}

export function formatInput(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '')
}

// Shown under the hunt number once a code is saved. Season text is shown verbatim, never parsed.
// `saved` is true only for a stored number. Before save, the season-on-file note is not shown.
export function HuntInfo({ info, saved }: { info: Info; saved: boolean }) {
  return (
    <div className="space-y-1 text-sm text-slate-100">
      <p>Hunt {info.hunt_code}</p>
      {info.season_text && <p>DWR season: {info.season_text}</p>}
      {info.boundary_found && <p>Boundary found · Source: Utah DWR</p>}
      {saved && info.hunt_code && !info.season_on_file && (
        <p className="text-slate-200">Season dates for this hunt are not on file yet. Meridian is using your trip dates.</p>
      )}
    </div>
  )
}

export default function HuntNumberCard({ objectiveId, initialCode }: { objectiveId: string; initialCode: string | null }) {
  const base = `/api/objectives/${objectiveId}/hunt-code`
  const [value, setValue] = useState(initialCode ?? '')
  const [info, setInfo] = useState<Info | null>(null) // saved number
  const [lookupResult, setLookupResult] = useState<Info | null>(null) // result of the last lookup, not yet saved
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const res = await fetch(base)
    if (res.ok) setInfo(await res.json() as Info)
  }

  useEffect(() => {
    if (initialCode) void refresh().catch(() => {})
  }, [objectiveId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup() {
    const code = normalizeHuntCode(value)
    setMessage(null)
    setLookupResult(null)
    if (!code) {
      if (value) setMessage('Hunt numbers look like EA2004: two letters and four digits.')
      return
    }
    try {
      const res = await fetch('/api/hunts/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const body = await res.json() as { status?: string; season_text?: string | null; boundary_found?: boolean }
      if (!res.ok) throw new Error()
      if (body.status === 'found') setLookupResult({ hunt_code: code, season_text: body.season_text ?? null, boundary_found: !!body.boundary_found, season_on_file: false })
      else if (body.status === 'not_found') setMessage('No hunt with that number was found at Utah DWR. You can still save it.')
      else setMessage("Couldn't look that up right now. You can still save the number.")
    } catch {
      setMessage("Couldn't look that up right now. You can still save the number.")
    }
  }

  async function save(code: string | null) {
    setBusy(true)
    setMessage(null)
    const res = await fetch(base, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setMessage((body as { error?: string }).error ?? 'Could not save the hunt number.')
      return
    }
    const saved = await res.json() as Info
    setInfo(saved.hunt_code ? saved : null)
    setLookupResult(null)
    setValue(saved.hunt_code ?? '')
    setMessage(saved.hunt_code ? 'Hunt number saved.' : 'Hunt number removed.')
  }

  const valid = HUNT_CODE_RE.test(normalizeHuntCode(value) ?? '')
  return (
    <section className="bg-slate-800 rounded-lg px-4 py-4 space-y-3" aria-label="Hunt number">
      <h2 className="text-white font-semibold text-base">Hunt number</h2>
      <label className="block text-sm text-slate-200">
        Optional, from your Utah DWR permit
        <input
          className={INPUT}
          value={value}
          placeholder="EA2004"
          maxLength={6}
          autoCapitalize="characters"
          onChange={e => setValue(formatInput(e.target.value))}
          onBlur={lookup}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lookup() } }}
        />
      </label>
      {lookupResult?.hunt_code && <HuntInfo info={lookupResult} saved={false} />}
      {info?.hunt_code && <HuntInfo info={info} saved />}
      {message && <p role="status" className="text-sm text-slate-100">{message}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => save(normalizeHuntCode(value))}
          disabled={busy || !valid}
          className={`${BTN} flex-1 bg-blue-700 text-white hover:bg-blue-600 disabled:bg-slate-600 disabled:text-slate-300`}
        >
          {busy ? 'Saving…' : 'Save hunt number'}
        </button>
        {info?.hunt_code && (
          <button onClick={() => save(null)} disabled={busy} className={`${BTN} bg-slate-700 text-white`}>Remove</button>
        )}
      </div>
      <p className="text-xs text-slate-300">Source: Utah DWR</p>
    </section>
  )
}
