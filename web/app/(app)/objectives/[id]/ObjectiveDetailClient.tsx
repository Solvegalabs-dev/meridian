'use client'

import { useState, useEffect } from 'react'
import { Settings, X, Pause, Pencil, ChevronLeft, Eye, RotateCcw, Play, CalendarPlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as chrono from 'chrono-node'
import WatchSourcesPanel, { type WatchSource } from '@/components/watchlist/WatchSourcesPanel'
import CloseModal from '@/components/objectives/CloseModal'
import AbandonModal from '@/components/objectives/AbandonModal'
import StrikeBriefCard from '@/components/strikeBrief/StrikeBriefCard'

interface ObjProps {
  id: string
  title: string
  status: string
  confidence: number | null
  target_date: string | null
  deadline_type: 'hard' | 'soft'
  reservation_price: number | null
  context: Record<string, unknown>
  objective_type: string | null
  notes: string | null
  category: string
}

export interface HuntLocation {
  lat: number | null
  lon: number | null
  nws_grid_office: string | null
  nws_grid_x: number | null
  nws_grid_y: number | null
}

interface Props {
  obj: ObjProps
  location?: HuntLocation | null
  tier: string
  accountType: string | null
  initialSources: WatchSource[]
  unseenAlertCount?: number
  smsAlertsEnabled?: boolean
}

type DrawerView = 'menu' | 'edit' | 'watch'

export default function ObjectiveDetailClient({ obj, location = null, tier, accountType, initialSources, unseenAlertCount = 0, smsAlertsEnabled = false }: Props) {
  const [closeModalOpen, setCloseModalOpen]     = useState(false)
  const [abandonModalOpen, setAbandonModalOpen] = useState(false)
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false)
  const [pauseSaving, setPauseSaving]           = useState(false)

  // Reopen confirmation state
  const [reopenConfirm, setReopenConfirm] = useState(false)
  const [reopenSaving, setReopenSaving]   = useState(false)

  // Calendar add state
  const [calendarModalOpen, setCalendarModalOpen] = useState(false)
  const [calModalTitle, setCalModalTitle]         = useState('')
  const [calModalDate, setCalModalDate]           = useState('')
  const [calModalTime, setCalModalTime]           = useState('09:00')
  const [calModalNotes, setCalModalNotes]         = useState('')
  const [calAddStatus, setCalAddStatus]           = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [notesDateSuggestion, setNotesDateSuggestion] = useState<{ iso: string; readable: string } | null>(null)
  const [notesBannerDismissed, setNotesBannerDismissed] = useState(false)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [view, setView] = useState<DrawerView>('menu')
  const [loading, setLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const router = useRouter()

  // Edit form state
  const [title, setTitle]                   = useState(obj.title)
  const [targetDate, setTargetDate]         = useState(obj.target_date ? obj.target_date.slice(0, 10) : '')
  const [deadlineType, setDeadlineType]     = useState<'hard' | 'soft'>(obj.deadline_type ?? 'hard')
  const [reservationPrice, setReservation]  = useState(obj.reservation_price?.toString() ?? '')
  const [notes, setNotes]                   = useState(obj.notes ?? '')
  const isResale = (obj.objective_type ?? '').startsWith('asset.resale')
  const ctx = obj.context ?? {}
  const [listingPrice, setListingPrice]     = useState((ctx.listing_price as string | undefined) ?? '')
  const [targetPrice, setTargetPrice]       = useState((ctx.target_price as string | undefined) ?? '')
  const [floorPrice, setFloorPrice]         = useState((ctx.floor_price as string | undefined) ?? '')

  // Hunt location state (FF-074) — only shown when an objective_profiles row exists
  const [huntLat, setHuntLat]               = useState(location?.lat?.toString() ?? '')
  const [huntLon, setHuntLon]               = useState(location?.lon?.toString() ?? '')
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationError, setLocationError]   = useState<string | null>(null)
  const [locationConfirm, setLocationConfirm] = useState<string | null>(null)

  // Sync targetDate whenever the prop updates (router.refresh() replaces props
  // without remounting, so useState initializer runs only once on mount).
  useEffect(() => {
    setTargetDate(obj.target_date ? obj.target_date.slice(0, 10) : '')
  }, [obj.target_date])

  function openDrawer() {
    setView('menu')
    setSaveError(null)
    setReopenConfirm(false)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setReopenConfirm(false)
  }

  async function handlePause() {
    setPauseSaving(true)
    await fetch(`/api/objectives/${obj.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused', paused_at: new Date().toISOString() }),
    })
    setPauseSaving(false)
    setPauseConfirmOpen(false)
    router.refresh()
  }

  async function handleResume() {
    await fetch(`/api/objectives/${obj.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', paused_at: null }),
    })
    router.refresh()
  }

  async function handleReopen() {
    setReopenSaving(true)
    await fetch(`/api/objectives/${obj.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', closure_type: null }),
    })
    setReopenSaving(false)
    closeDrawer()
    router.refresh()
  }

  async function handleSave() {
    setSaveError(null)

    if (targetDate) {
      const todayStr = new Date().toISOString().split('T')[0]
      if (targetDate < todayStr) {
        setSaveError('Target date cannot be in the past.')
        return
      }
    }

    setLoading(true)
    const context: Record<string, unknown> = { ...ctx }
    if (isResale) {
      if (listingPrice) context.listing_price = Number(listingPrice)
      if (targetPrice)  context.target_price  = Number(targetPrice)
      if (floorPrice)   context.floor_price   = Number(floorPrice)
    }

    const res = await fetch(`/api/objectives/${obj.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        target_date: targetDate || null,
        deadline_type: deadlineType,
        reservation_price: reservationPrice ? Number(reservationPrice) : null,
        notes: notes || null,
        context,
      }),
    })

    setLoading(false)

    if (!res.ok) {
      const d = await res.json() as { error?: string; target_date?: string }
      if (d.error === 'past_target_date') {
        setSaveError(`Date ${d.target_date} is in the past — please choose a future date.`)
      } else {
        setSaveError(d.error ?? 'Save failed — please try again.')
      }
      return
    }

    closeDrawer()
    router.refresh()
  }

  async function handleLocationSave() {
    setLocationError(null)
    setLocationConfirm(null)

    const lat = Number(huntLat)
    const lon = Number(huntLon)
    if (!huntLat.trim() || !huntLon.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)
        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setLocationError('Enter decimal coordinates, e.g. 40.948 and -110.668.')
      return
    }

    setLocationSaving(true)
    const res = await fetch(`/api/objectives/${obj.id}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    })
    setLocationSaving(false)

    const d = await res.json() as { error?: string; location?: HuntLocation }
    if (!res.ok || !d.location) {
      setLocationError(d.error ?? 'Save failed — please try again.')
      return
    }

    const loc = d.location
    setLocationConfirm(`Weather targeting set — ${loc.nws_grid_office} grid ${loc.nws_grid_x},${loc.nws_grid_y}`)
    router.refresh()
  }

  function openCalendarModal(prefillDate?: string) {
    setCalModalTitle(obj.title)
    setCalModalDate(prefillDate ?? targetDate)
    setCalModalTime('09:00')
    setCalModalNotes('')
    setCalAddStatus('idle')
    setCalendarModalOpen(true)
  }

  function handleNotesBlur() {
    if (notesBannerDismissed || !notes.trim()) return
    const results = chrono.parse(notes, new Date(), { forwardDate: true })
    if (results.length === 0) { setNotesDateSuggestion(null); return }
    const detected = results[0].start.date()
    if (detected <= new Date()) { setNotesDateSuggestion(null); return }
    const iso = detected.toISOString().split('T')[0]
    const readable = detected.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    setNotesDateSuggestion({ iso, readable })
  }

  async function handleCalendarAdd() {
    setCalAddStatus('loading')
    const res = await fetch('/api/calendar/add-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: calModalTitle,
        date: calModalDate,
        time: calModalTime,
        notes: calModalNotes,
        objective_id: obj.id,
      }),
    })
    if (!res.ok) {
      setCalAddStatus('error')
      return
    }
    const data = await res.json() as { success: boolean; url?: string }
    if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer')
    setCalAddStatus('success')
    setTimeout(() => {
      setCalAddStatus('idle')
      setCalendarModalOpen(false)
    }, 3000)
  }

  const isActive   = obj.status === 'active'
  const isPaused   = obj.status === 'paused'
  const isClosed   = obj.status === 'closed' || obj.status === 'abandoned'
  const isArchived = obj.status === 'archived'

  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide mb-1'
  const inputCls = 'w-full px-3 py-2 rounded-lg border text-[13px] focus:outline-none transition-colors'

  return (
    <>
      {/* ── Header controls: gear + action buttons, all in one flex-shrink-0 row ── */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isActive && (
          <>
            <button
              onClick={() => setCloseModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap"
              style={{ background: 'var(--gold)', color: '#0a1628' }}
            >
              Close Goal
            </button>
            <button
              onClick={() => setPauseConfirmOpen(true)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap"
              style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)', backgroundColor: 'transparent' }}
            >
              Pause
            </button>
            <button
              onClick={() => setAbandonModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap"
              style={{ border: '1px solid rgba(200,90,84,.5)', color: '#C85A54', backgroundColor: 'rgba(200,90,84,.06)' }}
            >
              Abandon
            </button>
          </>
        )}
        {isPaused && (
          <button
            onClick={handleResume}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
            style={{ background: 'var(--ov-green)', color: '#0a1628' }}
          >
            <Play size={11} />
            Resume Goal
          </button>
        )}
        <button
          onClick={() => openCalendarModal()}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap flex-shrink-0"
          style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)', backgroundColor: 'transparent' }}
          aria-label="Add to Calendar"
        >
          <CalendarPlus size={13} />
          Add to Calendar
        </button>
        <button
          onClick={openDrawer}
          className="p-2 rounded-lg flex-shrink-0 transition-colors"
          style={{ color: 'var(--ov-text-dim)' }}
          aria-label="Goal settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ── Strike Brief — elk_hunt domain only ── */}
      <StrikeBriefCard objectiveId={obj.id} domain={obj.category} />

      {/* ── Settings drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeDrawer} />
          <div className="relative w-80 h-full shadow-xl flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--ov-navy-card)' }}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--ov-border)' }}>
              {view !== 'menu' ? (
                <button
                  onClick={() => setView('menu')}
                  className="flex items-center gap-1 text-[13px]"
                  style={{ color: 'var(--ov-text-mid)' }}
                >
                  <ChevronLeft size={14} /> Back
                </button>
              ) : (
                <h2 className="text-[15px] font-medium" style={{ color: 'var(--ov-text-hi)' }}>Goal settings</h2>
              )}
              <button onClick={closeDrawer} style={{ color: 'var(--ov-text-dim)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Menu view */}
            {view === 'menu' && (
              <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
                <p className="text-[12px] mb-1 leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>{obj.title}</p>

                <button
                  onClick={() => setView('edit')}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] text-left transition-colors"
                  style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                >
                  <Pencil size={14} style={{ color: 'var(--ov-blue)' }} />
                  Edit goal
                </button>

                <button
                  onClick={() => setView('watch')}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] text-left transition-colors"
                  style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                >
                  <Eye size={14} style={{ color: 'var(--ov-blue)' }} />
                  Watch sources
                  {unseenAlertCount > 0 && (
                    <span
                      className="ml-auto flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: '#C9A227', color: '#0A1628' }}
                    >
                      {unseenAlertCount}
                    </span>
                  )}
                </button>

                {/* Pause — only for active goals, shown in gear as secondary action */}
                {isPaused && (
                  <button
                    onClick={() => { closeDrawer(); handleResume() }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] text-left transition-colors"
                    style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                  >
                    <Play size={14} style={{ color: 'var(--ov-green)' }} />
                    Resume goal
                  </button>
                )}

                {/* Archive — view all completed goals */}
                <Link
                  href="/objectives/archive"
                  onClick={closeDrawer}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] transition-colors"
                  style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                >
                  <RotateCcw size={14} style={{ color: 'var(--ov-text-dim)' }} />
                  View archive
                </Link>

                {/* Reopen / Reactivate — for closed, abandoned, or archived goals */}
                {(isClosed || isArchived) && (
                  <div>
                    {!reopenConfirm ? (
                      <button
                        onClick={() => setReopenConfirm(true)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] text-left transition-colors"
                        style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                      >
                        <RotateCcw size={14} style={{ color: 'var(--ov-green)' }} />
                        {isArchived ? 'Reactivate goal' : 'Reopen goal'}
                      </button>
                    ) : (
                      <div className="rounded-xl p-4 flex flex-col gap-3" style={{ border: '1px solid var(--ov-border-md)', backgroundColor: 'rgba(255,255,255,.03)' }}>
                        <p className="text-[13px]" style={{ color: 'var(--ov-text-hi)' }}>
                          {isArchived ? 'Reactivate this goal?' : 'Reopen this goal?'} It will return to active tracking.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setReopenConfirm(false)}
                            className="flex-1 py-2 rounded-lg text-[12px] transition-colors"
                            style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-dim)' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleReopen}
                            disabled={reopenSaving}
                            className="flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-50"
                            style={{ backgroundColor: 'var(--ov-green)', color: '#0a1628' }}
                          >
                            {reopenSaving ? 'Saving...' : 'Confirm'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Edit view */}
            {view === 'edit' && (
              <div className="flex flex-col flex-1 min-h-0">
              <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">
                {saveError && (
                  <div className="p-3 rounded-lg text-[12px]" style={{ background: 'rgba(200,90,84,.12)', color: '#C85A54' }}>
                    {saveError}
                  </div>
                )}

                <div>
                  <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Title</label>
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className={inputCls}
                    style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                  />
                </div>

                <div>
                  <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Target date</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={e => setTargetDate(e.target.value)}
                    className={inputCls}
                    style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', colorScheme: 'dark' }}
                  />
                </div>

                <div>
                  <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Deadline type</label>
                  <select
                    value={deadlineType}
                    onChange={e => setDeadlineType(e.target.value as 'hard' | 'soft')}
                    className={inputCls}
                    style={{ background: '#0a1628', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', colorScheme: 'dark' }}
                  >
                    <option value="hard">Hard — must complete by date</option>
                    <option value="soft">Soft — reservation / optional (retained is OK)</option>
                  </select>
                </div>

                {deadlineType === 'soft' && (
                  <div>
                    <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Reservation price (floor)</label>
                    <input
                      type="number"
                      value={reservationPrice}
                      onChange={e => setReservation(e.target.value)}
                      placeholder="e.g. 25000"
                      className={inputCls}
                      style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                    />
                    <p className="text-[11px] mt-1" style={{ color: 'var(--ov-text-dim)' }}>
                      Minimum acceptable value. Confidence = P(terms met by this price or better).
                    </p>
                  </div>
                )}

                {isResale && (
                  <>
                    <div style={{ borderTop: '1px solid var(--ov-border)', paddingTop: '12px' }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--ov-text-dim)' }}>Resale pricing</p>
                    </div>
                    <div>
                      <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Listing / asking price</label>
                      <input
                        type="number"
                        value={listingPrice}
                        onChange={e => setListingPrice(e.target.value)}
                        placeholder="e.g. 35000"
                        className={inputCls}
                        style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                      />
                    </div>
                    <div>
                      <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Target sale price</label>
                      <input
                        type="number"
                        value={targetPrice}
                        onChange={e => setTargetPrice(e.target.value)}
                        placeholder="e.g. 30000"
                        className={inputCls}
                        style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                      />
                    </div>
                    <div>
                      <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Floor price (walk-away)</label>
                      <input
                        type="number"
                        value={floorPrice}
                        onChange={e => setFloorPrice(e.target.value)}
                        placeholder="e.g. 25000"
                        className={inputCls}
                        style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                      />
                    </div>
                  </>
                )}

                {location && (
                  <>
                    <div style={{ borderTop: '1px solid var(--ov-border)', paddingTop: '12px' }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--ov-text-dim)' }}>Hunt Location</p>
                      {location.nws_grid_office && location.nws_grid_x != null && location.nws_grid_y != null && (
                        <p className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
                          Current weather grid: {location.nws_grid_office} {location.nws_grid_x},{location.nws_grid_y}
                        </p>
                      )}
                    </div>
                    {locationError && (
                      <div className="p-3 rounded-lg text-[12px]" style={{ background: 'rgba(200,90,84,.12)', color: '#C85A54' }}>
                        {locationError}
                      </div>
                    )}
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Latitude</label>
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={huntLat}
                          onChange={e => { setHuntLat(e.target.value); setLocationConfirm(null) }}
                          placeholder="40.948"
                          className={inputCls}
                          style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                        />
                      </div>
                      <div className="flex-1">
                        <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Longitude</label>
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={huntLon}
                          onChange={e => { setHuntLon(e.target.value); setLocationConfirm(null) }}
                          placeholder="-110.668"
                          className={inputCls}
                          style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] -mt-2" style={{ color: 'var(--ov-text-dim)' }}>
                      Find your coordinates at forecast.weather.gov — click your hunt area and copy lat/lon from the URL
                    </p>
                    <button
                      onClick={handleLocationSave}
                      disabled={locationSaving}
                      className="w-full py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40"
                      style={{ border: '1px solid var(--gold)', color: 'var(--gold)' }}
                    >
                      {locationSaving ? 'Resolving weather grid...' : 'Save location'}
                    </button>
                    {locationConfirm && (
                      <div className="p-3 rounded-lg text-[12px]" style={{ background: 'rgba(76,175,125,.12)', color: '#4CAF7D' }}>
                        {locationConfirm}
                      </div>
                    )}
                  </>
                )}

                <div>
                  <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Personal Notes</label>
                  <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--ov-text-dim)' }}>
                    For your reference only — not analyzed by Meridian
                  </p>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    onBlur={handleNotesBlur}
                    rows={6}
                    className={inputCls}
                    style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', resize: 'none' }}
                  />
                  {notesDateSuggestion && !notesBannerDismissed && (
                    <div
                      className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                      style={{ background: 'rgba(201,162,39,.12)', border: '1px solid rgba(201,162,39,.3)', color: 'rgba(201,162,39,.9)' }}
                    >
                      <span className="flex-1">📅 Detected: {notesDateSuggestion.readable} — Add to calendar?</span>
                      <button
                        onClick={() => { openCalendarModal(notesDateSuggestion.iso); setNotesDateSuggestion(null) }}
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{ background: 'rgba(201,162,39,.25)', color: 'rgba(201,162,39,.95)' }}
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setNotesBannerDismissed(true); setNotesDateSuggestion(null) }}
                        className="px-2 py-0.5 rounded text-[11px]"
                        style={{ color: 'rgba(201,162,39,.7)' }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

              </div>
              <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid var(--ov-border)' }}>
                <button
                  onClick={handleSave}
                  disabled={loading || !title.trim()}
                  className="w-full py-2.5 rounded-xl text-[14px] font-medium transition-colors disabled:opacity-40"
                  style={{ background: 'var(--gold)', color: '#0a1628' }}
                >
                  {loading ? 'Saving...' : 'Save changes'}
                </button>
              </div>
              </div>
            )}

            {/* Watch view */}
            {view === 'watch' && (
              <WatchSourcesPanel
                objectiveId={obj.id}
                tier={tier}
                accountType={accountType}
                initialSources={initialSources}
                smsAlertsEnabled={smsAlertsEnabled}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Close Goal modal ── */}
      {closeModalOpen && (
        <CloseModal
          objectiveId={obj.id}
          objectiveTitle={obj.title}
          objectiveCategory={obj.category}
          objectiveContext={obj.context}
          currentConfidence={obj.confidence}
          onClose={() => setCloseModalOpen(false)}
          onComplete={() => {
            setCloseModalOpen(false)
            router.push('/objectives')
            router.refresh()
          }}
        />
      )}

      {/* ── Abandon Goal modal ── */}
      {abandonModalOpen && (
        <AbandonModal
          objectiveId={obj.id}
          objectiveTitle={obj.title}
          activeChildObjectives={[]}
          onClose={() => setAbandonModalOpen(false)}
          onAbandon={() => {
            setAbandonModalOpen(false)
            router.push('/objectives')
            router.refresh()
          }}
          onArchiveInstead={() => {
            setAbandonModalOpen(false)
            setPauseConfirmOpen(true)
          }}
        />
      )}

      {/* ── Add to Calendar modal ── */}
      {calendarModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setCalendarModalOpen(false)} />
          <div
            className="relative w-full max-w-sm rounded-2xl shadow-xl flex flex-col p-6 gap-4"
            style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: 'var(--ov-text-hi)' }}>
                <CalendarPlus size={15} style={{ color: 'var(--ov-blue)' }} />
                Add to Calendar
              </h2>
              <button onClick={() => setCalendarModalOpen(false)} style={{ color: 'var(--ov-text-dim)' }}>
                <X size={16} />
              </button>
            </div>

            {calAddStatus === 'success' ? (
              <p className="text-[13px] text-center py-4 font-medium" style={{ color: '#4ade80' }}>
                Added to your calendar ✓
              </p>
            ) : (
              <>
                {calAddStatus === 'error' && (
                  <div className="px-3 py-2 rounded-lg text-[12px]" style={{ background: 'rgba(201,162,39,.12)', border: '1px solid rgba(201,162,39,.3)', color: 'rgba(201,162,39,.9)' }}>
                    Calendar not connected — go to Settings to connect
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <div>
                    <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Event Title</label>
                    <input
                      value={calModalTitle}
                      onChange={e => setCalModalTitle(e.target.value)}
                      className={inputCls}
                      style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Date</label>
                      <input
                        type="date"
                        value={calModalDate}
                        onChange={e => setCalModalDate(e.target.value)}
                        className={inputCls}
                        style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', colorScheme: 'dark' }}
                      />
                    </div>
                    <div style={{ width: '110px' }}>
                      <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Time</label>
                      <input
                        type="time"
                        value={calModalTime}
                        onChange={e => setCalModalTime(e.target.value)}
                        className={inputCls}
                        style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', colorScheme: 'dark' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Notes <span style={{ color: 'var(--ov-text-dim)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                    <textarea
                      value={calModalNotes}
                      onChange={e => setCalModalNotes(e.target.value)}
                      rows={3}
                      className={inputCls}
                      style={{ background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', resize: 'none' }}
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setCalendarModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-[13px] transition-colors"
                    style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-dim)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCalendarAdd}
                    disabled={calAddStatus === 'loading' || !calModalTitle.trim() || !calModalDate}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-40"
                    style={{ background: 'var(--gold)', color: '#0a1628' }}
                  >
                    {calAddStatus === 'loading' ? 'Adding...' : 'Add to Calendar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Pause confirm modal ── */}
      {pauseConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPauseConfirmOpen(false)} />
          <div
            className="relative w-full max-w-sm rounded-2xl shadow-xl flex flex-col p-6 gap-5"
            style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)' }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[16px] font-semibold mb-1" style={{ color: 'var(--ov-text-hi)' }}>
                  <Pause size={15} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle', color: 'var(--ov-text-dim)' }} />
                  Pause this goal?
                </h2>
                <p className="text-[12px]" style={{ color: 'var(--ov-text-dim)' }}>{obj.title}</p>
              </div>
              <button onClick={() => setPauseConfirmOpen(false)} style={{ color: 'var(--ov-text-dim)', padding: '2px' }}>
                <X size={16} />
              </button>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
              Meridian won&apos;t check in on this goal while it&apos;s paused, and it won&apos;t count against your active goal limit. You can resume at any time.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPauseConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] transition-colors"
                style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-dim)' }}
              >
                Cancel
              </button>
              <button
                onClick={handlePause}
                disabled={pauseSaving}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--ov-border-md)', color: 'var(--ov-text-hi)' }}
              >
                {pauseSaving ? 'Pausing...' : 'Pause Goal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
