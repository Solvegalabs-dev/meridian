'use client'
import { useState } from 'react'
import { logCaseAction, updateCaseActionOutcome } from '@/app/(app)/enterprise/actions'
import type { CaseAction } from '@/app/(app)/enterprise/report/page'

interface Props {
  institutionId: string
  caseRef: string
  actions: CaseAction[]
  objectives: Array<{ id: string; obj_id: string; title: string }>
}

type Outcome = CaseAction['outcome']

const OUTCOME_LABELS: Record<Outcome, string> = {
  pending:     'Pending',
  complete:    'Complete',
  no_response: 'No Response',
  abandoned:   'Abandoned',
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  seller_contact:  'Seller Contact',
  buyer_contact:   'Buyer Contact',
  price_discussion:'Price Discussion',
  showing_activity:'Showing Activity',
  offer_activity:  'Offer Activity',
  internal_review: 'Internal Review',
}

const OUTCOME_BG: Record<Outcome, string> = {
  pending:     '#FEF9C3',
  complete:    '#DCFCE7',
  no_response: '#F3F4F6',
  abandoned:   '#FEE2E2',
}

const OUTCOME_COLOR: Record<Outcome, string> = {
  pending:     '#854D0E',
  complete:    '#166534',
  no_response: '#4B5563',
  abandoned:   '#991B1B',
}

const C = {
  border:  '#DDE3EE',
  muted:   '#6B7280',
  blue:    '#2D6BE4',
  gold:    '#C8A84B',
  text:    '#1A1A2E',
  bg:      '#F0F3F8',
}

export function CaseActionTracker({ institutionId, caseRef, actions: initialActions, objectives }: Props) {
  const [actions, setActions] = useState<CaseAction[]>(initialActions)
  const [showForm, setShowForm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [actionText, setActionText] = useState('')
  const [actionDate, setActionDate] = useState(new Date().toISOString().split('T')[0])
  const [actionType, setActionType] = useState('')
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!actionText.trim()) return
    setSaving(true)
    const result = await logCaseAction(
      institutionId,
      caseRef,
      actionText.trim(),
      actionDate,
      selectedObjectiveId || null,
      actionType
    )
    if (result.ok) {
      const optimistic: CaseAction = {
        id: crypto.randomUUID(),
        case_ref: caseRef,
        objective_id: selectedObjectiveId || null,
        action_type: actionType,
        action_text: actionText.trim(),
        action_date: actionDate,
        outcome: 'pending',
        outcome_note: null,
        outcome_date: null,
        created_at: new Date().toISOString(),
      }
      setActions(prev => [optimistic, ...prev])
      setActionText('')
      setSelectedObjectiveId('')
      setShowForm(false)
      setShowHistory(true)
    }
    setSaving(false)
  }

  async function handleOutcomeChange(actionId: string, outcome: Outcome, outcomeNote: string | null) {
    await updateCaseActionOutcome(actionId, outcome, outcomeNote)
    setActions(prev => prev.map(a =>
      a.id === actionId ? { ...a, outcome, outcome_note: outcomeNote } : a
    ))
  }

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0B1829' }}>
      {/* Toolbar */}
      <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => { setShowForm(f => !f); setShowHistory(false) }}
          style={{ padding: '3px 9px', borderRadius: 5, border: `1px solid ${C.gold}`, background: showForm ? C.gold : 'rgba(201,162,39,0.12)', color: showForm ? 'white' : C.gold, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          + Log Action
        </button>
        {actions.length > 0 && (
          <button
            onClick={() => { setShowHistory(h => !h); setShowForm(false) }}
            style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.15)', background: showHistory ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Actions ({actions.length})
          </button>
        )}
      </div>

      {/* Log form */}
      {showForm && (
        <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            placeholder="Describe the action taken (e.g. Called seller re: price reduction)"
            value={actionText}
            onChange={e => setActionText(e.target.value)}
            rows={2}
            style={{ width: '100%', fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit', color: '#111111', outline: 'none', boxSizing: 'border-box' }}
          />
          <select
            value={actionType}
            onChange={e => setActionType(e.target.value)}
            style={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 7px', fontFamily: 'inherit', color: C.text, width: '100%' }}
          >
            <option value="">Action Type</option>
            {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="date"
              value={actionDate}
              onChange={e => setActionDate(e.target.value)}
              style={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 7px', fontFamily: 'inherit', color: C.text }}
            />
            <select
              value={selectedObjectiveId}
              onChange={e => setSelectedObjectiveId(e.target.value)}
              style={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 7px', fontFamily: 'inherit', color: C.text, flex: 1 }}
            >
              <option value="">No objective</option>
              {objectives.map(obj => (
                <option key={obj.id} value={obj.id}>
                  {obj.obj_id} · {obj.title.slice(0, 35)}
                </option>
              ))}
            </select>
            <button
              onClick={handleSave}
              disabled={saving || !actionText.trim()}
              style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#ffffff', fontSize: 10, fontWeight: 700, cursor: saving || !actionText.trim() ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: saving || !actionText.trim() ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : 'Log Action'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action history */}
      {showHistory && actions.length > 0 && (
        <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {actions.map(action => {
            const obj = objectives.find(o => o.id === action.objective_id)
            return (
              <div key={action.id} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{action.action_date}</span>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: '#EEF2FF', color: '#3730A3' }}>
                    {ACTION_TYPE_LABELS[action.action_type] ?? action.action_type}
                  </span>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: OUTCOME_BG[action.outcome], color: OUTCOME_COLOR[action.outcome] }}>
                    {OUTCOME_LABELS[action.outcome]}
                  </span>
                  {obj && (
                    <span style={{ fontSize: 9, color: C.gold, fontWeight: 700 }}>{obj.obj_id}</span>
                  )}
                  <select
                    value={action.outcome}
                    onChange={e => handleOutcomeChange(action.id, e.target.value as Outcome, action.outcome_note)}
                    style={{ marginLeft: 'auto', fontSize: 9, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 4px', fontFamily: 'inherit', color: C.muted, cursor: 'pointer' }}
                  >
                    <option value="pending">Pending</option>
                    <option value="complete">Complete</option>
                    <option value="no_response">No Response</option>
                    <option value="abandoned">Abandoned</option>
                  </select>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>{action.action_text}</div>
                {action.outcome_note && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 3, fontStyle: 'italic' }}>{action.outcome_note}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
