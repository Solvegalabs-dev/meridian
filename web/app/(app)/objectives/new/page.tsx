'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Link2, Copy, X } from 'lucide-react'
import { getCategoriesForAccount } from '@/lib/utils/categories'

type ApiError = { error: string; max?: number; target_date?: string }

const schema = z.object({
  title:             z.string().min(3, 'Title must be at least 3 characters'),
  category:          z.string().min(1),
  outcome:           z.string().min(10, 'Describe the outcome in at least 10 characters'),
  success_condition: z.string().optional(),
  target_date:       z.string().optional(),
  notes:             z.string().optional(),
  key_risk:          z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Placeholders {
  title: string
  outcome: string
  success_condition: string
  target_date: string
  notes: string
  key_risk: string
}

function getPlaceholdersByContext(context: string | null): Placeholders {
  switch (context) {
    case 'career_transition':
      return {
        title:             'Example: Land a Program Manager role at a defense contractor by December 2026',
        outcome:           "Describe what success looks like and what factors matter most. Include:\n · Target role title(s) you're open to\n · 1–3 specific companies or employers you're targeting\n · Location requirement or constraint\n · Minimum salary or compensation floor\n · Any credential, clearance, or certification relevant to this objective\n · Your biggest concern or risk you want the system to watch",
        success_condition: 'Example: Signed offer letter at or above $95K base salary, hybrid or remote schedule,\n in the Denver-Colorado Springs corridor, by December 31, 2026.',
        target_date:       'Set a realistic target date. For career transitions: your ETS/separation date + 60–90 days\n is a common first-job horizon. Hard deadlines (benefit enrollment cutoffs, credential\n expiration dates) should be separate objectives.',
        notes:             "Optional but powerful. Add anything the system should know that doesn't fit above:\n · Family or location constraints\n · A referral or connection inside a target company\n · A certification you're mid-way through\n · A competing offer or alternative path you're weighing\n · How this objective connects to another goal (financial, relocation, family)",
        key_risk:          "Example: My military job titles don't translate directly — I'm worried\n  employers won't see the equivalency. / I have a coverage gap between separation\n  and my first paycheck. / I'm not sure which certification to pursue first.",
      }
    case 'business_owner':
      return {
        title:             'Example: Reach $50K MRR by Q4 2026',
        outcome:           'Describe the business result — revenue target, team size, market position,\n  client count, or operational milestone. Include your industry and any key constraints.',
        success_condition: 'Example: $50K MRR sustained for two consecutive months, three enterprise\n  clients signed, team of five fully onboarded.',
        target_date:       'Set a realistic target date. Quarterly milestones work well for business goals.',
        notes:             'Add context: current MRR, team size, key competitors, biggest risk,\n  or any dependency on another objective (funding, hiring, a product launch).',
        key_risk:          "Example: Our largest client is 40% of revenue — churn risk is the thing\n  I'm most worried about.",
      }
    case 'personal':
      return {
        title:             'Example: Pay off $18K in credit card debt by March 2027',
        outcome:           'Describe the personal result — financial target, health goal, family milestone,\n  or life change. Include any hard deadline or constraint.',
        success_condition: 'Example: Balance at zero, no new revolving debt, emergency fund at $5K.',
        target_date:       'When does this need to be done by? Or when would you like it done by?',
        notes:             "Add context: current status, what's working, what's in the way,\n  and how this connects to other things you're working toward.",
        key_risk:          'Example: An irregular income month could knock me off the payoff schedule.',
      }
    default:
      return {
        title:             'What do you want to achieve?',
        outcome:           "Describe the specific result you're working toward...",
        success_condition: 'What does done look like?',
        target_date:       '',
        notes:             'Context, blockers, relationships, open actions...',
        key_risk:          "What's the one thing most likely to get in your way?",
      }
  }
}

export default function NewObjectivePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountType, setAccountType] = useState<string | null>(null)
  const [onboardingContext, setOnboardingContext] = useState<string | null>(null)
  const [cloneBannerDismissed, setCloneBannerDismissed] = useState(false)

  // Ancestor chain params (set when launched from CloseModal "Yes — start the next goal")
  const parentObjectiveId = searchParams.get('parent_objective_id')
  const outcomeId         = searchParams.get('outcome_id')
  const preTitle          = searchParams.get('pre_title') ?? ''
  const preCategory       = searchParams.get('pre_category') ?? ''
  const preContext        = searchParams.get('pre_context')

  // Clone params (set when launched from ArchivedGoalRow "Clone this goal")
  const cloned          = searchParams.get('cloned')
  const preOutcome      = searchParams.get('pre_outcome') ?? ''
  const preNotes        = searchParams.get('pre_notes') ?? ''
  const preTargetDate   = searchParams.get('pre_target_date') ?? ''

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('account_type, onboarding_context').eq('id', user.id).single()
        .then(({ data }) => {
          setAccountType(data?.account_type ?? 'personal')
          setOnboardingContext(data?.onboarding_context ?? 'general')
        })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const categories = getCategoriesForAccount(accountType)
  const ph = getPlaceholdersByContext(onboardingContext)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      category:    preCategory || categories[0],
      title:       preTitle || '',
      outcome:     preOutcome || '',
      notes:       preNotes || '',
      target_date: preTargetDate || '',
    },
  })

  // AI clarifying questions, assessed once after the form is first submitted.
  const [clarifyQuestions, setClarifyQuestions] = useState<string[] | null>(null)
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([])
  const [pendingData, setPendingData] = useState<FormData | null>(null)
  const [assessing, setAssessing] = useState(false)

  async function onSubmit(data: FormData) {
    if (clarifyQuestions === null) {
      setAssessing(true)
      setError(null)
      const res = await fetch('/api/assess-objective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          category: data.category,
          outcome: data.outcome,
          target_date: data.target_date || null,
        }),
      })
      const { questions } = res.ok ? await res.json() as { questions: string[] } : { questions: [] }
      setAssessing(false)

      if (questions.length > 0) {
        setClarifyQuestions(questions)
        setClarifyAnswers(questions.map(() => ''))
        setPendingData(data)
        return
      }
    }

    await createObjective(data, null)
  }

  async function createObjective(data: FormData, goalContext: string | null) {
    setSaving(true)
    setError(null)

    // Append key_risk to notes context so sweep engine sees it
    const notesWithRisk = [data.notes, data.key_risk ? `Key risk: ${data.key_risk}` : ''].filter(Boolean).join('\n\n')

    // Merge ancestor context into goal_context if available
    let mergedContext = goalContext
    if (preContext) {
      try {
        const ancestorCtx = JSON.parse(decodeURIComponent(preContext)) as Record<string, unknown>
        const ancestorStr = `Ancestor context: ${JSON.stringify(ancestorCtx)}`
        mergedContext = mergedContext ? `${mergedContext}\n\n${ancestorStr}` : ancestorStr
      } catch { /* ignore malformed context */ }
    }

    const res = await fetch('/api/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:               data.title,
        category:            data.category,
        outcome:             data.outcome,
        success_condition:   data.success_condition || null,
        target_date:         data.target_date || null,
        notes:               notesWithRisk || null,
        goal_description:    data.outcome,
        goal_context:        mergedContext,
        parent_objective_id: parentObjectiveId || null,
      }),
    })

    if (!res.ok) {
      const d = await res.json() as ApiError
      if (d.error === 'objective_limit_reached') {
        setError(`limit:${d.max ?? 0}`)
      } else if (d.error === 'past_target_date') {
        setError('Target date cannot be in the past — please choose a future date.')
      } else {
        setError(d.error ?? 'Something went wrong')
      }
      setSaving(false)
      return
    }

    const { id: newObjectiveId } = await res.json() as { id: string }

    // Backfill spawned_objective_id on the parent outcome row (non-blocking)
    if (outcomeId && newObjectiveId) {
      await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spawned_objective_id: newObjectiveId }),
      }).catch(() => { /* non-fatal */ })
    }

    // Redirect to new objective detail if spawned from ancestor chain; otherwise list
    const redirectTo = (parentObjectiveId && newObjectiveId) ? `/objectives/${newObjectiveId}` : '/objectives'
    router.push(redirectTo)
    router.refresh()
  }

  function updateClarifyAnswer(qi: number, value: string) {
    setClarifyAnswers(prev => prev.map((a, i) => i === qi ? value : a))
  }

  async function continueWithAnswers() {
    if (!pendingData || !clarifyQuestions) return
    const answered = clarifyQuestions
      .map((q, qi) => ({ q, a: clarifyAnswers[qi]?.trim() }))
      .filter(({ a }) => !!a)
    const goalContext = answered.length > 0
      ? answered.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join('\n\n')
      : null
    await createObjective(pendingData, goalContext)
  }

  async function skipClarify() {
    if (!pendingData) return
    await createObjective(pendingData, null)
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/objectives" className="text-[var(--text3)] hover:text-[var(--text)] transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-[22px] font-medium text-[var(--text)]">New goal</h1>
          <p className="text-[13px] text-[var(--text3)]">Define what you want to achieve</p>
        </div>
      </div>

      {/* Ancestor chain banner */}
      {parentObjectiveId && preTitle && (
        <div className="mb-4 px-4 py-3 rounded-xl flex items-start gap-2.5 text-[13px]"
          style={{ backgroundColor: 'rgba(201,162,39,.1)', border: '1px solid rgba(201,162,39,.3)', color: 'var(--ov-text-hi)' }}>
          <Link2 size={14} style={{ color: 'var(--ov-amber)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <p style={{ fontWeight: 600, color: 'var(--ov-amber)', fontSize: '12px', marginBottom: '2px' }}>Continuing from a closed goal</p>
            <p style={{ color: 'var(--ov-text-mid)', fontSize: '12px' }}>{decodeURIComponent(preTitle)}</p>
          </div>
        </div>
      )}

      {/* Clone banner */}
      {cloned === '1' && !cloneBannerDismissed && (
        <div className="mb-4 px-4 py-3 rounded-xl flex items-start justify-between gap-2.5"
          style={{ backgroundColor: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.25)' }}>
          <div className="flex items-start gap-2.5">
            <Copy size={14} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: '2px' }} />
            <p style={{ fontSize: '12px', color: 'var(--text2)' }}>
              Cloned from an archived goal — review and update before saving.
            </p>
          </div>
          <button onClick={() => setCloneBannerDismissed(true)} style={{ color: 'var(--text3)', flexShrink: 0, padding: '0 2px' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {error?.startsWith('limit:') && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-[13px]">
          <p className="font-medium text-amber-900 mb-1">
            You&apos;ve reached your limit of {error.split(':')[1]} active goals.
          </p>
          <p className="text-amber-700 mb-3">
            Closed and abandoned goals don&apos;t count against your limit. Close an active goal to make room, or upgrade your plan for more.
          </p>
          <Link
            href="/settings#billing"
            className="inline-block px-4 py-2 rounded-lg bg-amber-600 text-white text-[12px] font-medium hover:bg-amber-700 transition-colors"
          >
            Upgrade plan →
          </Link>
        </div>
      )}

      {clarifyQuestions ? (
        <div className="bg-white rounded-2xl border border-[var(--border)] p-6 space-y-4">
          {error && !error.startsWith('limit:') && (
            <div className="p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{error}</div>
          )}
          <div>
            <p className="text-[14px] font-medium text-[var(--text)] mb-1">A couple quick questions</p>
            <p className="text-[13px] text-[var(--text3)]">
              These help sharpen this goal for future scoring and recommendations — all optional.
            </p>
          </div>
          {clarifyQuestions.map((q, qi) => (
            <div key={qi}>
              <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5">{q}</label>
              <input
                value={clarifyAnswers[qi] ?? ''}
                onChange={e => updateClarifyAnswer(qi, e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
              />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button
              onClick={skipClarify}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text2)] hover:bg-[var(--gray-lt)] transition-colors disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={continueWithAnswers}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[14px] font-medium hover:bg-[var(--night)] transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Create goal'}
            </button>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-[var(--border)] p-6 space-y-5">
        {error && !error.startsWith('limit:') && (
          <div className="p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{error}</div>
        )}

        {/* Title */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5 uppercase tracking-wide">Title</label>
          <input
            {...register('title')}
            placeholder={ph.title}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
          />
          {errors.title && <p className="text-[11px] text-[var(--red)] mt-1">{errors.title.message}</p>}
        </div>

        {/* Category — conditional on account_type */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5 uppercase tracking-wide">Category</label>
          <select
            {...register('category')}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] bg-white focus:outline-none focus:border-[var(--blue)] transition-colors"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Outcome */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5 uppercase tracking-wide">
            Outcome <span className="font-normal text-[var(--text3)] normal-case tracking-normal">— &ldquo;I will have...&rdquo;</span>
          </label>
          <textarea
            {...register('outcome')}
            rows={4}
            placeholder={ph.outcome}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors resize-none"
          />
          {errors.outcome && <p className="text-[11px] text-[var(--red)] mt-1">{errors.outcome.message}</p>}
        </div>

        {/* Success condition */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5 uppercase tracking-wide">
            Success condition <span className="font-normal normal-case tracking-normal text-[var(--text3)]">— how you know you won</span>
          </label>
          <textarea
            {...register('success_condition')}
            rows={2}
            placeholder={ph.success_condition}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors resize-none"
          />
        </div>

        {/* Target date */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5 uppercase tracking-wide">Target date</label>
          <input
            type="date"
            {...register('target_date')}
            min={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] bg-white focus:outline-none focus:border-[var(--blue)] transition-colors"
          />
          {ph.target_date && (
            <p className="text-[11px] text-[var(--text3)] mt-1.5">{ph.target_date}</p>
          )}
          {errors.target_date && <p className="text-[11px] text-[var(--red)] mt-1">{errors.target_date.message}</p>}
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1.5 uppercase tracking-wide">Notes</label>
          <textarea
            {...register('notes')}
            rows={3}
            placeholder={ph.notes}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors resize-none"
          />
        </div>

        {/* Key Risk */}
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text2)] mb-1 uppercase tracking-wide">
            Key risk <span className="font-normal normal-case tracking-normal text-[var(--text3)]">— optional</span>
          </label>
          <p className="text-[11px] text-[var(--text3)] mb-1.5">What&apos;s the one thing you&apos;re most worried about?</p>
          <textarea
            {...register('key_risk')}
            rows={2}
            placeholder={ph.key_risk}
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors resize-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Link
            href="/objectives"
            className="flex-1 text-center py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text2)] hover:bg-[var(--gray-lt)] transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || assessing}
            className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[14px] font-medium hover:bg-[var(--night)] transition-colors disabled:opacity-50"
          >
            {assessing ? 'Checking...' : saving ? 'Saving...' : 'Create goal'}
          </button>
        </div>
      </form>
      )}
    </div>
  )
}
