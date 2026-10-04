'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  accuracyLabel,
  isLowAccuracy,
  parseCoordinatePair,
} from '@/lib/spots/coordinates'

export type SpotView = {
  id: string
  name: string
  lat: number
  lon: number
  is_active: boolean
  county: string | null
  state: string | null
  hunt_unit_id: string | null
  inside_boundary?: boolean | null
}

export type SpotsState = {
  spots: SpotView[]
  limit: number | null // null = uncapped
  active_spot_id: string | null
}

// Shared Tailwind classes. Opaque backgrounds, 14 px body, 44 px touch targets.
const BTN = 'min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors'
const INPUT = 'w-full min-h-[44px] rounded-lg bg-slate-800 border border-slate-600 text-white text-sm px-3 py-2 placeholder:text-slate-400'

export function headerText(count: number, limit: number | null): string {
  return limit == null ? `Hunt spots, ${count}` : `Hunt spots, ${count} of ${limit}`
}

export function atLimit(count: number, limit: number | null): boolean {
  return limit != null && count >= limit
}

// Warning text when a pin falls outside the objective's hunt boundary. A warning, never a block.
export function boundaryWarning(spot: SpotView, huntCode: string | null | undefined): string | null {
  if (!huntCode || spot.inside_boundary !== false) return null
  return `This spot is outside the ${huntCode} boundary. Strike briefs will still use these coordinates.`
}

// Presentational: the list, header and limit state. Container state lives in SpotsPanel.
export function SpotsView({
  state,
  huntCode,
  onAdd,
  onMakeActive,
}: {
  state: SpotsState
  huntCode?: string | null
  onAdd?: () => void
  onMakeActive?: (spot: SpotView) => void
}) {
  const count = state.spots.length
  const full = atLimit(count, state.limit)
  return (
    <section className="bg-slate-800 rounded-lg px-4 py-4 space-y-3" aria-label="Hunt spots">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-white font-semibold text-base">{headerText(count, state.limit)}</h2>
      </div>

      <ul className="space-y-2">
        {state.spots.map(spot => (
          <li key={spot.id} className="bg-slate-900 rounded-lg px-3 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{spot.name}</div>
              <div className="text-slate-300 text-xs">{spot.lat.toFixed(4)}, {spot.lon.toFixed(4)}</div>
              {(spot.county || spot.hunt_unit_id) && (
                <div className="text-slate-300 text-xs">{[spot.county, spot.hunt_unit_id].filter(Boolean).join(' · ')}</div>
              )}
              {boundaryWarning(spot, huntCode) && (
                <p className="mt-1 text-sm text-amber-200">{boundaryWarning(spot, huntCode)}</p>
              )}
            </div>
            {spot.is_active ? (
              <span className="flex-shrink-0 text-xs font-semibold px-2 py-1 rounded bg-emerald-900 text-emerald-200">Strike focus</span>
            ) : (
              onMakeActive && (
                <button
                  onClick={() => onMakeActive(spot)}
                  className={`${BTN} px-3 bg-slate-700 text-white hover:bg-slate-600`}
                >
                  Make focus
                </button>
              )
            )}
          </li>
        ))}
      </ul>

      {onAdd && (
        full ? (
          <div className="space-y-1">
            <button disabled className={`${BTN} w-full bg-slate-700 text-slate-300 cursor-not-allowed`}>
              Spot limit reached
            </button>
            <p className="text-sm text-slate-300">More spots coming with higher plans</p>
          </div>
        ) : (
          <button onClick={onAdd} className={`${BTN} w-full bg-blue-700 text-white hover:bg-blue-600`}>
            + Add a spot
          </button>
        )
      )}
    </section>
  )
}

type FormValues = { name: string; lat: string; lon: string }

// Add or edit form. Coordinates stay editable after a phone reading: the phone may be at the trailhead.
export function SpotForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormValues
  submitLabel: string
  onSubmit: (values: FormValues) => Promise<string | null>
  onCancel: () => void
}) {
  const [values, setValues] = useState<FormValues>(initial)
  const [paste, setPaste] = useState('')
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function applyPaste(text: string) {
    setPaste(text)
    const pair = parseCoordinatePair(text)
    if (pair) setValues(v => ({ ...v, lat: String(pair.lat), lon: String(pair.lon) }))
  }

  function useMyLocation() {
    setMessage(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setMessage('This browser cannot share a location. Enter coordinates instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false)
        setAccuracy(pos.coords.accuracy)
        setValues(v => ({ ...v, lat: pos.coords.latitude.toFixed(6), lon: pos.coords.longitude.toFixed(6) }))
      },
      err => {
        setLocating(false)
        if (err.code === err.PERMISSION_DENIED) setMessage('Location permission was denied. Enter coordinates instead.')
        else if (err.code === err.POSITION_UNAVAILABLE) setMessage('Your phone could not get a position. Try outdoors, or enter coordinates.')
        else setMessage('Timed out getting a position. Try again.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const error = await onSubmit(values)
    setBusy(false)
    if (error) setMessage(error)
  }

  const accuracyText = accuracyLabel(accuracy)
  return (
    <form onSubmit={submit} className="space-y-3 bg-slate-900 rounded-lg px-3 py-3">
      <label className="block text-sm text-slate-200">
        Name
        <input className={INPUT} maxLength={40} value={values.name} onChange={e => setValues(v => ({ ...v, name: e.target.value }))} />
      </label>
      <label className="block text-sm text-slate-200">
        Paste coordinates
        <input className={INPUT} placeholder="40.917, -111.397" value={paste} onChange={e => applyPaste(e.target.value)} />
      </label>
      <p className="text-sm text-slate-300">Tip: long-press a spot on onX or Google Maps to copy its coordinates.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-slate-200">
          Latitude
          <input className={INPUT} inputMode="decimal" value={values.lat} onChange={e => setValues(v => ({ ...v, lat: e.target.value }))} />
        </label>
        <label className="block text-sm text-slate-200">
          Longitude
          <input className={INPUT} inputMode="decimal" value={values.lon} onChange={e => setValues(v => ({ ...v, lon: e.target.value }))} />
        </label>
      </div>
      <button type="button" onClick={useMyLocation} disabled={locating} className={`${BTN} w-full bg-slate-700 text-white hover:bg-slate-600 disabled:text-slate-300`}>
        {locating ? 'Getting your location…' : "Use my phone's location"}
      </button>
      {accuracyText && <p className="text-sm text-slate-200">{accuracyText}</p>}
      {isLowAccuracy(accuracy) && (
        <p className="text-sm text-amber-200">This reading is less accurate than 100 m. Check the pin before you save.</p>
      )}
      {message && <p role="alert" className="text-sm text-red-200">{message}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${BTN} flex-1 bg-blue-700 text-white hover:bg-blue-600 disabled:bg-slate-600`}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={`${BTN} bg-slate-700 text-white hover:bg-slate-600`}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Container: loads spots, adds, edits, deletes and switches the active spot.
export default function SpotsPanel({ objectiveId, huntCode = null }: { objectiveId: string; huntCode?: string | null }) {
  const base = `/api/objectives/${objectiveId}/spots`
  const [state, setState] = useState<SpotsState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [sheet, setSheet] = useState<SpotView | null>(null)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SpotView | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SpotView | null>(null)

  async function load() {
    try {
      const res = await fetch(base)
      if (!res.ok) throw new Error()
      setState(await res.json() as SpotsState)
      setLoadError(null)
    } catch {
      setLoadError("Couldn't load hunt spots. Try again in a minute.")
    }
  }

  useEffect(() => { void load() }, [objectiveId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addSpot(values: { name: string; lat: string; lon: string }): Promise<string | null> {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: values.name, lat: Number(values.lat), lon: Number(values.lon) }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return (body as { error?: string }).error ?? 'Could not add the spot.'
    setAdding(false)
    setNotice(null)
    await load()
    return null
  }

  async function editSpot(spot: SpotView, values: { name: string; lat: string; lon: string }): Promise<string | null> {
    const res = await fetch(`${base}/${spot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: values.name, lat: Number(values.lat), lon: Number(values.lon) }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return (body as { error?: string }).error ?? 'Could not save the spot.'
    setEditing(null)
    await load()
    return null
  }

  async function makeActive(spot: SpotView) {
    setApplying(true)
    setSheetError(null)
    setNotice(null)
    const res = await fetch(`${base}/${spot.id}/activate`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setApplying(false)
    if (!res.ok) {
      setSheetError((body as { error?: string }).error ?? 'Could not switch spots.')
      return
    }
    setSheet(null)
    setNotice(`Next sweep will use ${spot.name}`)
    await load()
  }

  async function remove(spot: SpotView) {
    const res = await fetch(`${base}/${spot.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    setConfirmDelete(null)
    if (!res.ok) {
      setNotice((body as { error?: string }).error ?? 'Could not delete the spot.')
      return
    }
    await load()
  }

  if (loadError) return <div className="px-4 py-3 text-sm text-red-200">{loadError}</div>
  if (!state) return <div className="px-4 py-3 text-sm text-slate-200">Loading hunt spots…</div>

  return (
    <div className="space-y-3">
      <SpotsView
        state={state}
        huntCode={huntCode}
        onAdd={() => { setAdding(true); setEditing(null) }}
        onMakeActive={spot => { setSheet(spot); setSheetError(null) }}
      />

      {notice && <p role="status" className="text-sm text-slate-100 px-1">{notice}</p>}

      {adding && (
        <SpotForm
          initial={{ name: '', lat: '', lon: '' }}
          submitLabel="Save spot"
          onSubmit={addSpot}
          onCancel={() => setAdding(false)}
        />
      )}

      <ul className="space-y-2">
        {state.spots.map(spot => (
          <li key={spot.id} className="px-1">
            {editing?.id === spot.id ? (
              <SpotForm
                initial={{ name: spot.name, lat: String(spot.lat), lon: String(spot.lon) }}
                submitLabel="Save changes"
                onSubmit={values => editSpot(spot, values)}
                onCancel={() => setEditing(null)}
              />
            ) : confirmDelete?.id === spot.id ? (
              <div className="bg-slate-900 rounded-lg px-3 py-3 space-y-2">
                <p className="text-sm text-slate-100">Delete {spot.name}? Its saved briefs stay.</p>
                <div className="flex gap-2">
                  <button onClick={() => remove(spot)} className={`${BTN} bg-red-800 text-white`}>Delete</button>
                  <button onClick={() => setConfirmDelete(null)} className={`${BTN} bg-slate-700 text-white`}>Keep</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { setEditing(spot); setAdding(false) }} className={`${BTN} bg-slate-800 text-slate-100`}>Edit {spot.name}</button>
                {!spot.is_active && (
                  <button onClick={() => setConfirmDelete(spot)} className={`${BTN} bg-slate-800 text-slate-100`}>Delete</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {sheet && (
        <div role="dialog" aria-modal="true" aria-label={`Make ${sheet.name} the strike focus`} className="fixed inset-x-0 bottom-0 z-20 bg-slate-900 border-t border-slate-600 rounded-t-xl px-4 pt-4 pb-6 space-y-3">
          <p className="text-white font-semibold text-base">Make {sheet.name} the strike focus?</p>
          <p className="text-sm text-slate-200">The next sweep uses this spot. Its strike brief shows only this area.</p>
          {applying && <p className="text-sm text-slate-100 animate-pulse">Applying… this can take several seconds.</p>}
          {sheetError && <p role="alert" className="text-sm text-red-200">{sheetError}</p>}
          <div className="flex gap-2">
            <button disabled={applying} onClick={() => makeActive(sheet)} className={`${BTN} flex-1 bg-blue-700 text-white disabled:bg-slate-600`}>
              Make strike focus
            </button>
            <button disabled={applying} onClick={() => setSheet(null)} className={`${BTN} bg-slate-700 text-white`}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
