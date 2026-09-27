'use client'

import { useState } from 'react'
import { Trash2, Lock, Check, AlertCircle } from 'lucide-react'
import { tierAtLeast, getEffectiveTier } from '@/lib/tiers'
import { timeAgo } from '@/lib/utils/timeAgo'

export type WatchSource = {
  id: string
  url_provided: string
  url_resolved: string | null
  url_resolved_at: string | null
  priority_tier: number
  watch_type: string
  target_signal: string | null
  last_state: string
  last_checked_at: string | null
  requires_confirmation: boolean
  is_active: boolean
}

interface Props {
  objectiveId: string
  tier: string
  accountType: string | null
  initialSources: WatchSource[]
  smsAlertsEnabled?: boolean
}

const WATCH_TYPE_LABELS: Record<string, string> = {
  careers_listing: 'Hiring / Job Listing',
  registration:    'Registration',
  status_page:     'Status Page',
  custom:          'Other',
}

const STATE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  signal_confirmed: { bg: 'rgba(82,196,84,0.12)',   color: 'var(--ov-green)',    label: 'Confirmed' },
  signal_detected:  { bg: 'rgba(217,162,60,0.12)',  color: 'var(--ov-amber)',   label: 'Detected'  },
  no_signal:        { bg: 'rgba(255,255,255,0.06)', color: 'var(--ov-text-dim)', label: 'No signal' },
  signal_gone:      { bg: 'rgba(200,90,84,0.12)',   color: 'var(--ov-red)',     label: 'Gone'      },
}

const TIER_STYLES: Record<number, { bg: string; color: string; border?: string; label: string }> = {
  1: { bg: 'var(--gold)',                   color: '#0a1628',              label: 'T1' },
  2: { bg: '#0a1628',                       color: '#fff',                 border: '1px solid var(--ov-border-md)', label: 'T2' },
  3: { bg: 'rgba(255,255,255,0.06)',        color: 'var(--ov-text-dim)', label: 'T3' },
}

// Max watch sources per effective tier
const TIER_LIMITS: Record<string, number> = {
  trial:       1,
  explorer:    5,
  accelerator: 15,
  command:     25,
  enterprise:  Infinity,
}

export default function WatchSourcesPanel({
  objectiveId,
  tier,
  accountType,
  initialSources,
  smsAlertsEnabled = false,
}: Props) {
  const canAdd        = tierAtLeast({ tier, account_type: accountType }, 'explorer')
  const effectiveTier = getEffectiveTier({ tier, account_type: accountType })
  const sourceLimit   = TIER_LIMITS[effectiveTier] ?? 1
  const smsLocked     = effectiveTier === 'trial' || effectiveTier === 'explorer'

  const [sources,      setSources]      = useState<WatchSource[]>(initialSources)
  const [urlInput,     setUrlInput]     = useState('')
  const [signalInput,  setSignalInput]  = useState('')
  const [tierSelect,   setTierSelect]   = useState<number>(2)
  const [typeSelect,   setTypeSelect]   = useState('careers_listing')
  const [adding,       setAdding]       = useState(false)
  const [addError,     setAddError]     = useState<string | null>(null)
  const [removingId,   setRemovingId]   = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // Tracks the ID of a source just saved at High/Reference priority when SMS is enabled.
  // Clears on next load (state not persisted).
  const [smsTierNoteId, setSmsTierNoteId] = useState<string | null>(null)

  const atLimit = sourceLimit !== Infinity && sources.length >= sourceLimit

  async function handleAdd() {
    if (!urlInput.trim()) return
    setAdding(true)
    setAddError(null)

    const res = await fetch('/api/watch-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objectiveId,
        urlProvided:  urlInput.trim(),
        targetSignal: signalInput.trim() || null,
        priorityTier: tierSelect,
        watchType:    typeSelect,
      }),
    })

    setAdding(false)

    if (!res.ok) {
      const d = await res.json() as { error?: string }
      setAddError(d.error ?? 'Failed to add watch source')
      return
    }

    const newSource = await res.json() as WatchSource
    setSources(prev => [newSource, ...prev])
    setUrlInput('')
    setSignalInput('')
    setTierSelect(2)
    setTypeSelect('careers_listing')

    // Show SMS upgrade note if user has SMS enabled but saved a non-Critical source
    if (smsAlertsEnabled && newSource.priority_tier > 1) {
      setSmsTierNoteId(newSource.id)
    }
  }

  async function handleRemove(id: string) {
    if (removingId) return
    setRemovingId(id)
    await fetch(`/api/watch-sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove' }),
    })
    setSources(prev => prev.filter(s => s.id !== id))
    if (smsTierNoteId === id) setSmsTierNoteId(null)
    setRemovingId(null)
  }

  async function handleConfirm(id: string) {
    if (confirmingId) return
    setConfirmingId(id)
    await fetch(`/api/watch-sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    setSources(prev =>
      prev.map(s => s.id === id ? { ...s, requires_confirmation: false } : s)
    )
    setConfirmingId(null)
  }

  const labelCls  = 'block text-[11px] font-semibold uppercase tracking-wide mb-1'
  const inputCls  = 'w-full px-3 py-2 rounded-lg border text-[13px] focus:outline-none transition-colors'
  const inputStyle = { background: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)' }

  return (
    <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">

      {/* Count display (hidden for unlimited enterprise tier) */}
      {canAdd && sourceLimit !== Infinity && (
        <p className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
          {sources.length} of {sourceLimit} watch sources
        </p>
      )}

      {/* Onboarding prompt — shown above add form when no sources configured */}
      {sources.length === 0 && (
        <div
          className="rounded-xl p-3 text-[12px] leading-relaxed"
          style={{ background: 'rgba(217,162,60,0.08)', border: '1px solid rgba(217,162,60,0.2)', color: 'var(--ov-text-mid)' }}
        >
          No watch sources configured. For time-sensitive goals like this one, pin the exact page you need monitored — I&apos;ll check it on every sweep and alert you the moment the status changes.
        </div>
      )}

      {/* Source list */}
      {sources.length > 0 && (
        <div className="flex flex-col gap-3">
          {sources.map(src => {
            const ts = TIER_STYLES[src.priority_tier] ?? TIER_STYLES[3]
            const ss = STATE_STYLES[src.last_state] ?? STATE_STYLES['no_signal']

            return (
              <div key={src.id} className="flex flex-col gap-1.5">
                <div
                  className="rounded-xl p-3 flex flex-col gap-2"
                  style={{ border: '1px solid var(--ov-border-md)', background: 'var(--ov-navy)' }}
                >
                  {/* Row 1: tier badge + url_provided → url_resolved */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: ts.bg, color: ts.color, border: ts.border }}
                    >
                      {ts.label}
                    </span>
                    <span
                      className="text-[12px] flex-shrink-0 max-w-[90px] truncate"
                      style={{ color: 'var(--ov-text-hi)' }}
                      title={src.url_provided}
                    >
                      {src.url_provided}
                    </span>
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--ov-text-dim)' }}>→</span>
                    {src.url_resolved ? (
                      <a
                        href={src.url_resolved}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] flex-1 truncate min-w-0"
                        style={{ color: 'var(--ov-text-dim)' }}
                        title={src.url_resolved}
                      >
                        {src.url_resolved.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      <span className="text-[11px] italic flex-shrink-0" style={{ color: 'var(--ov-text-dim)' }}>
                        resolving...
                      </span>
                    )}
                  </div>

                  {/* Row 2: type label + state badge + last checked + remove */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
                      {WATCH_TYPE_LABELS[src.watch_type] ?? src.watch_type}
                    </span>
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{ background: ss.bg, color: ss.color }}
                    >
                      {ss.label}
                    </span>
                    {src.last_checked_at && (
                      <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
                        {timeAgo(src.last_checked_at)}
                      </span>
                    )}
                    <button
                      onClick={() => handleRemove(src.id)}
                      disabled={removingId === src.id}
                      className="ml-auto flex-shrink-0 opacity-40 hover:opacity-80 transition-opacity disabled:opacity-20"
                      style={{ color: 'var(--ov-red)' }}
                      aria-label="Remove watch source"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Requires confirmation inline notice */}
                  {src.requires_confirmation && src.url_resolved && (
                    <div
                      className="rounded-lg p-2.5 flex flex-col gap-2"
                      style={{ background: 'rgba(217,162,60,0.08)', border: '1px solid rgba(217,162,60,0.2)' }}
                    >
                      <p className="text-[11px]" style={{ color: 'var(--ov-amber)' }}>
                        I found a likely URL — please confirm before monitoring starts.
                      </p>
                      <p className="text-[10px] break-all" style={{ color: 'var(--ov-text-mid)' }}>
                        {src.url_resolved}
                      </p>
                      <button
                        onClick={() => handleConfirm(src.id)}
                        disabled={confirmingId === src.id}
                        className="flex items-center gap-1 text-[11px] font-medium py-1 px-2.5 rounded-lg self-start transition-colors disabled:opacity-40"
                        style={{ background: 'rgba(217,162,60,0.2)', color: 'var(--ov-amber)' }}
                      >
                        <Check size={11} />
                        {confirmingId === src.id ? 'Confirming...' : 'Confirm URL'}
                      </button>
                    </div>
                  )}
                </div>

                {/* SMS tier note — shown once after saving a High/Reference source when SMS is enabled */}
                {smsTierNoteId === src.id && (
                  <div
                    className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
                    style={{ background: 'rgba(217,162,60,0.08)', border: '1px solid rgba(217,162,60,0.2)', color: 'var(--ov-amber)' }}
                  >
                    This source is set to High priority — SMS alerts only fire on Critical sources. Change to Critical to receive SMS.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add form section */}
      <div style={{ borderTop: '1px solid var(--ov-border)', paddingTop: '16px' }}>
        {!canAdd ? (
          <div
            className="rounded-xl p-3 flex items-start gap-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ov-border)' }}
          >
            <Lock size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--ov-text-dim)' }} />
            <p className="text-[12px]" style={{ color: 'var(--ov-text-dim)' }}>
              Watch sources available on{' '}
              <span style={{ color: 'var(--ov-text-hi)' }}>Explorer and above</span>.
            </p>
          </div>
        ) : atLimit ? (
          <div
            className="rounded-xl p-3 flex items-start gap-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ov-border)' }}
          >
            <Lock size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--ov-text-dim)' }} />
            <p className="text-[12px]" style={{ color: 'var(--ov-text-dim)' }}>
              Watch source limit reached for your plan.{' '}
              <span style={{ color: 'var(--ov-text-hi)' }}>Upgrade to add more.</span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ov-text-dim)' }}>
              Add watch source
            </p>

            <div>
              <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>URL or company name</label>
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="e.g. https://careers.company.com"
                className={inputCls}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>What to look for</label>
              <input
                value={signalInput}
                onChange={e => setSignalInput(e.target.value)}
                placeholder="e.g. specific job title, keyword, or announcement to watch for"
                className={inputCls}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Priority</label>
              <select
                value={tierSelect}
                onChange={e => setTierSelect(Number(e.target.value))}
                className={inputCls}
                style={inputStyle}
              >
                <option value={1} style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>Critical (1)</option>
                <option value={2} style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>High (2)</option>
                <option value={3} style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>Reference (3)</option>
              </select>
              {/* SMS lock notice for Trial / Explorer */}
              {smsLocked && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Lock size={10} style={{ color: 'var(--ov-text-dim)' }} />
                  <p className="text-[10px]" style={{ color: 'var(--ov-text-dim)' }}>
                    SMS alerts require{' '}
                    <span style={{ color: 'var(--ov-text-mid)' }}>Accelerator or above</span>.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls} style={{ color: 'var(--ov-text-dim)' }}>Watch type</label>
              <select
                value={typeSelect}
                onChange={e => setTypeSelect(e.target.value)}
                className={inputCls}
                style={inputStyle}
              >
                <option value="careers_listing" style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>Hiring / Job Listing</option>
                <option value="registration" style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>Registration</option>
                <option value="status_page" style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>Status Page</option>
                <option value="custom" style={{ backgroundColor: '#0a1628', color: '#f0f0f0' }}>Other</option>
              </select>
            </div>

            {addError && (
              <div
                className="flex items-start gap-2 p-2.5 rounded-lg text-[11px]"
                style={{ background: 'rgba(200,90,84,0.12)', color: '#C85A54' }}
              >
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                {addError}
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={adding || !urlInput.trim()}
              className="w-full py-2.5 rounded-xl text-[14px] font-medium transition-colors disabled:opacity-40"
              style={{ background: 'var(--gold)', color: '#0a1628' }}
            >
              {adding ? 'Saving...' : 'Save watch source'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
