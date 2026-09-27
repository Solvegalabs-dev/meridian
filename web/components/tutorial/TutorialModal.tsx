'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, ChevronLeft, ChevronRight, Target, Radio, MessageCircle, Check, Settings } from 'lucide-react'
import MeridianBeacon from '@/components/brand/MeridianBeacon'
import { createClient } from '@/lib/supabase/client'

// Hardcoded palette — do NOT replace with CSS custom properties.
// These modals are self-contained overlays; dark-mode ancestors must not bleed in.
const P = {
  navy:   '#0D1B3E',
  navy2:  '#12244F',
  gold:   '#C9A227',
  blue:   '#2E7CB8',
  ink:    '#0D1B3E',
  muted:  '#5B6787',
  body:   '#33405F',
  line:   '#E4E8F2',
  bg:     '#F4F6FB',
  green:  '#2F9E6B',
  amber:  '#D99A1C',
  red:    '#C85A54',
  white:  '#FFFFFF',
} as const

interface TutorialModalProps {
  open: boolean
  onClose: () => void
  startPage?: number
  onOpenKeyTerms?: () => void
}

const PAGES = [
  {
    kicker: 'Getting Started · 1 of 5',
    title: 'Your transition has too many moving parts for any one tool to track.',
    subtitle: 'Meridian holds every objective in a living state.',
    body: `Target roles. Target companies. ETS date. VA benefits. Certification timelines. Financial runway. Family move. All of it matters. All of it interacts.

Meridian holds every objective in a living state — not a list you maintain, but an intelligence layer that monitors the world on your behalf and tells you what changed this week and what to do next.

It's not a chatbot. It doesn't forget what you're working toward. Every sweep builds on the last one.`,
  },
  {
    kicker: 'Writing Objectives · 2 of 5',
    title: 'One objective per pursuit. Specific enough to act on.',
    subtitle: 'The more context you give Meridian, the more targeted your first briefing.',
    body: null, // rendered conditionally based on context
  },
  {
    kicker: 'How It Works · 3 of 5',
    title: "Here's what happens next.",
    subtitle: 'Three steps. Then Meridian runs on its own.',
    body: `1. Your first sweep runs within 24 hours.
   Meridian scans job market conditions, employer hiring activity, industry signals, and any risks or connections between your objectives.

2. You get an intelligence briefing — not a notification.
   Every sweep produces a confidence score, a signal summary, flagged risks, and a short list of recommended actions. Think of it as a weekly mission brief for your transition.

3. You mark actions complete. That's your main job.
   When you complete a recommended action — send an application, make a call, file a form — log it in Meridian. Each logged action immediately updates your confidence score with a cited reason. The system learns what's working.`,
  },
  {
    kicker: 'Two Things Worth Knowing · 4 of 5',
    title: 'Two things most users don\'t discover on their own.',
    subtitle: "Don't wait for the weekly sweep — you can act now.",
    body: null, // rendered with cards (Page6Illustration reused)
  },
  {
    kicker: 'Ready · 5 of 5',
    title: "You're set. Let's build your first objective.",
    subtitle: 'Start with a template or create your own.',
    body: `One more thing: Meridian works best when your objectives have enough detail for the signal engine to know what to watch. If you're not sure where to start, use the Career Transition Template — it gives you five pre-built objectives covering your target role, financial stabilization, credential build, and a personal milestone. You can edit any of them to fit your situation.`,
  },
]

// Example sets per onboarding_context — Page 2 body
const CAREER_TRANSITION_EXAMPLES = [
  {
    label: 'Career objective',
    text: '"Land a Program Manager role at Booz Allen, Leidos, or SAIC by December 2026. I hold a PMP and an active Secret clearance. Minimum salary $95K. Denver-Colorado Springs corridor only. Biggest risk: my military job titles don\'t map directly — I need the system to watch for roles where my experience qualifies even if the title says operations or supply chain."',
  },
  {
    label: 'Financial objective',
    text: '"No gap in health coverage between separation and first civilian paycheck. Activate VA disability claim before ETS. Understand TSP rollover window. Reserve balance stays above two months of expenses through Q1 2027."',
  },
  {
    label: 'Personal objective',
    text: '"Family road trip to Zion and Bryce Canyon by September 2027. Budget $4,500. Timing after financial stabilization confirms in Q1."',
  },
]

const BUSINESS_OWNER_EXAMPLES = [
  {
    label: 'Revenue objective',
    text: '"Reach $50K MRR by Q4 2026. I\'m at $32K now with a team of three. Main constraint: our largest client is 40% of revenue — I need to diversify before we grow headcount."',
  },
  {
    label: 'Hiring objective',
    text: '"Bring on two enterprise account executives by August 1. Compensation floor $80K base + commission. Target candidates with SaaS or B2B background in our vertical."',
  },
]

const PERSONAL_EXAMPLES = [
  {
    label: 'Financial objective',
    text: '"Pay off $18K in credit card debt by March 2027. Balance at zero, no new revolving debt, emergency fund at $5K. Biggest risk: an irregular income month could knock me off the payoff schedule."',
  },
  {
    label: 'Health objective',
    text: '"Complete a sprint triathlon by October. Training plan starts 16 weeks out. Key constraint: travel schedule in Q3 limits long-training weekends to 3 of 8."',
  },
]

const GENERAL_EXAMPLES = [
  {
    label: 'Business objective',
    text: '"Increase profits by 5% by end of Q3 2026. Lock in supplier pricing, raise service pricing on top margin lines, monitor competitor moves in our region."',
  },
  {
    label: 'Personal objective',
    text: '"Complete the half marathon in under 2:10 by October. Training starts 14 weeks out. Goal is top 40% of age group finishers."',
  },
]

const TEMPLATE_CTA: Record<string, { label: string; route: string }> = {
  career_transition: {
    label: 'Use the Career Transition Template →',
    route: '/onboarding/objective?template=career_transition',
  },
  business_owner: {
    label: 'Use the Business Objectives Template →',
    route: '/onboarding/objective?template=business_owner',
  },
  personal: {
    label: 'Use the Personal Goals Template →',
    route: '/onboarding/objective?template=personal',
  },
  general: {
    label: 'Start from scratch →',
    route: '/onboarding/objective',
  },
}

// ── Illustrations ───────────────────────────────────────────────────────────

function Page1Illustration() {
  const tiles = [
    { icon: <Target size={16} color={P.blue} />,              chipBg: 'rgba(46,124,184,.14)', label: 'Your Goals',        desc: "The objectives you're tracking, each with a live on-track score." },
    { icon: <Radio size={16} color="#A9861A" />,              chipBg: 'rgba(201,162,39,.18)', label: "This Week's Brief", desc: 'What changed — the signals Meridian found for you this week.' },
    { icon: <MessageCircle size={16} color={P.green} />,      chipBg: 'rgba(47,158,107,.15)', label: 'Ask Meridian',  desc: 'Ask questions or get hints about any goal, anytime.' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ backgroundColor: P.white, border: `1px solid ${P.line}`, borderRadius: 10, padding: '12px 10px' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.chipBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            {t.icon}
          </div>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: P.ink, margin: '0 0 4px' }}>{t.label}</p>
          <p style={{ fontSize: 11, color: P.muted, lineHeight: 1.4, margin: 0 }}>{t.desc}</p>
        </div>
      ))}
    </div>
  )
}

function Page2Illustration() {
  const tabs = ["What's affecting it", 'What to do', 'Goal']
  return (
    <div style={{ backgroundColor: P.white, border: `1px solid ${P.line}`, borderRadius: 10, padding: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, background: `conic-gradient(${P.amber} 255.6deg, ${P.line} 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: P.white, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: P.ink }}>71%</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: P.ink, lineHeight: 1.4, margin: '0 0 6px' }}>Land a Program Manager role at a defense contractor by Dec 2026</p>
          <span style={{ display: 'inline-block', backgroundColor: 'rgba(217,154,28,.16)', color: '#A9740C', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 999 }}>WATCH</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {tabs.map((tab, i) => (
          <div key={tab} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 500, whiteSpace: 'nowrap', backgroundColor: i === 0 ? P.navy : P.white, color: i === 0 ? P.white : P.muted, border: `1px solid ${i === 0 ? P.navy : P.line}` }}>
            {tab}
          </div>
        ))}
      </div>
    </div>
  )
}

function Page3Illustration() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ backgroundColor: P.white, border: `1px solid ${P.line}`, borderLeft: `4px solid ${P.red}`, borderRadius: 8, padding: '10px 12px' }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: P.red, letterSpacing: '0.10em', margin: '0 0 4px', textTransform: 'uppercase' }}>Risk</p>
        <p style={{ fontSize: 11, color: P.body, lineHeight: 1.4, margin: 0 }}>Target company paused external hiring through Q3 — Meridian flagged two alternative employers with open PM roles at similar compensation.</p>
      </div>
      <div style={{ backgroundColor: P.white, border: `1px solid ${P.line}`, borderLeft: `4px solid ${P.green}`, borderRadius: 8, padding: '10px 12px' }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: P.green, letterSpacing: '0.10em', margin: '0 0 4px', textTransform: 'uppercase' }}>Opportunity</p>
        <p style={{ fontSize: 11, color: P.body, lineHeight: 1.4, margin: 0 }}>Defense contractor hiring activity up 18% in your target region — your clearance level is in high demand this quarter.</p>
      </div>
    </div>
  )
}

function Page4Illustration() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ backgroundColor: P.white, border: `1px solid ${P.line}`, borderLeft: `4px solid ${P.gold}`, borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(201,162,39,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Check size={15} color={P.gold} strokeWidth={2.5} />
        </div>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: P.ink, margin: '0 0 3px' }}>Log what you actually did</p>
          <p style={{ fontSize: 11, color: P.body, lineHeight: 1.45, margin: 0 }}>In <strong style={{ color: P.ink }}>What to do</strong>, scroll to the bottom and tap <em>&ldquo;+ I did something &mdash; log it.&rdquo;</em> Your score updates immediately with a cited reason.</p>
        </div>
      </div>
      <div style={{ backgroundColor: P.white, border: `1px solid ${P.line}`, borderLeft: `4px solid ${P.blue}`, borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(46,124,184,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Settings size={15} color={P.blue} strokeWidth={2} />
        </div>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: P.ink, margin: '0 0 3px' }}>Edit any objective at any time</p>
          <p style={{ fontSize: 11, color: P.body, lineHeight: 1.45, margin: 0 }}>Tap the <strong style={{ color: P.ink }}>⚙ gear icon</strong> on any objective to update your target date, success condition, or target companies. Changes take effect on the next sweep.</p>
        </div>
      </div>
    </div>
  )
}

function Page5Illustration({ onUseTemplate }: { onUseTemplate: () => void }) {
  return (
    <div style={{ backgroundColor: P.white, border: `1.5px solid ${P.gold}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', backgroundColor: P.bg }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: P.ink, margin: '0 0 4px' }}>Career Transition Template</p>
        <p style={{ fontSize: 11, color: P.muted, margin: 0, lineHeight: 1.4 }}>5 pre-built objectives: target role, financial stabilization, credential build, relocation, and a personal milestone.</p>
      </div>
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${P.line}`, backgroundColor: P.white }}>
        <button
          onClick={onUseTemplate}
          style={{ display: 'inline-block', backgroundColor: P.navy, color: P.white, fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8, border: `1.5px solid ${P.gold}`, cursor: 'pointer' }}
        >
          Use the Career Transition Template →
        </button>
      </div>
    </div>
  )
}

const ILLUSTRATIONS = [Page1Illustration, Page2Illustration, Page3Illustration, Page4Illustration, Page5Illustration]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function TutorialModal({ open, onClose, startPage = 1, onOpenKeyTerms: _onOpenKeyTerms }: TutorialModalProps) {
  const [page, setPage] = useState(startPage - 1)
  const [context, setContext] = useState('general')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (open) setPage(startPage - 1)
  }, [open, startPage])

  useEffect(() => {
    if (!open) return
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('onboarding_context').eq('id', user.id).single()
        .then(({ data }) => {
          if (data?.onboarding_context) setContext(data.onboarding_context)
        })
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const current = PAGES[page]
  const IllustrationComp = ILLUSTRATIONS[page]
  const isLast = page === PAGES.length - 1
  const isFirst = page === 0
  const examples = { career_transition: CAREER_TRANSITION_EXAMPLES, business_owner: BUSINESS_OWNER_EXAMPLES, personal: PERSONAL_EXAMPLES, general: GENERAL_EXAMPLES }[context] ?? GENERAL_EXAMPLES
  const templateCTA = TEMPLATE_CTA[context] ?? TEMPLATE_CTA.general

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Welcome tour">
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(9,16,38,.55)', backdropFilter: 'blur(4px)' }} onClick={onClose} aria-hidden="true" />

      {/* Modal: explicit #FFFFFF bg + ink text — blocks any dark-mode ancestor cascade */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '90vh', backgroundColor: P.white, color: P.ink, borderRadius: 16, boxShadow: '0 30px 70px rgba(9,16,38,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Navy header band ─────────────────────────────────────────────────── */}
        <div style={{ background: `linear-gradient(135deg, ${P.navy}, ${P.navy2})`, padding: '20px 22px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <MeridianBeacon size={22} variant="gold" animate={true} arrowTip={true} />
              <span style={{ fontSize: 10, fontWeight: 700, color: P.gold, letterSpacing: '1.5px', textTransform: 'uppercase' }}>{current.kicker}</span>
            </div>
            <button
              onClick={onClose}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#AEB9D6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onMouseEnter={e => { e.currentTarget.style.color = P.white }}
              onMouseLeave={e => { e.currentTarget.style.color = '#AEB9D6' }}
              aria-label="Dismiss tour"
            >
              <X size={13} />
              Dismiss
            </button>
          </div>
          <h3 style={{ fontFamily: "'EB Garamond', serif", fontSize: 24, fontWeight: 500, color: P.white, margin: '0 0 6px', lineHeight: 1.25 }}>{current.title}</h3>
          <p style={{ fontSize: 13, color: '#CFD8EE', margin: 0 }}>{current.subtitle}</p>
        </div>

        {/* ── White body ───────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {/* Illustration panel */}
          <div style={{ backgroundColor: P.bg, border: `1px solid ${P.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            {page === 4
              ? <Page5Illustration onUseTemplate={() => { onClose(); router.push(TEMPLATE_CTA.career_transition.route) }} />
              : (() => { const C = IllustrationComp as React.FC; return <C /> })()
            }
          </div>

          {/* Body copy — page-specific */}
          {page === 1 ? (
            /* Page 2 — context-specific examples */
            <div>
              {examples.map((ex, i) => (
                <div key={i} style={{ marginBottom: i < examples.length - 1 ? 12 : 0, padding: '10px 12px', backgroundColor: P.bg, border: `1px solid ${P.line}`, borderRadius: 8 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: P.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 4px' }}>{ex.label}</p>
                  <p style={{ fontSize: 12, color: P.body, lineHeight: 1.55, margin: 0, fontStyle: 'italic' }}>{ex.text}</p>
                </div>
              ))}
              <p style={{ fontSize: 12, color: P.blue, margin: '12px 0 0', cursor: 'pointer' }} onClick={() => { setPage(4) }}>
                You can also use our Career Transition Template to start with pre-built objectives. →
              </p>
            </div>
          ) : page === 3 ? (
            /* Page 4 — Two things (illustration-only, no body text) */
            null
          ) : page === 4 ? (
            /* Page 5 — Ready */
            <p style={{ fontSize: 13, lineHeight: 1.65, color: P.body, margin: 0 }}>{current.body}</p>
          ) : (
            /* Pages 1, 3 — plain body text */
            current.body && (
              <p style={{ fontSize: 13, lineHeight: 1.65, color: P.body, margin: 0, whiteSpace: 'pre-line' }}>{current.body}</p>
            )
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', borderTop: `1px solid ${P.line}`, backgroundColor: P.white, flexShrink: 0 }}>
          {/* Dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {PAGES.map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                aria-label={`Page ${i + 1}`}
                style={{ height: 6, width: i === page ? 18 : 6, borderRadius: 999, backgroundColor: i === page ? P.gold : P.line, border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s' }}
              />
            ))}
          </div>

          {/* Nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isFirst && (
              <button
                onClick={() => setPage(p => p - 1)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', backgroundColor: P.white, color: P.ink, border: `1px solid ${P.line}` }}
              >
                <ChevronLeft size={14} /> Back
              </button>
            )}
            {isLast ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={onClose}
                  style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', backgroundColor: P.white, color: P.muted, border: `1px solid ${P.line}` }}
                >
                  Start from scratch
                </button>
                <button
                  onClick={() => { onClose(); router.push(templateCTA.route) }}
                  style={{ padding: '6px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', backgroundColor: P.navy, color: P.white, border: 'none' }}
                >
                  {templateCTA.label}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setPage(p => p + 1)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', backgroundColor: P.navy, color: P.white, border: 'none' }}
              >
                Next <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
