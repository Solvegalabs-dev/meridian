// components/enterprise/ManageObjectivesPanel.tsx
// FF-050: Slide-over panel for managing enterprise objectives.
// Admin only. Opened by "Manage Objectives" button in EnterprisePortalClient.
// Two tabs: Active (list + reorder + inline edit + add new) | History (retired/dropped + reactivate)

'use client'

import { useEffect, useState, useCallback } from 'react'
import { RetireModal } from './RetireModal'
import { DropModal } from './DropModal'

// ── Types ────────────────────────────────────────────────────────────────────

type LifecycleState = 'active' | 'retired' | 'dropped'
type ObjState = 'focus' | 'monitoring_lite' | 'paused'

interface ActiveObjective {
  id: string
  obj_id: string
  title: string
  statement: string
  objective_state: ObjState
  objective_order: number
  case_scope: string | null
  lite_sweep_cadence_days: number | null
  alert_threshold: Record<string, unknown> | null
  status: string
  lifecycle_state: LifecycleState | null
  created_at: string
}

interface HistoryObjective {
  id: string
  obj_id: string
  title: string
  statement: string
  objective_state: ObjState
  case_scope: string | null
  status: string
  lifecycle_state: LifecycleState | null
  lifecycle_changed_at: string | null
  lifecycle_reason: string | null
  lifecycle_notes: string | null
}

// ── Vertical-aware case_scope options ────────────────────────────────────────

const CASE_SCOPE_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  real_estate: [
    { value: 'all_active', label: 'All Active Cases' },
    { value: 'stale_listings', label: 'Stale Listings (DOM ≥ 45)' },
    { value: 'rate_lock_at_risk', label: 'Rate Lock at Risk' },
    { value: 'listings_only', label: 'Listings Only' },
    { value: 'buyers_only', label: 'Buyers Only' },
  ],
  auto_finance: [
    { value: 'all_active', label: 'All Active Cases' },
    { value: 'delinquent', label: 'Delinquent (30+ DPD)' },
    { value: 'high_risk', label: 'High Risk (CRITICAL / ALERT)' },
    { value: 'stable', label: 'Stable Cases' },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StateBadge({ state }: { state: ObjState }) {
  const map: Record<ObjState, { label: string; color: string; bg: string }> = {
    focus:           { label: 'Focus',            color: '#60a5fa', bg: 'rgba(37,99,235,.2)' },
    monitoring_lite: { label: 'Monitoring Lite',  color: '#a78bfa', bg: 'rgba(124,58,237,.15)' },
    paused:          { label: 'Paused',            color: '#6b7280', bg: 'rgba(75,85,99,.2)' },
  }
  const { label, color, bg } = map[state] ?? map.paused
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color, background: bg }}>{label}</span>
  )
}

function LifecycleBadge({ state }: { state: LifecycleState | null }) {
  if (!state || state === 'active') return null
  const map: Record<string, { label: string; color: string; bg: string }> = {
    retired: { label: 'Retired', color: '#34d399', bg: 'rgba(16,185,129,.15)' },
    dropped: { label: 'Dropped', color: '#f97316', bg: 'rgba(249,115,22,.15)' },
  }
  const { label, color, bg } = map[state] ?? { label: state, color: '#6b7280', bg: 'rgba(75,85,99,.2)' }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
      style={{ color, background: bg }}>{label}</span>
  )
}

// ── Inline Edit Row ────────────────────────────────────────────────────────────

function EditRow({
  obj,
  scopeOptions,
  onSave,
  onCancel,
}: {
  obj: ActiveObjective
  scopeOptions: Array<{ value: string; label: string }>
  onSave: (updates: Partial<ActiveObjective>) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(obj.title)
  const [statement, setStatement] = useState(obj.statement)
  const [caseScope, setCaseScope] = useState(obj.case_scope ?? '')
  const [alertThreshold, setAlertThreshold] = useState(
    obj.alert_threshold ? JSON.stringify(obj.alert_threshold, null, 2) : ''
  )
  const [saving, setSaving] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const handleSave = async () => {
    setParseError(null)
    let parsedThreshold: Record<string, unknown> | null = null
    if (alertThreshold.trim()) {
      try {
        parsedThreshold = JSON.parse(alertThreshold)
      } catch {
        setParseError('Invalid JSON in alert threshold')
        return
      }
    }
    setSaving(true)
    await onSave({
      title,
      statement,
      case_scope: caseScope || null,
      alert_threshold: parsedThreshold,
    })
    setSaving(false)
  }

  return (
    <div className="px-4 py-3 bg-gray-800/60 border border-blue-800/40 rounded-xl space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Case Scope</label>
          <select
            value={caseScope}
            onChange={e => setCaseScope(e.target.value)}
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors"
          >
            <option value="">— no scope filter —</option>
            {scopeOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Statement</label>
        <textarea
          value={statement}
          onChange={e => setStatement(e.target.value)}
          rows={2}
          className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors resize-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
          Alert Threshold <span className="text-gray-600 normal-case font-normal">(JSON — e.g. {'{'}dom_over_45_count: 3{'}'})</span>
        </label>
        <textarea
          value={alertThreshold}
          onChange={e => setAlertThreshold(e.target.value)}
          rows={2}
          placeholder='{"dom_over_45_count": 3}'
          className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-300 outline-none focus:border-blue-600 transition-colors resize-none"
        />
        {parseError && <div className="text-xs text-red-400 mt-1">{parseError}</div>}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition disabled:opacity-40">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving || !title.trim()}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white font-semibold transition">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ── Add New Form ────────────────────────────────────────────────────────────────

function AddNewForm({
  scopeOptions,
  onAdd,
}: {
  scopeOptions: Array<{ value: string; label: string }>
  onAdd: (fields: {
    title: string
    statement: string
    objective_state: 'focus' | 'monitoring_lite'
    case_scope: string | null
    lite_sweep_cadence_days: number | null
    alert_threshold: Record<string, unknown> | null
  }) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [statement, setStatement] = useState('')
  const [objState, setObjState] = useState<'focus' | 'monitoring_lite'>('monitoring_lite')
  const [caseScope, setCaseScope] = useState('')
  const [cadence, setCadence] = useState('')
  const [alertThreshold, setAlertThreshold] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setTitle(''); setStatement(''); setObjState('monitoring_lite')
    setCaseScope(''); setCadence(''); setAlertThreshold('')
    setError(null)
  }

  const handleAdd = async () => {
    setError(null)
    let parsedThreshold: Record<string, unknown> | null = null
    if (alertThreshold.trim()) {
      try { parsedThreshold = JSON.parse(alertThreshold) }
      catch { setError('Invalid JSON in alert threshold'); return }
    }
    setAdding(true)
    try {
      await onAdd({
        title: title.trim(),
        statement: statement.trim(),
        objective_state: objState,
        case_scope: caseScope || null,
        lite_sweep_cadence_days: cadence ? parseInt(cadence, 10) : null,
        alert_threshold: parsedThreshold,
      })
      reset()
      setOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add objective')
    } finally {
      setAdding(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-sm text-blue-400 hover:text-blue-300 border border-dashed border-gray-700 hover:border-blue-700 rounded-xl px-4 py-3 transition-colors text-left"
      >
        + Add New Objective
      </button>
    )
  }

  return (
    <div className="border border-blue-800/50 rounded-xl bg-gray-800/40 p-4 space-y-3">
      <div className="text-xs font-bold text-blue-400 uppercase tracking-wide">New Objective</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Title <span className="text-red-500">*</span></label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Stale Listing Risk Intelligence"
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Initial State</label>
          <select value={objState} onChange={e => setObjState(e.target.value as 'focus' | 'monitoring_lite')}
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors">
            <option value="monitoring_lite">Monitoring Lite</option>
            <option value="focus">Focus</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Case Scope</label>
          <select value={caseScope} onChange={e => setCaseScope(e.target.value)}
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors">
            <option value="">— no scope filter —</option>
            {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Statement <span className="text-red-500">*</span></label>
          <textarea value={statement} onChange={e => setStatement(e.target.value)}
            rows={2} placeholder="What intelligence should this objective surface?"
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors resize-none" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Lite Cadence (days)</label>
          <input value={cadence} onChange={e => setCadence(e.target.value)} type="number" min={1} max={30}
            placeholder="7"
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-600 transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Alert Threshold (JSON)</label>
          <input value={alertThreshold} onChange={e => setAlertThreshold(e.target.value)}
            placeholder='{"dom_over_45_count": 3}'
            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-200 outline-none focus:border-blue-600 transition-colors" />
        </div>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button onClick={() => { reset(); setOpen(false) }} disabled={adding}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition disabled:opacity-40">
          Cancel
        </button>
        <button onClick={handleAdd} disabled={adding || !title.trim() || !statement.trim()}
          className="text-xs px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white font-semibold transition">
          {adding ? 'Adding…' : 'Add Objective'}
        </button>
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

interface ManageObjectivesPanelProps {
  open: boolean
  onClose: () => void
  institutionId: string
  verticalType?: string
  onObjectivesChanged: () => void
}

type Tab = 'active' | 'history'

export function ManageObjectivesPanel({
  open,
  onClose,
  institutionId,
  verticalType = 'auto_finance',
  onObjectivesChanged,
}: ManageObjectivesPanelProps) {
  const [tab, setTab] = useState<Tab>('active')
  const [active, setActive] = useState<ActiveObjective[]>([])
  const [history, setHistory] = useState<HistoryObjective[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [retiringObj, setRetiringObj] = useState<ActiveObjective | null>(null)
  const [droppingObj, setDroppingObj] = useState<ActiveObjective | null>(null)
  const [reorderLoading, setReorderLoading] = useState(false)

  const scopeOptions =
    CASE_SCOPE_OPTIONS[verticalType] ?? CASE_SCOPE_OPTIONS.auto_finance

  // ── Fetch ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/enterprise/objectives?institution_id=${institutionId}`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Failed to load objectives')
      }
      const data = await res.json() as { active: ActiveObjective[]; history: HistoryObjective[] }
      setActive(data.active ?? [])
      setHistory(data.history ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [institutionId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // ── Reorder ───────────────────────────────────────────────────────────────

  const moveObj = async (index: number, direction: -1 | 1) => {
    const swap = index + direction
    if (swap < 0 || swap >= active.length) return

    const reordered = [...active]
    ;[reordered[index], reordered[swap]] = [reordered[swap], reordered[index]]
    const withOrder = reordered.map((o, i) => ({ ...o, objective_order: i + 1 }))
    setActive(withOrder)

    setReorderLoading(true)
    try {
      const res = await fetch('/api/enterprise/objectives/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institution_id: institutionId,
          order: withOrder.map(o => ({ id: o.id, objective_order: o.objective_order })),
        }),
      })
      if (!res.ok) throw new Error('Reorder failed')
      onObjectivesChanged()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reorder failed')
      await load() // restore
    } finally {
      setReorderLoading(false)
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  const handleEdit = async (id: string, updates: Partial<ActiveObjective>) => {
    const res = await fetch(`/api/enterprise/objectives/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: institutionId, ...updates }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? 'Edit failed')
    }
    setEditingId(null)
    await load()
    onObjectivesChanged()
  }

  // ── Add New ───────────────────────────────────────────────────────────────

  const handleAdd = async (fields: Parameters<typeof AddNewForm>[0]['onAdd'] extends (f: infer F) => unknown ? F : never) => {
    const res = await fetch('/api/enterprise/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: institutionId, ...fields }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? 'Create failed')
    }
    await load()
    onObjectivesChanged()
  }

  // ── Retire ────────────────────────────────────────────────────────────────

  const handleRetire = async (params: {
    lifecycle_reason: string
    lifecycle_notes: string | null
    run_final_sweep: boolean
  }) => {
    if (!retiringObj) return
    const res = await fetch(`/api/enterprise/objectives/${retiringObj.id}/retire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: institutionId, ...params }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? 'Retire failed')
    }
    setRetiringObj(null)
    await load()
    onObjectivesChanged()
  }

  // ── Drop ──────────────────────────────────────────────────────────────────

  const handleDrop = async (params: {
    lifecycle_reason: string
    lifecycle_notes: string | null
  }) => {
    if (!droppingObj) return
    const res = await fetch(`/api/enterprise/objectives/${droppingObj.id}/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: institutionId, ...params }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? 'Drop failed')
    }
    setDroppingObj(null)
    await load()
    onObjectivesChanged()
  }

  // ── Reactivate ────────────────────────────────────────────────────────────

  const handleReactivate = async (id: string) => {
    const res = await fetch(`/api/enterprise/objectives/${id}/reactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: institutionId }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Reactivate failed')
      return
    }
    setTab('active')
    await load()
    onObjectivesChanged()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-over */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl flex flex-col bg-gray-950 border-l border-gray-800 shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-bold text-white">Manage Objectives</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {active.length} active · {history.length} in history
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 flex-shrink-0">
          {(['active', 'history'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 text-sm py-2.5 font-medium transition-colors capitalize ${
                tab === t
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'active'
                ? `Active (${active.length})`
                : `History (${history.length})`}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-3 text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400">×</button>
          </div>
        )}

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (

            // ── Active tab ────────────────────────────────────────────────

            tab === 'active' ? (
              <>
                {active.length === 0 && (
                  <div className="text-sm text-gray-600 text-center py-8">
                    No active objectives yet.
                  </div>
                )}

                {active.map((obj, index) => (
                  <div key={obj.id}>
                    {editingId === obj.id ? (
                      <EditRow
                        obj={obj}
                        scopeOptions={scopeOptions}
                        onSave={updates => handleEdit(obj.id, updates)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 group">
                        <div className="flex items-start gap-2">
                          {/* Reorder buttons */}
                          <div className="flex flex-col gap-0.5 pt-0.5 flex-shrink-0">
                            <button
                              onClick={() => moveObj(index, -1)}
                              disabled={index === 0 || reorderLoading}
                              className="text-gray-700 hover:text-gray-400 disabled:opacity-20 transition text-xs leading-none"
                              title="Move up"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => moveObj(index, 1)}
                              disabled={index === active.length - 1 || reorderLoading}
                              className="text-gray-700 hover:text-gray-400 disabled:opacity-20 transition text-xs leading-none"
                              title="Move down"
                            >
                              ▼
                            </button>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-mono text-gray-600">{obj.obj_id}</span>
                              <StateBadge state={obj.objective_state} />
                              {obj.case_scope && (
                                <span className="text-[10px] text-gray-600 font-mono">
                                  {obj.case_scope}
                                </span>
                              )}
                            </div>
                            <div className="text-sm font-medium text-gray-200 mt-1 leading-snug">
                              {obj.title}
                            </div>
                            <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                              {obj.statement}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex-shrink-0 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditingId(obj.id)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setRetiringObj(obj)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-400 hover:text-emerald-300 transition"
                            >
                              Retire
                            </button>
                            <button
                              onClick={() => setDroppingObj(obj)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-orange-900/30 hover:bg-orange-800/50 text-orange-400 hover:text-orange-300 transition"
                            >
                              Drop
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add New form always shown at bottom */}
                <div className="pt-1">
                  <AddNewForm scopeOptions={scopeOptions} onAdd={handleAdd} />
                </div>
              </>
            ) : (

              // ── History tab ───────────────────────────────────────────────

              <>
                {history.length === 0 && (
                  <div className="text-sm text-gray-600 text-center py-8">
                    No retired or dropped objectives yet.
                  </div>
                )}

                {history.map(obj => (
                  <div key={obj.id}
                    className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-gray-600">{obj.obj_id}</span>
                          <StateBadge state={obj.objective_state} />
                          <LifecycleBadge state={obj.lifecycle_state} />
                        </div>
                        <div className="text-sm font-medium text-gray-400 mt-1 leading-snug">
                          {obj.title}
                        </div>
                        {obj.lifecycle_reason && (
                          <div className="text-xs text-gray-600 mt-1">
                            Reason: {obj.lifecycle_reason.replace(/_/g, ' ')}
                          </div>
                        )}
                        {obj.lifecycle_notes && (
                          <div className="text-xs text-gray-700 italic mt-0.5">{obj.lifecycle_notes}</div>
                        )}
                        <div className="text-[10px] text-gray-700 mt-1">
                          {obj.lifecycle_state === 'retired' ? 'Retired' : 'Dropped'}{' '}
                          {fmtDate(obj.lifecycle_changed_at)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleReactivate(obj.id)}
                        className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-700 hover:border-blue-600 text-gray-400 hover:text-blue-400 transition whitespace-nowrap"
                      >
                        Reactivate
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )
          )}
        </div>
      </div>

      {/* Retire modal */}
      {retiringObj && (
        <RetireModal
          objectiveId={retiringObj.id}
          objectiveTitle={retiringObj.title}
          objectiveState={retiringObj.objective_state}
          institutionId={institutionId}
          onConfirm={handleRetire}
          onClose={() => setRetiringObj(null)}
        />
      )}

      {/* Drop modal */}
      {droppingObj && (
        <DropModal
          objectiveId={droppingObj.id}
          objectiveTitle={droppingObj.title}
          institutionId={institutionId}
          onConfirm={handleDrop}
          onClose={() => setDroppingObj(null)}
        />
      )}
    </>
  )
}
