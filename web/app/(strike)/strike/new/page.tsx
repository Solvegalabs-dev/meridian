'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isFishingTaxonomyKey } from '@/lib/strike/config/fishing-taxonomy'
import { normalizeHuntCode } from '@/lib/hunts/huntCode'
import { coverageDecision, type CoverageMode } from '@/lib/strike/coverage'
import { checkTripDate, tripDateBounds } from '@/lib/strike/tripDateRange'

const TAXONOMY_OPTIONS = [
  // Hunting
  { value: 'elk.bull.archery',   label: 'Elk · Bull · Archery' },
  { value: 'elk.bull.rifle',     label: 'Elk · Bull · Rifle' },
  { value: 'elk.cow.archery',    label: 'Elk · Cow · Archery' },
  { value: 'deer.whitetail.archery', label: 'Deer · Whitetail · Archery' },
  { value: 'deer.whitetail.rifle',   label: 'Deer · Whitetail · Rifle' },
  { value: 'deer.mule.archery',  label: 'Deer · Mule Deer · Archery' },
  { value: 'turkey.eastern.archery', label: 'Turkey · Eastern · Archery' },
  // Fishing
  { value: 'salmon.king.river_migration',    label: 'King salmon · River migration' },
  { value: 'salmon.sockeye.river_migration', label: 'Sockeye · River migration' },
  { value: 'trout.rainbow.fly_fishing',      label: 'Rainbow trout · Fly fishing' },
  { value: 'trout.brown.fly_fishing',        label: 'Brown trout · Fly fishing' },
]

function getDomain(taxonomyKey: string): string {
  return isFishingTaxonomyKey(taxonomyKey) ? 'fishing' : taxonomyKey.split('.')[0]
}

export default function StrikeNewPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // FF-096 Part 3: set when we have no data for the chosen species and state. `confirmed` is the one extra tap.
  const [coverage, setCoverage] = useState<{ text: string; mode: CoverageMode; confirmed: boolean } | null>(null)

  const [form, setForm] = useState({
    taxonomy_key: 'elk.bull.archery',
    state: '',
    unit: '',
    hunt_number: '',
    water_body: '',
    river_miles: '',
    access_type: '',
    lat: '',
    lon: '',
    trip_start: '',
    trip_end: '',
  })

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    // Any change to the selection means the notice (and a confirmation) no longer applies.
    setCoverage(null)
  }

  const isFishing = isFishingTaxonomyKey(form.taxonomy_key)

  // The state the objective will be saved with: a hunt number alone means Utah (see createObjective).
  const effectiveState = form.state || (!isFishing && normalizeHuntCode(form.hunt_number) ? 'UT' : '')

  // Asks the server whether we have data for this species and state. A failed lookup never blocks creating:
  // the notice is advice, and in 'block' mode the create route enforces it on the server.
  async function checkCoverage(): Promise<{ covered: boolean | null; mode: CoverageMode; notice: string | null } | null> {
    try {
      const qs = new URLSearchParams({ taxonomy_key: form.taxonomy_key, state: effectiveState })
      const res = await fetch(`/api/strike/coverage?${qs.toString()}`)
      if (!res.ok) return null
      return await res.json() as { covered: boolean | null; mode: CoverageMode; notice: string | null }
    } catch {
      return null
    }
  }

  const dateBounds = tripDateBounds()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    // FF-096b: a year outside last year to three years ahead (or a typo like 0027) is stopped before anything else.
    const dateProblem = checkTripDate(form.trip_start, 'Trip start') ?? checkTripDate(form.trip_end, 'Trip end')
    if (dateProblem) { setError(dateProblem); return }
    if (coverage?.confirmed !== true) {
      setSubmitting(true)
      const check = await checkCoverage()
      setSubmitting(false)
      if (check) {
        const decision = coverageDecision(check.mode, check.covered, false)
        if (decision !== 'proceed') {
          setCoverage({ text: check.notice ?? '', mode: check.mode, confirmed: false })
          return
        }
      }
    }
    await createObjective()
  }

  async function createObjective() {
    setError(null)
    setSubmitting(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const geo: Record<string, unknown> = {}
      if (form.state) geo.state = form.state
      if (isFishing) {
        if (form.water_body) geo.water_body = form.water_body
        if (form.river_miles) geo.river_miles = form.river_miles
        if (form.access_type) geo.access_type = form.access_type
      } else {
        if (form.unit) geo.unit = form.unit
        // FF-091: a valid UDWR hunt number is stored as geo.unit and sets the hunt code on save.
        // It is Utah-only, so an empty state becomes UT.
        const code = normalizeHuntCode(form.hunt_number)
        if (code) {
          geo.unit = code
          if (!form.state) geo.state = 'UT'
        }
      }
      if (form.lat) geo.lat = parseFloat(form.lat)
      if (form.lon) geo.lon = parseFloat(form.lon)

      const timing: Record<string, unknown> = {}
      if (form.trip_start) timing.trip_start = form.trip_start
      if (form.trip_end) timing.trip_end = form.trip_end

      const res = await fetch('/api/objectives/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: getDomain(form.taxonomy_key),
          taxonomy_key: form.taxonomy_key,
          geo,
          timing,
          priority_stack: [],
        }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      }

      const { objective_id } = await res.json() as { objective_id: string }
      router.push(`/strike/${objective_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-700">
        <button
          onClick={() => router.push('/strike')}
          className="text-slate-400 hover:text-white text-sm"
        >
          ← Back
        </button>
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Strike</div>
          <div className="text-lg font-semibold">New Objective</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-6 space-y-5 max-w-lg">
        {/* Species / Method */}
        <div>
          <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">
            Species / Method
          </label>
          <select
            value={form.taxonomy_key}
            onChange={e => set('taxonomy_key', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <optgroup label="Hunting">
              {TAXONOMY_OPTIONS.filter(o => !isFishingTaxonomyKey(o.value)).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Fishing">
              {TAXONOMY_OPTIONS.filter(o => isFishingTaxonomyKey(o.value)).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Location */}
        <div>
          <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">
            Location
          </label>
          {isFishing ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="State (e.g. UT, AK)"
                  value={form.state}
                  onChange={e => set('state', e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
                />
                <select
                  value={form.access_type}
                  onChange={e => set('access_type', e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">Access type</option>
                  <option value="public">Public</option>
                  <option value="mixed">Mixed</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div className="mt-2">
                <input
                  type="text"
                  placeholder="Water body (e.g. Green River, Kenai River)"
                  value={form.water_body}
                  onChange={e => set('water_body', e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
                />
              </div>
              <div className="mt-2">
                <input
                  type="text"
                  placeholder="River miles (optional, e.g. RM 0–7 A-section)"
                  value={form.river_miles}
                  onChange={e => set('river_miles', e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
                />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="State (e.g. UT)"
                value={form.state}
                onChange={e => set('state', e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
              />
              <input
                type="text"
                placeholder="Unit (e.g. HD316)"
                value={form.unit}
                onChange={e => set('unit', e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
              />
            </div>
          )}
          {!isFishing && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                placeholder="Hunt number (optional, e.g. EA2004)"
                value={form.hunt_number}
                onChange={e => set('hunt_number', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                maxLength={6}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
              />
              <p className="text-xs text-slate-300">Your Utah DWR hunt number. You can add or change it on the Prep tab later.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="text"
              placeholder="Latitude"
              value={form.lat}
              onChange={e => set('lat', e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
            />
            <input
              type="text"
              placeholder="Longitude"
              value={form.lon}
              onChange={e => set('lon', e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500"
            />
          </div>
        </div>

        {/* Dates */}
        <div>
          <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">
            {isFishing ? 'Trip Window' : 'Hunt Window'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-slate-500 mb-1">Start</div>
              <input
                type="date"
                min={dateBounds.min}
                max={dateBounds.max}
                value={form.trip_start}
                onChange={e => set('trip_start', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm [color-scheme:dark]"
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">End</div>
              <input
                type="date"
                min={dateBounds.min}
                max={dateBounds.max}
                value={form.trip_end}
                onChange={e => set('trip_end', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm [color-scheme:dark]"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {coverage && !coverage.confirmed && (
          <div role="alert" className="rounded-lg px-4 py-3 text-sm bg-amber-100 border border-amber-500 text-amber-950 space-y-3">
            <p className="font-medium">{coverage.text}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {coverage.mode === 'warn' && (
                <button
                  type="button"
                  onClick={() => { setCoverage({ ...coverage, confirmed: true }); void createObjective() }}
                  className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-amber-900 text-white hover:bg-amber-800 transition-colors"
                >
                  Create anyway
                </button>
              )}
              <button
                type="button"
                onClick={() => setCoverage(null)}
                className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-white border border-amber-700 text-amber-950 hover:bg-amber-50 transition-colors"
              >
                Change selection
              </button>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || (coverage !== null && !coverage.confirmed)}
          className="w-full min-h-[44px] bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-3 rounded-xl transition-colors text-sm"
        >
          {submitting ? 'Creating objective…' : 'Create Objective'}
        </button>
      </form>
    </div>
  )
}
