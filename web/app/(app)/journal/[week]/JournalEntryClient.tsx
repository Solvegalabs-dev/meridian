'use client'

import { useState, useCallback } from 'react'
import { CheckCircle, Save } from 'lucide-react'

interface Objective {
  id: string
  obj_id: string
  title: string
  confidence: number
  confidence_prev: number | null
}

interface ActionStatusEntry {
  obj: string
  action: string
  status: string
}

interface JournalNarrative {
  concerns: string
  questions: string
  key_insight: string
}

interface ConfidenceUpdate {
  prev: number
  new: number
  reason: string
}

interface CompletedAction {
  action: string
  completed: boolean
}

interface JournalEntry {
  entry_number: number
  week_of: string | null
  section_a: string | null
  section_b: string | null
  section_c: ActionStatusEntry[] | null
  section_d: JournalNarrative | null
  section_e: string | null
  section_f: string | null
  section_g: string | null
  section_h_rating: number | null
  section_h_notes: string | null
  completed_actions: CompletedAction[] | null
  confidence_updates: Record<string, ConfidenceUpdate> | null
  is_complete: boolean
}

interface Props {
  week: number
  weekOf: string
  initialEntry: JournalEntry | null
  objectives: Objective[]
}

// journal_entries' section_c/section_d/completed_actions/confidence_updates
// columns are untyped jsonb. Real production rows (weeks 1-3) hold genuine
// historical content in shapes earlier versions of this page didn't expect
// — validate the actual shape before trusting it, rather than casting.
function asActionStatusArray(value: unknown): ActionStatusEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((e): e is ActionStatusEntry =>
    typeof e === 'object' && e !== null && typeof (e as ActionStatusEntry).action === 'string'
  )
}

function asNarrative(value: unknown): JournalNarrative {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { concerns: '', questions: '', key_insight: '' }
  }
  const v = value as Partial<JournalNarrative>
  return {
    concerns: v.concerns ?? '',
    questions: v.questions ?? '',
    key_insight: v.key_insight ?? '',
  }
}

function asConfidenceUpdates(value: unknown): Record<string, ConfidenceUpdate> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, ConfidenceUpdate>
}

function asCompletedActions(value: unknown): CompletedAction[] {
  if (!Array.isArray(value)) return []
  return value.filter((e): e is CompletedAction =>
    typeof e === 'object' && e !== null && typeof (e as CompletedAction).action === 'string'
  )
}

function Section({ label, letter, children }: { label: string; letter?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="px-5 py-3 bg-[var(--gray-lt)] border-b border-[var(--border)] flex items-center gap-2">
        {letter && (
          <span className="text-[11px] font-mono font-semibold text-[var(--blue)] bg-[#E6F1FB] px-2 py-0.5 rounded">{letter}</span>
        )}
        <span className="text-[12px] font-semibold text-[var(--text2)] uppercase tracking-wide">{label}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export default function JournalEntryClient({ week, weekOf, initialEntry, objectives }: Props) {
  const [entry, setEntry] = useState<Partial<JournalEntry>>(initialEntry ?? { entry_number: week, is_complete: false })
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [isComplete, setIsComplete] = useState(initialEntry?.is_complete ?? false)

  const save = useCallback(async (updates: Partial<JournalEntry>, complete?: boolean) => {
    setSaving(true)
    const payload = {
      entry_number: week,
      week_of: weekOf,
      ...entry,
      ...updates,
      is_complete: complete ?? isComplete,
    }
    const res = await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setEntry(payload)
      setLastSaved(new Date())
    }
    setSaving(false)
  }, [week, weekOf, entry, isComplete])

  function updateField(field: keyof JournalEntry, value: unknown) {
    const updated = { ...entry, [field]: value }
    setEntry(updated)
  }

  function handleBlur(field: keyof JournalEntry, value: unknown) {
    save({ [field]: value })
  }

  async function handleMarkComplete() {
    setIsComplete(true)
    await save({}, true)
  }

  const sectionCRaw = asActionStatusArray(entry.section_c)
  const sectionC = sectionCRaw.length > 0 ? sectionCRaw : [{ obj: '', action: '', status: '' }]
  const narrative = asNarrative(entry.section_d)
  const confidenceUpdates = asConfidenceUpdates(entry.confidence_updates)
  const completedActionsRaw = asCompletedActions(entry.completed_actions)
  const completedActions = completedActionsRaw.length > 0 ? completedActionsRaw : [{ action: '', completed: false }]

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-[var(--border)] px-5 py-3">
        <div className="flex items-center gap-3">
          {isComplete ? (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--green)]">
              <CheckCircle size={14} /> Complete
            </span>
          ) : (
            <span className="text-[12px] text-[var(--text3)]">Auto-saves on blur</span>
          )}
          {saving && <span className="text-[11px] text-[var(--text3)]">Saving...</span>}
          {lastSaved && !saving && (
            <span className="text-[11px] text-[var(--text3)]">
              Saved {lastSaved.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        {!isComplete && (
          <button
            onClick={handleMarkComplete}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--green-lt)] text-[var(--green)] hover:bg-[var(--green)]/10 transition-colors"
          >
            <Save size={13} /> Mark complete
          </button>
        )}
      </div>

      {/* Section A */}
      <Section letter="A" label="Manual search notes">
        <p className="text-[12px] text-[var(--text3)] mb-2">What did you find searching manually this week that Meridian Arc didn&apos;t surface?</p>
        <textarea
          rows={4}
          defaultValue={entry.section_a ?? ''}
          onBlur={e => handleBlur('section_a', e.target.value)}
          onChange={e => updateField('section_a', e.target.value)}
          disabled={isComplete}
          placeholder="Paste notes from your manual search session..."
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
        />
      </Section>

      {/* Section B */}
      <Section letter="B" label="Meridian Arc vs manual comparison">
        <p className="text-[12px] text-[var(--text3)] mb-2">How did Meridian Arc&apos;s signals compare to what you found manually? What did each miss?</p>
        <textarea
          rows={4}
          defaultValue={entry.section_b ?? ''}
          onBlur={e => handleBlur('section_b', e.target.value)}
          onChange={e => updateField('section_b', e.target.value)}
          disabled={isComplete}
          placeholder="Meridian Arc found X but missed Y. I found Z manually that wasn't in the signal feed..."
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
        />
      </Section>

      {/* Section C — Actions & status by objective */}
      <Section letter="C" label="Actions & status by objective">
        <p className="text-[12px] text-[var(--text3)] mb-3">What did you do this week, per objective, and where does it stand?</p>
        <div className="space-y-2">
          {sectionC.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <input type="text" placeholder="Goal name"
                defaultValue={item.obj}
                disabled={isComplete}
                className="w-20 flex-shrink-0 px-2 py-1.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                onBlur={e => {
                  const updated = sectionC.map((d, idx) => idx === i ? { ...d, obj: e.target.value } : d)
                  handleBlur('section_c', updated)
                }}
              />
              <input type="text" placeholder="What happened"
                defaultValue={item.action}
                disabled={isComplete}
                className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                onBlur={e => {
                  const updated = sectionC.map((d, idx) => idx === i ? { ...d, action: e.target.value } : d)
                  handleBlur('section_c', updated)
                }}
              />
              <input type="text" placeholder="Status"
                defaultValue={item.status}
                disabled={isComplete}
                className="w-32 flex-shrink-0 px-2 py-1.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                onBlur={e => {
                  const updated = sectionC.map((d, idx) => idx === i ? { ...d, status: e.target.value } : d)
                  handleBlur('section_c', updated)
                }}
              />
            </div>
          ))}
          {!isComplete && (
            <button
              onClick={() => {
                const updated = [...sectionC, { obj: '', action: '', status: '' }]
                updateField('section_c', updated)
              }}
              className="text-[12px] text-[var(--blue)] hover:text-[var(--night)] transition-colors mt-1"
            >
              + Add entry
            </button>
          )}
        </div>
      </Section>

      {/* Confidence updates — relocated off section_c, which real data confirmed
          holds the actions/status log above, not this shape. */}
      <Section label="Confidence updates (your assessment)">
        <p className="text-[12px] text-[var(--text3)] mb-3">Record your manual confidence assessment vs Meridian&apos;s score for each objective.</p>
        <div className="space-y-3">
          {objectives.map(obj => {
            const update = confidenceUpdates[obj.obj_id] ?? { prev: obj.confidence_prev ?? obj.confidence, new: obj.confidence, reason: '' }
            return (
              <div key={obj.id} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--gray-lt)/30]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-medium text-[var(--text)]">{obj.obj_id} — {obj.title}</span>
                  <span className="text-[11px] text-[var(--text3)]">Meridian Arc: {obj.confidence}%</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-[10px] text-[var(--text3)] uppercase tracking-wide">Your prev %</label>
                    <input type="number" min={0} max={100}
                      defaultValue={update.prev}
                      disabled={isComplete}
                      className="w-full mt-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                      onBlur={e => {
                        const updated = { ...confidenceUpdates, [obj.obj_id]: { ...update, prev: parseInt(e.target.value) } }
                        handleBlur('confidence_updates', updated)
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[var(--text3)] uppercase tracking-wide">Your new %</label>
                    <input type="number" min={0} max={100}
                      defaultValue={update.new}
                      disabled={isComplete}
                      className="w-full mt-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                      onBlur={e => {
                        const updated = { ...confidenceUpdates, [obj.obj_id]: { ...update, new: parseInt(e.target.value) } }
                        handleBlur('confidence_updates', updated)
                      }}
                    />
                  </div>
                </div>
                <input type="text" placeholder="Why did you change it?"
                  defaultValue={update.reason}
                  disabled={isComplete}
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                  onBlur={e => {
                    const updated = { ...confidenceUpdates, [obj.obj_id]: { ...update, reason: e.target.value } }
                    handleBlur('confidence_updates', updated)
                  }}
                />
              </div>
            )
          })}
        </div>
      </Section>

      {/* Section D — narrative: concerns, open questions, key insight */}
      <Section letter="D" label="Concerns, questions & key insight">
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[var(--text3)] uppercase tracking-wide">Concerns</label>
            <textarea rows={3}
              defaultValue={narrative.concerns}
              onBlur={e => handleBlur('section_d', { ...narrative, concerns: e.target.value })}
              onChange={e => updateField('section_d', { ...narrative, concerns: e.target.value })}
              disabled={isComplete}
              placeholder="What's worrying you about how things are trending?"
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text3)] uppercase tracking-wide">Open questions</label>
            <textarea rows={3}
              defaultValue={narrative.questions}
              onBlur={e => handleBlur('section_d', { ...narrative, questions: e.target.value })}
              onChange={e => updateField('section_d', { ...narrative, questions: e.target.value })}
              disabled={isComplete}
              placeholder="What don't you know yet that you need to figure out?"
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text3)] uppercase tracking-wide">Key insight</label>
            <textarea rows={3}
              defaultValue={narrative.key_insight}
              onBlur={e => handleBlur('section_d', { ...narrative, key_insight: e.target.value })}
              onChange={e => updateField('section_d', { ...narrative, key_insight: e.target.value })}
              disabled={isComplete}
              placeholder="What's the single most important thing you learned this week?"
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
            />
          </div>
        </div>
      </Section>

      {/* Actions completed this week — relocated off section_d, which real
          data confirmed holds the narrative fields above, not this shape.
          Same field ActionsList.tsx's "Log completion" flow now uses. */}
      <Section label="Actions completed this week">
        <p className="text-[12px] text-[var(--text3)] mb-3">What did you actually do this week based on Meridian Arc&apos;s recommendations?</p>
        <div className="space-y-2">
          {completedActions.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox"
                defaultChecked={item.completed}
                disabled={isComplete}
                className="w-4 h-4 rounded"
                onChange={e => {
                  const updated = completedActions.map((d, idx) => idx === i ? { ...d, completed: e.target.checked } : d)
                  handleBlur('completed_actions', updated)
                }}
              />
              <input type="text" placeholder={`Action ${i + 1}`}
                defaultValue={item.action}
                disabled={isComplete}
                className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] disabled:opacity-60"
                onBlur={e => {
                  const updated = completedActions.map((d, idx) => idx === i ? { ...d, action: e.target.value } : d)
                  handleBlur('completed_actions', updated)
                }}
              />
            </div>
          ))}
          {!isComplete && (
            <button
              onClick={() => {
                const updated = [...completedActions, { action: '', completed: false }]
                updateField('completed_actions', updated)
              }}
              className="text-[12px] text-[var(--blue)] hover:text-[var(--night)] transition-colors mt-1"
            >
              + Add action
            </button>
          )}
        </div>
      </Section>

      {/* Section E */}
      <Section letter="E" label="Blockers / open questions">
        <textarea rows={3}
          defaultValue={entry.section_e ?? ''}
          onBlur={e => handleBlur('section_e', e.target.value)}
          onChange={e => updateField('section_e', e.target.value)}
          disabled={isComplete}
          placeholder="What's blocking progress? What do you not know yet?"
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
        />
      </Section>

      {/* Section F */}
      <Section letter="F" label="Book / external milestone tracker">
        <textarea rows={3}
          defaultValue={entry.section_f ?? ''}
          onBlur={e => handleBlur('section_f', e.target.value)}
          onChange={e => updateField('section_f', e.target.value)}
          disabled={isComplete}
          placeholder="Progress on book writing, external milestones, or other tracked items..."
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
        />
      </Section>

      {/* Section G */}
      <Section letter="G" label="POS system tracking">
        <textarea rows={3}
          defaultValue={entry.section_g ?? ''}
          onBlur={e => handleBlur('section_g', e.target.value)}
          onChange={e => updateField('section_g', e.target.value)}
          disabled={isComplete}
          placeholder="Notes on the Meridian Arc system itself — what's working, what needs improvement..."
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
        />
      </Section>

      {/* Section H — Rating */}
      <Section letter="H" label="POS value rating">
        <p className="text-[12px] text-[var(--text3)] mb-3">How much value did Meridian Arc provide this week? (1 = none, 5 = exceptional)</p>
        <div className="flex gap-2 mb-4">
          {[1,2,3,4,5].map(star => (
            <button
              key={star}
              disabled={isComplete}
              onClick={() => {
                updateField('section_h_rating', star)
                save({ section_h_rating: star })
              }}
              className={`text-[28px] transition-colors disabled:cursor-default ${
                star <= (entry.section_h_rating ?? 0) ? 'text-[var(--gold)]' : 'text-[var(--border)] hover:text-[var(--gold)]/50'
              }`}
            >★</button>
          ))}
        </div>
        <textarea rows={2}
          defaultValue={entry.section_h_notes ?? ''}
          onBlur={e => handleBlur('section_h_notes', e.target.value)}
          onChange={e => updateField('section_h_notes', e.target.value)}
          disabled={isComplete}
          placeholder="What made Meridian Arc valuable or not valuable this week?"
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none disabled:opacity-60"
        />
      </Section>
    </div>
  )
}
