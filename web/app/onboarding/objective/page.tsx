'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MeridianBeacon from '@/components/brand/MeridianBeacon'
import { Check, Pencil, X } from 'lucide-react'
import { getCategoriesForAccount, CATEGORY_COLORS } from '@/lib/utils/categories'
import { createClient } from '@/lib/supabase/client'
import { formatDateOnly } from '@/lib/utils/dateOnly'

// Career Transition Template — 5 pre-built draft objectives
const CAREER_TRANSITION_TEMPLATE: ExtractedGoal[] = [
  {
    title: 'Land my target civilian role within 90 days of separation',
    category: 'Career',
    outcome: 'Signed offer letter for a role that matches my experience, meets my salary floor, and fits my location and schedule requirements. I am targeting [role type] roles at [1-3 companies]. My minimum base salary is [$X]. Location requirement: [city/region or remote].',
    target_date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 90)
      return d.toISOString().split('T')[0]
    })(),
  },
  {
    title: 'Bridge the income and benefits gap through separation',
    category: 'Finance',
    outcome: 'No gap in health coverage. VA disability claim filed and in process. TSP rollover decision made. Cash reserves stay above two months of household expenses through the transition window. GI Bill transfer or use plan confirmed.',
    target_date: null,
  },
  {
    title: 'Complete one civilian certification that strengthens my target role',
    category: 'Career',
    outcome: 'Passed and credentialed in [target certification — e.g. PMP, AWS Cloud Practitioner, Lean Six Sigma Green Belt, CompTIA Security+]. Exam fee budgeted and prep materials identified. Study timeline fits around separation activities.',
    target_date: null,
  },
  {
    title: 'Family celebration — the trip we\'ve been postponing',
    category: 'Personal',
    outcome: 'Family trip completed — destination [X], duration [X days], all-in budget [$X]. This is the reward horizon. Timing downstream of financial stabilization confirming on track.',
    target_date: null,
  },
]

interface ExtractedGoal {
  title: string
  category: string
  outcome: string
  target_date: string | null
}

function OnboardingObjectivePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Resolve template param before any state declarations so initial state is correct
  const isCareerTemplate = searchParams.get('template') === 'career_transition'

  // Step A — free text input
  const [bio, setBio] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [accountType, setAccountType] = useState<string | null>(null)
  const [onboardingContext, setOnboardingContext] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Step B — review extracted goals
  // Initialize directly from template param — bypasses bio-extraction screen on first render
  const [goals, setGoals] = useState<ExtractedGoal[] | null>(
    isCareerTemplate ? CAREER_TRANSITION_TEMPLATE : null
  )
  const [selected, setSelected] = useState<boolean[]>(
    isCareerTemplate ? CAREER_TRANSITION_TEMPLATE.map(() => true) : []
  )
  const [editing, setEditing] = useState<number | null>(null)
  const [savedIds, setSavedIds] = useState<(string | null)[]>(
    isCareerTemplate ? CAREER_TRANSITION_TEMPLATE.map(() => null) : []
  )
  const [syncError, setSyncError] = useState<string | null>(null)

  const [clarifyQuestions, setClarifyQuestions] = useState<(string[] | undefined)[]>(
    isCareerTemplate ? CAREER_TRANSITION_TEMPLATE.map(() => undefined) : []
  )
  const [clarifyAnswers, setClarifyAnswers] = useState<string[][]>(
    isCareerTemplate ? CAREER_TRANSITION_TEMPLATE.map(() => []) : []
  )
  const [clarifyDone, setClarifyDone] = useState<boolean[]>(
    isCareerTemplate ? CAREER_TRANSITION_TEMPLATE.map(() => false) : []
  )

  const CATEGORIES = getCategoriesForAccount(accountType)

  // Loads career transition template into state and persists objectives to DB.
  // Called from both the URL param path and the profile context path.
  // bio is '' in both cases — acceptable for goal_description.
  function activateCareerTemplate() {
    setGoals(CAREER_TRANSITION_TEMPLATE)
    setSelected(CAREER_TRANSITION_TEMPLATE.map(() => true))
    setSavedIds(CAREER_TRANSITION_TEMPLATE.map(() => null))
    setClarifyQuestions(CAREER_TRANSITION_TEMPLATE.map(() => undefined))
    setClarifyAnswers(CAREER_TRANSITION_TEMPLATE.map(() => []))
    setClarifyDone(CAREER_TRANSITION_TEMPLATE.map(() => false))
    ;(async () => {
      for (let i = 0; i < CAREER_TRANSITION_TEMPLATE.length; i++) {
        await createGoal(i, CAREER_TRANSITION_TEMPLATE[i])
      }
    })()
  }


  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)

      const [profileResult, countResult] = await Promise.all([
        supabase.from('profiles').select('account_type, onboarding_context, onboarded_at').eq('id', user.id).single(),
        supabase.from('objectives').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      setAccountType(profileResult.data?.account_type ?? 'personal')
      setOnboardingContext(profileResult.data?.onboarding_context ?? null)

      const existingCount = countResult.count ?? 0
      const alreadyOnboarded = !!profileResult.data?.onboarded_at

      if (existingCount > 0 && alreadyOnboarded) {
        // Fully onboarded user revisiting this URL — send them to the dashboard
        router.replace('/dashboard')
        return
      }

      // Mid-onboarding with existing goals (e.g. abandoned after template activation,
      // or StrictMode double-invoke in dev): skip re-creation and let them review
      // what's already there so they can continue to the sweep step.
      if (existingCount > 0 && !alreadyOnboarded) {
        const { data: existingGoals } = await supabase
          .from('objectives')
          .select('id, title, category, outcome, target_date')
          .eq('user_id', user.id)
          .order('sort_order')
        if (existingGoals && existingGoals.length > 0) {
          setGoals(existingGoals.map(g => ({
            title: g.title,
            category: g.category,
            outcome: g.outcome ?? '',
            target_date: g.target_date ?? null,
          })))
          setSelected(existingGoals.map(() => true))
          setSavedIds(existingGoals.map(g => g.id))
          setClarifyQuestions(existingGoals.map(() => undefined))
          setClarifyAnswers(existingGoals.map(() => []))
          setClarifyDone(existingGoals.map(() => false))
        }
        return
      }

      // If the user's saved context is career_transition and the URL param
      // didn't already activate the template, activate it now.
      if (profileResult.data?.onboarding_context === 'career_transition' && !isCareerTemplate) {
        activateCareerTemplate()
      }
    })

    // URL param path — state was already initialized synchronously; only persist.
    if (isCareerTemplate) {
      ;(async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase.from('profiles').select('onboarded_at').eq('id', user.id).single()
        const { count } = await supabase.from('objectives').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
        if ((count ?? 0) > 0 && profile?.onboarded_at) {
          router.replace('/dashboard')
          return
        }
        // Goals already exist from a prior pass — skip re-creation
        if ((count ?? 0) > 0) return
        for (let i = 0; i < CAREER_TRANSITION_TEMPLATE.length; i++) {
          await createGoal(i, CAREER_TRANSITION_TEMPLATE[i])
        }
      })()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleExtract() {
    if (!bio.trim()) return
    setExtracting(true)
    setExtractError(null)

    const res = await fetch('/api/extract-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: bio }),
    })

    if (!res.ok) {
      setExtractError('Could not extract goals — please try rephrasing or add goals manually.')
      setExtracting(false)
      return
    }

    const data = await res.json() as { goals: ExtractedGoal[] }
    setGoals(data.goals)
    setSelected(data.goals.map(() => true))
    setSavedIds(data.goals.map(() => null))
    setClarifyQuestions(data.goals.map(() => undefined))
    setClarifyAnswers(data.goals.map(() => []))
    setClarifyDone(data.goals.map(() => false))
    setExtracting(false)

    // All goals start selected — persist each immediately rather than
    // waiting for the final button, so nothing is lost if the user leaves.
    // Sequential (not parallel) — /api/objectives derives obj_id from a
    // row count, so concurrent creates would race and collide.
    for (let i = 0; i < data.goals.length; i++) {
      await createGoal(i, data.goals[i])
      void assessGoal(i, data.goals[i])
    }
  }

  // Ask the AI whether this goal needs clarifying questions — fire-and-forget
  // once the goal is persisted, so it doesn't slow down extraction.
  async function assessGoal(i: number, goal: ExtractedGoal) {
    const res = await fetch('/api/assess-objective', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: goal.title,
        category: goal.category,
        outcome: goal.outcome,
        target_date: goal.target_date,
      }),
    })
    if (!res.ok) return
    const data = await res.json() as { questions: string[] }
    setClarifyQuestions(prev => prev.map((q, idx) => idx === i ? data.questions : q))
    setClarifyAnswers(prev => prev.map((a, idx) => idx === i ? data.questions.map(() => '') : a))
  }

  function updateClarifyAnswer(i: number, qi: number, value: string) {
    setClarifyAnswers(prev => prev.map((answers, idx) => idx === i ? answers.map((a, aqi) => aqi === qi ? value : a) : answers))
  }

  // Persist any non-blank answers to goal_context, joined as Q&A text.
  async function saveClarifyAnswers(i: number) {
    const id = savedIds[i]
    const questions = clarifyQuestions[i]
    const answers = clarifyAnswers[i]
    if (id && questions) {
      const answered = questions
        .map((q, qi) => ({ q, a: answers[qi]?.trim() }))
        .filter(({ a }) => !!a)
      if (answered.length > 0) {
        const goal_context = answered.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join('\n\n')
        const { error } = await supabase.from('objectives').update({ goal_context }).eq('id', id).eq('user_id', userId)
        if (error) setSyncError('Could not save your answers — please try again.')
      }
    }
    setClarifyDone(prev => prev.map((d, idx) => idx === i ? true : d))
  }

  function skipClarify(i: number) {
    setClarifyDone(prev => prev.map((d, idx) => idx === i ? true : d))
  }

  function updateGoal(i: number, updates: Partial<ExtractedGoal>) {
    setGoals(prev => prev ? prev.map((g, idx) => idx === i ? { ...g, ...updates } : g) : prev)
  }

  // Create a new objective row and record its id against this goal's index.
  async function createGoal(i: number, goal: ExtractedGoal) {
    const res = await fetch('/api/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: goal.title,
        category: goal.category,
        outcome: goal.outcome,
        target_date: goal.target_date || undefined,
        // The shared freeform bio this goal was extracted from — the
        // closest thing to "what the user originally typed" for a goal
        // that came out of a multi-goal extraction rather than its own form.
        goal_description: bio,
      }),
    })

    if (!res.ok) {
      const d = await res.json() as { error?: string; target_date?: string }
      if (d.error === 'past_target_date') {
        setSyncError(`Date ${d.target_date} is in the past — please edit goal ${i + 1} and set a future date.`)
      } else {
        setSyncError('Could not save a goal — please try re-checking it.')
      }
      return
    }

    const data = await res.json() as { objective: { id: string } }
    setSavedIds(prev => prev.map((id, idx) => idx === i ? data.objective.id : id))
  }

  // Update an already-persisted objective row in place.
  async function updateSavedGoal(id: string, goal: ExtractedGoal) {
    if (!userId) return
    const { error } = await supabase
      .from('objectives')
      .update({
        title: goal.title,
        category: goal.category,
        outcome: goal.outcome,
        target_date: goal.target_date || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)

    if (error) setSyncError('Could not save your edit — please try again.')
  }

  // Remove a persisted objective row (unchecked, deleted, or abandoned).
  async function deleteSavedGoal(id: string) {
    if (!userId) return
    const { error } = await supabase
      .from('objectives')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) setSyncError('Could not remove that goal — please try again.')
  }

  function toggleSelected(i: number) {
    const goal = goals?.[i]
    if (!goal) return
    const nowSelected = !selected[i]
    setSelected(prev => prev.map((s, idx) => idx === i ? nowSelected : s))

    if (nowSelected) {
      void createGoal(i, goal)
    } else {
      const id = savedIds[i]
      if (id) {
        void deleteSavedGoal(id)
        setSavedIds(prev => prev.map((sid, idx) => idx === i ? null : sid))
      }
    }
  }

  function finishEditing(i: number) {
    setEditing(null)
    const goal = goals?.[i]
    const id = savedIds[i]
    if (goal && selected[i] && id) {
      void updateSavedGoal(id, goal)
    }
  }

  function removeGoal(i: number) {
    const id = savedIds[i]
    if (id) void deleteSavedGoal(id)
    setGoals(prev => prev ? prev.filter((_, idx) => idx !== i) : prev)
    setSelected(prev => prev.filter((_, idx) => idx !== i))
    setSavedIds(prev => prev.filter((_, idx) => idx !== i))
    setClarifyQuestions(prev => prev.filter((_, idx) => idx !== i))
    setClarifyAnswers(prev => prev.filter((_, idx) => idx !== i))
    setClarifyDone(prev => prev.filter((_, idx) => idx !== i))
  }

  function startOver() {
    // Clean up anything already persisted from this extraction pass
    savedIds.forEach(id => { if (id) void deleteSavedGoal(id) })
    setGoals(null)
    setBio('')
    setSelected([])
    setSavedIds([])
    setClarifyQuestions([])
    setClarifyAnswers([])
    setClarifyDone([])
  }

  // ── Step A — Tell us about yourself ──────────────────────────
  if (!goals) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center px-4">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <MeridianBeacon size={40} variant="gold" animate={false} />
            <p className="text-[11px] text-white/30 mt-3 tracking-widest uppercase">Step 4 of 5</p>
            <h1 className="text-[24px] font-light text-white mt-1">Tell us about yourself</h1>
            <p className="text-[13px] text-white/40 mt-1 max-w-sm mx-auto">
              Share your life, goals, and what you&apos;re working toward. Meridian will extract your goals automatically.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 space-y-4">
            {extractError && (
              <div className="p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{extractError}</div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1.5">
                About you and your goals
              </label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                rows={7}
                placeholder={onboardingContext === 'career_transition'
                  ? `Example: "I'm separating from the Army in October after 8 years as a logistics officer. I'm targeting Program Manager roles at defense contractors in the Denver area. Minimum salary $90K, hybrid or remote only. I also need to sort out VA benefits, TRICARE coverage, and my TSP rollover before my last day."`
                  : `Example "I run a (real estate brokerage, interior design, bike shop, or financial planning) business and want to grow revenue 30% this year while hiring two new agents (employees). Personally, I'm training for a half marathon in October and working toward paying off my truck early."`}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] resize-none leading-relaxed"
              />
              <p className="text-[11px] text-[var(--text3)] mt-1.5">
                Be as detailed or brief as you like. Meridian will identify up to 5 goals — business and personal — from your description.
              </p>
            </div>

            <button
              onClick={handleExtract}
              disabled={extracting || !bio.trim()}
              className="w-full py-2.5 rounded-lg bg-navy text-white text-[14px] font-medium hover:bg-[var(--night)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {extracting ? (
                <>
                  <MeridianBeacon size={16} variant="gold" animate={true} />
                  Extracting your goals...
                </>
              ) : (
                'Extract my goals →'
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Step B — Review extracted goals ──────────────────────────
  const selectedCount = selected.filter(Boolean).length

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <MeridianBeacon size={40} variant="gold" animate={false} />
          <p className="text-[11px] text-white/30 mt-3 tracking-widest uppercase">Step 4 of 5</p>
          <h1 className="text-[24px] font-light text-white mt-1">Here are your goals</h1>
          <p className="text-[13px] text-white/40 mt-1">
            Select the ones you want to track. You can edit any of them.
          </p>
        </div>

        {syncError && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{syncError}</div>
        )}

        <div className="space-y-3 mb-5">
          {goals.map((goal, i) => {
            const catColor = CATEGORY_COLORS[goal.category] ?? '#8098B4'
            const isSelected = selected[i]
            const isEditing = editing === i

            return (
              <div
                key={i}
                className={`bg-white rounded-xl border-2 transition-all ${
                  isSelected ? 'border-[var(--blue)]' : 'border-transparent opacity-60'
                }`}
              >
                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <input
                      value={goal.title}
                      onChange={e => updateGoal(i, { title: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[13px] font-medium focus:outline-none focus:border-[var(--blue)]"
                    />
                    <select
                      value={goal.category}
                      onChange={e => updateGoal(i, { category: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[12px] bg-white focus:outline-none"
                    >
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <textarea
                      value={goal.outcome}
                      onChange={e => updateGoal(i, { outcome: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[12px] resize-none focus:outline-none focus:border-[var(--blue)]"
                    />
                    <input
                      type="date"
                      value={goal.target_date ?? ''}
                      onChange={e => updateGoal(i, { target_date: e.target.value || null })}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[12px] bg-white focus:outline-none"
                    />
                    {goal.target_date && goal.target_date < new Date().toISOString().split('T')[0] && (
                      <p className="text-[11px] text-[var(--red)] mt-1">
                        ⚠ This date is in the past — please update it before continuing.
                      </p>
                    )}
                    <button
                      onClick={() => finishEditing(i)}
                      className="text-[12px] font-medium text-[var(--blue)] hover:text-[var(--night)]"
                    >
                      Done editing
                    </button>
                  </div>
                ) : (
                  <div className="p-4 flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleSelected(i)}
                      className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 flex items-center justify-center border-2 transition-all ${
                        isSelected ? 'bg-[var(--blue)] border-[var(--blue)]' : 'border-[var(--border)]'
                      }`}
                    >
                      {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ color: catColor, backgroundColor: `${catColor}18` }}
                        >
                          {goal.category}
                        </span>
                        {goal.target_date && (
                          <span className="text-[10px] text-[var(--text3)]">
                            By {formatDateOnly(goal.target_date, { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] font-medium text-[var(--text)] leading-snug">{goal.title}</p>
                      <p className="text-[11.5px] text-[var(--text3)] mt-0.5 leading-relaxed">{goal.outcome}</p>
                    </div>

                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => setEditing(i)}
                        className="p-1.5 rounded-lg text-[var(--text3)] hover:text-[var(--blue)] hover:bg-[#E6F1FB] transition-colors"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => removeGoal(i)}
                        className="p-1.5 rounded-lg text-[var(--text3)] hover:text-[var(--red)] hover:bg-[var(--red-lt)] transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}

                {isSelected && !isEditing && !clarifyDone[i] && (clarifyQuestions[i]?.length ?? 0) > 0 && (
                  <div className="px-4 pb-4 -mt-1 space-y-2.5">
                    <div className="pt-3 space-y-2.5" style={{ borderTop: '1px solid var(--border)' }}>
                      <p className="text-[11px] font-medium text-[var(--text2)]">
                        A couple quick questions to sharpen this goal (optional):
                      </p>
                      {clarifyQuestions[i]!.map((q, qi) => (
                        <div key={qi}>
                          <label className="block text-[11px] text-[var(--text3)] mb-1">{q}</label>
                          <input
                            value={clarifyAnswers[i]?.[qi] ?? ''}
                            onChange={e => updateClarifyAnswer(i, qi, e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[12px] focus:outline-none focus:border-[var(--blue)]"
                          />
                        </div>
                      ))}
                      <div className="flex gap-3 pt-0.5">
                        <button
                          onClick={() => saveClarifyAnswers(i)}
                          className="text-[11px] font-medium text-[var(--blue)] hover:text-[var(--night)]"
                        >
                          Save answers
                        </button>
                        <button
                          onClick={() => skipClarify(i)}
                          className="text-[11px] text-[var(--text3)] hover:text-[var(--text2)]"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="space-y-2">
          <button
            onClick={() => router.push('/onboarding/sweep')}
            disabled={selectedCount === 0}
            className="w-full py-3 rounded-xl bg-gold text-navy text-[14px] font-semibold hover:bg-gold/90 disabled:opacity-50 transition-colors"
          >
            {`Add ${selectedCount} goal${selectedCount !== 1 ? 's' : ''} and run first sweep →`}
          </button>
          <button
            onClick={startOver}
            className="w-full py-2 text-[12px] text-white/30 hover:text-white/60 transition-colors"
          >
            ← Start over
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OnboardingObjectivePage() {
  return (
    <Suspense fallback={null}>
      <OnboardingObjectivePageInner />
    </Suspense>
  )
}
