'use client'

import { useState } from 'react'
import Link from 'next/link'

// ── Types ────────────────────────────────────────────────────────────────────

type CalloutType = 'info' | 'gold' | 'caution'

type Step = { text: string }

type FAQItem = {
  id?: string
  q: string
  steps?: Step[]
  body?: string[]
  callout?: { type: CalloutType; text: string }
  list?: string[]
  secondCallout?: { type: CalloutType; text: string }
}

type Section = {
  id: string
  label: string
  items: FAQItem[]
}

// ── Content ──────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    id: 'objectives',
    label: 'Objectives / Goals',
    items: [
      {
        q: 'How do I see and review my original goal description?',
        steps: [
          { text: 'From the dashboard, tap the objective you want to review.' },
          { text: 'Select the Goal tab. Your original outcome statement, target date, and category are displayed here exactly as you entered them.' },
          { text: 'To edit the title, target date, or deadline type, tap the ⚙ gear icon in the top-right corner of any objective. Changes save immediately.' },
        ],
        callout: { type: 'info', text: 'Your original description drives every signal sweep and confidence assessment. If your goal has shifted significantly, update it so the engine stays calibrated to what you\'re actually working toward.' },
      },
      {
        q: 'How do I edit an objective\'s title, date, or other details?',
        steps: [
          { text: 'Open any objective and tap the ⚙ gear icon.' },
          { text: 'An edit drawer opens. Update the title, target date, deadline type, or any price/value fields relevant to your goal.' },
          { text: 'Changes persist immediately and are reflected in your next signal sweep.' },
        ],
        callout: { type: 'caution', text: 'Your confidence score, prediction history, and signal analysis are all tied to your original objective description and target date. Editing either one may shift how the engine interprets past and future sweeps. Your history is preserved — but the context the engine uses going forward will reflect your updated details.' },
      },
      {
        q: 'What does Pause Goal do?',
        body: [
          'Pause suspends your goal without closing it. Meridian won\'t send check-ins or run sweeps on it while it\'s paused, and it won\'t count against your active goal limit — freeing a slot if you want to start something new. You can resume at any time and pick up where you left off.',
          'Use Pause when life gets busy and you plan to come back. Use Close when you\'ve reached a deliberate decision. Use Abandon when a goal has simply fizzled with no real conclusion.',
        ],
        callout: { type: 'info', text: 'Paused goals appear in your active goal list with a Paused badge. They keep all their history, confidence data, and predictions — nothing is lost.' },
      },
      {
        q: 'Should I Close or Abandon a Goal?',
        body: [
          'Close a goal when you\'ve reached a deliberate decision — whether you achieved it, partially achieved it, or consciously decided to stop for reasons that came through the process. If you gathered signals, weighed the options, and landed somewhere intentional, that\'s a Close.',
          'Abandon a goal when it simply fizzled — you lost interest, life moved on, or it never really got traction. No real decision, just a fade.',
          'Not sure? If you can explain why, Close it. If you can\'t, Abandon it.',
        ],
      },
      {
        q: 'What are Archived Goals?',
        body: [
          'Archived Goals shows every goal you\'ve closed or abandoned. For each one you can see the outcome (HIT, PARTIAL, or MISS), the confidence score at the time you closed it, when it closed, and — if you expand it — your outcome note and the engine\'s last read on the goal.',
          'This isn\'t just a graveyard. It\'s a calibration record. The engine learns from closed goals over time.',
        ],
      },
      {
        q: 'Can I redo a goal?',
        body: [
          'Yes. Open the Archived tab, expand any closed or abandoned goal, and tap Clone this goal. A new goal form opens pre-filled with the original title, outcome description, notes, and target date.',
          'Review and update the details before saving — especially the target date, which will likely need adjusting. Cloning does not carry over your confidence history, predictions, or any tracking data from the original goal. It starts clean.',
        ],
      },
    ],
  },
  {
    id: 'actions',
    label: 'Actions & Logging',
    items: [
      {
        q: 'How do I log an action I completed toward an objective?',
        steps: [
          { text: 'Open the objective and tap the What to do tab.' },
          { text: 'Scroll to the bottom and tap + I did something.' },
          { text: 'Describe what you did, select a date, and optionally choose an action type. Tap Save.' },
        ],
        callout: { type: 'gold', text: 'Your confidence score updates immediately after logging. Each action you record is factored into the next sweep analysis — it\'s the fastest way to keep your score grounded between sweeps.' },
      },
      {
        q: 'How do I create a task from my actions list?',
        steps: [
          { text: 'Open an objective and go to the What to do tab. Meridian displays recommended next actions based on current signals.' },
          { text: 'Tap Add to calendar or Create task on any action chip to push it to your connected calendar as a scheduled event.' },
          { text: 'Once completed, return to the objective and log it using + I did something to close the loop and update your confidence score.' },
        ],
        callout: { type: 'info', text: 'Calendar must be connected for the task-to-event feature. See How do I connect my calendar? below.' },
      },
    ],
  },
  {
    id: 'sweeps',
    label: 'Signal Sweeps',
    items: [
      {
        q: 'How do I get more detailed signals and output insight?',
        body: ['Signal detail scales with two things: the quality of your objective description and your subscription tier.'],
        steps: [
          { text: 'Improve your description. Open the ⚙ gear icon and add specific context — company names, timelines, locations, dollar amounts. Vague descriptions produce vague signals.' },
          { text: 'Log your actions consistently. Every action you record is factored into the next sweep. The engine uses your real-world progress alongside external signals — the more you log, the more grounded the output becomes.' },
          { text: 'Upgrade your sweep frequency. Explorer receives one weekly sweep. Accelerator receives five weekly sweeps. Command receives one daily sweep — the most current signal picture available.' },
        ],
      },
      {
        q: 'Can I get extra signal sweeps for important objectives?',
        body: [
          'Yes. Signal sweep credits let you run additional sweeps on any plan at any time — useful when external conditions are changing fast and you need a fresh intelligence picture before your next scheduled sweep.',
          'Purchase signal sweep credits from Settings → Billing → Add sweep credits. Available in three bundles: 5 sweeps · $4 | 15 sweeps · $10 | 50 sweeps · $25. Credits don\'t expire and apply to any objective on your account.',
          'To use a credit, open an objective and tap Run Sweep. If your scheduled sweep isn\'t available yet, a credit will be consumed automatically.',
        ],
      },
      {
        q: 'How do I connect my calendar?',
        steps: [
          { text: 'Go to Settings and look for the Calendar section.' },
          { text: 'Tap Connect calendar and authorize access. Google Calendar and iCal feeds are supported.' },
          { text: 'Once connected, Meridian reads upcoming events and detects deadline collisions, prep windows, and scheduling conflicts across your active objectives — automatically surfaced in each sweep report.' },
        ],
        callout: { type: 'info', text: 'Calendar data is read-only. Meridian uses it for context only and does not modify, delete, or share your calendar events.' },
      },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts & Watch Sources',
    items: [
      {
        q: 'Can I add specific websites for Meridian Arc to monitor?',
        body: [
          'Yes. Inside any objective\'s settings drawer (gear icon), you can list watch sources — specific URLs or company names you want Meridian to check on every sweep cycle.',
          'If you provide a company name, Meridian infers the most relevant deep URL based on your objective. For example, if your objective contains a specific role at a specific company, Meridian resolves to the role\'s hiring category page — not the company homepage. (If general or no specific details are listed in your goal, Meridian may not know what to specifically point you at.)',
          'You can also set a priority tier (Critical, High, or Reference) to control how urgently Meridian treats a state change on that source.',
        ],
      },
      {
        q: 'Will Meridian Arc alert me when a time-sensitive opportunity appears?',
        body: [
          'Yes — and this is one of the most important capabilities for watch and decision objectives. When a watched source confirms a signal relevant to your objective, Meridian fires a priority alert before any other sweep output.',
          'Critical alerts appear as a gold banner on your dashboard and are delivered via email. SMS and push notifications are available on Accelerator and Command plans.',
        ],
        callout: { type: 'gold', text: 'Alerts are validated before they fire — Meridian confirms the page change is specifically relevant to your objective\'s success condition, not just any update on the page, before sending.' },
      },
      {
        q: 'How do I add my phone number to receive SMS alerts?',
        steps: [
          { text: 'Go to Settings → Notifications.' },
          { text: 'Find the SMS Alerts section and tap Add phone number.' },
          { text: 'Enter your mobile number and tap Send verification code. A 6-digit code is sent immediately.' },
          { text: 'Enter the code to confirm. Once verified, Meridian will send SMS alerts for Critical-tier signal events and priority changes on your active objectives.' },
        ],
        callout: { type: 'info', text: 'SMS alerts are available on Accelerator and Command plans. Explorer users receive email alerts only. You can remove or change your number at any time from Settings → Notifications.' },
      },
    ],
  },
  {
    id: 'predictions',
    label: 'Predictions & Confidence',
    items: [
      {
        q: 'How do I update my prediction score?',
        body: ['Confidence scores update automatically on two triggers: a completed signal sweep (scheduled or on-demand) and a logged action. You can also adjust them manually.'],
        steps: [
          { text: 'Open an objective and tap the Predictions tab.' },
          { text: 'Find the prediction you want to update and tap Edit. Adjust the confidence percentage and add a note explaining what changed.' },
          { text: 'The confidence history graph updates to reflect the change, with your note preserved as a causal annotation.' },
        ],
        callout: { type: 'info', text: 'Every prediction has a horizon date. When that date arrives, Meridian will prompt you to score the outcome — hit, miss, or partial. Scored outcomes are the calibration data that makes the engine more accurate over time.' },
      },
      {
        q: 'What does a confidence score actually mean?',
        body: [
          'A confidence score is an estimated percentage from 0–100 reflecting how likely you are to reach your stated goal given current signals, logged actions, and market conditions. A score of 78% means the evidence available right now supports a strong-but-not-certain path to your goal.',
          'Scores move up when new positive signals emerge or when you take meaningful action. They move down when conditions shift against your goal or when no progress is logged over time. The confidence history graph shows the full trajectory and the reason for each change.',
        ],
        callout: { type: 'info', text: 'Confidence scores are analytical outputs only. They are not financial, legal, career, or medical advice. Always verify recommendations independently before acting.' },
      },
      {
        id: 'what-is-a-prediction',
        q: 'What is a Prediction and How is it Used?',
        body: [
          'A prediction is a specific, time-bound forecast tied to one of your objectives — a statement of what you expect to happen by a specific date.',
          'Predictions are different from your overall confidence score. Your confidence score reflects the engine\'s ongoing probability estimate across all available evidence. A prediction is your own hypothesis: a bet you\'re making about a specific outcome with a specific deadline.',
          'Meridian scores each prediction when its horizon date arrives — was it accurate? Partially right? Missed the mark? These scored outcomes feed directly into the engine\'s calibration, making future confidence estimates more precise over time.',
        ],
        callout: { type: 'info', text: 'Each prediction you add is a data point in your own intelligence record. The more you log and score, the better Meridian learns what signals actually predict success for your specific objectives.' },
      },
      {
        id: 'adding-a-prediction',
        q: 'How do I add a prediction to a goal?',
        steps: [
          { text: 'Open any active objective and tap the Predictions tab.' },
          { text: 'Tap + New prediction. Write a specific, time-bound statement: "By [date], [specific outcome] will occur."' },
          { text: 'Set your confidence percentage (how likely you believe this is, from 10–95%) and a horizon date — the date by which you expect it to resolve.' },
          { text: 'Optionally link the prediction to a specific objective and add notes. Tap Create prediction.' },
        ],
        callout: { type: 'gold', text: 'Be specific. "I\'ll receive the job offer by September 15" is scorable. "Things will go well" is not. The more precise your prediction, the more useful the accuracy data when it resolves.' },
      },
      {
        id: 'what-is-accuracy',
        q: 'What is Accuracy and How is it Determined?',
        body: [
          'Accuracy measures how well a specific prediction matched what actually happened — not how successful the underlying outcome was.',
          'When a prediction\'s horizon date passes, you score it on a 1–5 scale: 5 = exactly right (outcome happened as stated); 3 = partially correct (right direction, wrong timing or magnitude); 1 = completely wrong.',
          'Accuracy scores are not the same as your confidence score. A confidence score estimates probability going forward. An accuracy score is a historical record of whether a specific forecast came true.',
        ],
        callout: { type: 'caution', text: 'Score honestly. Accuracy data feeds Meridian\'s calibration engine. Inflated scores make the engine less accurate for you over time, not more. The system is designed to help you see patterns clearly — including patterns of overconfidence.' },
      },
      {
        q: 'I logged an action and my confidence stayed the same or went down — why?',
        body: [
          'Logging an action is a positive input, but it does not automatically push confidence up. Confidence reflects the full picture: your logged progress and external signals and market conditions and time remaining.',
          'If external conditions worsened during the same sweep cycle — a hiring freeze announced, a competitor launched, rates moved against you — the engine may have absorbed negative signals that offset your logged progress. The net result can be flat or slightly lower.',
          'If no sweep has run since you logged the action, the impact won\'t show yet. Sweeps are the scoring cycle. Actions inform the next sweep, but don\'t bypass it.',
        ],
        callout: { type: 'info', text: 'You can trigger an on-demand sweep any time from the objective\'s page. If you\'ve made significant progress and want the score to reflect it now, a manual sweep is the fastest way to recalibrate.' },
      },
    ],
  },
  {
    id: 'ask',
    label: 'Ask Meridian',
    items: [
      {
        q: 'What does Ask Meridian do?',
        body: [
          'Ask Meridian is an on-demand intelligence query — it answers specific, time-sensitive questions about your objectives using real-time web data and your objective context together.',
          'Where a scheduled sweep monitors your goals broadly, Ask answers a specific question right now. Examples:',
        ],
        list: [
          '"Is this a good time to make an offer on the property given current rate trends?"',
          '"What is the best time of year to plan a trip to Florida?"',
          '"Should I wait on equipment purchases given current supply chain news?"',
        ],
        callout: { type: 'gold', text: 'Ask queries are included by tier: Explorer 5/month · Accelerator 10/month · Command 20/month. Additional queries are available via Ask Arc credits.' },
      },
      {
        q: 'How do I use Ask Meridian?',
        steps: [
          { text: 'Open any objective and tap the Ask tab, or tap the Ask button from the main dashboard.' },
          { text: 'Type your question in plain language. Be as specific as possible — include names, timeframes, and the decision you\'re trying to make.' },
          { text: 'Meridian searches the web, combines the results with your objective context, and returns a grounded answer with source citations and recommended next actions.' },
        ],
      },
      {
        q: 'How do Ask Arc credits work?',
        body: [
          'Ask Arc credits are query allotments you can purchase on top of your monthly plan quota. Each credit entitles you to one Ask query — a real-time, objective-grounded intelligence response.',
          'Credits are available in bundles from Settings → Billing → Add Ask Query Credits. They do not expire and stack with your monthly allowance.',
        ],
        list: [
          'Explorer — 5 queries/month included',
          'Accelerator — 10 queries/month included',
          'Command — 20 queries/month included',
        ],
        callout: { type: 'gold', text: 'Unused monthly queries do not roll over. Purchase credits if you anticipate a period of high-frequency use — a job search, a fast-moving acquisition, or a major financial decision.' },
      },
    ],
  },
  {
    id: 'voice',
    label: 'Voice Meridian',
    items: [
      {
        q: 'What is Voice Meridian?',
        body: [
          'Voice Meridian is the voice interface built into Meridian Arc. Tap the floating microphone button (bottom-right of any screen) to open it. Speak naturally — Meridian listens, understands your intent, and routes you to the right experience.',
          'You can hear your weekly intelligence brief aloud, log actions, score predictions, ask questions about your goals, and navigate the app entirely by voice — no typing required.',
        ],
      },
      {
        q: 'How do I activate Voice Meridian?',
        body: [
          'Tap the floating microphone button on the bottom-right of any screen. An activation tone plays and Meridian begins listening.',
          'Enable "Always use voice input" in Settings → Voice to keep voice as your primary input mode across all screens.',
        ],
        callout: { type: 'gold', text: 'First time? The first time you open Voice Meridian, you will hear a brief welcome message explaining what you can say and how the experience works. After that, Meridian goes straight to listening.' },
      },
      {
        q: 'What can I say?',
        body: ['Speak naturally — you do not need to memorize exact phrases. Meridian understands your intent. Key commands:'],
        list: [
          '"Read my week" / "Summary" → reads your weekly intelligence brief aloud',
          '"Log an action" / "I did something" → Action Runner walks you through logging',
          '"Score a prediction" / "Hit" / "Miss" → score open predictions by voice',
          '"Ask Meridian [question]" → Concierge answers questions about your goals (Command plan)',
          '"Driving mode" → activates eyes-free safe driving experience',
          '"How are my goals" / "Read my scores" → reads goal confidence scores and weekly deltas',
          '"New goal" → opens the new goal form with voice input',
          '"Help" → Meridian reads the command list aloud',
          '"Stop" / "Exit" → closes Voice Meridian',
        ],
      },
      {
        q: 'How does the Action Runner work?',
        body: [
          'Say "log an action" and Meridian walks through each item needing your input, one at a time. Meridian speaks a prompt, you respond by voice, Meridian confirms what it heard, then you say "yes" or "confirm" to log it.',
          'The five things you can log by voice:',
        ],
        list: [
          'Something you did on a goal ("I submitted the application on Thursday")',
          'A decision you made ("I decided to move forward with the offer")',
          'A contact made ("I called the recruiter")',
          'A prediction score — hit or miss',
          'A goal status change — achieve, pause, or close a goal',
        ],
        callout: { type: 'info', text: 'If Meridian cannot confidently parse what you said, it asks one clarifying question. While driving, unclear responses are held for later rather than asking you to repeat yourself.' },
      },
      {
        q: 'How does Driving Mode work?',
        body: ['Say "driving mode" or tap Start Driving Mode on your dashboard. Driving Mode is purpose-built for safe eyes-free use while driving.'],
        list: [
          'Screen shows only the current goal name and one large confirm button — no reading required',
          'All information is spoken aloud — you never need to look at the screen',
          'Responses are designed for three words or less: "yes," "no," "skip," "done," "hit," "miss"',
          'Every action is spoken back to you before being logged — confirm by saying "yes" or tapping once',
          'Unclear responses are held for when you are parked — no clarifying questions while driving',
          '"Meridian stop" immediately halts everything and deactivates the microphone',
        ],
        callout: { type: 'info', text: 'Tasks held during your drive appear as a notice when you next open Voice Meridian. Say "continue" or tap Continue to finish them.' },
      },
      {
        q: 'What are the three Voice Meridian layers?',
        body: ['Three layers, each unlocked by subscription tier:'],
        list: [
          'Voice Input (all plans — free): microphone on all screens; tap to speak anywhere. The floating mic button is the front door.',
          'Voice Brief + Action Runner (Accelerator and above, or Voice add-on at $9/mo on Explorer): Meridian reads your weekly brief aloud and walks you through logging actions and scoring predictions entirely by voice.',
          'Driving Mode (Command plan): eyes-free driving experience. Say "driving mode" to activate.',
        ],
        callout: { type: 'info', text: 'Asking Meridian questions about your goals is now available to all tiers through Ask Meridian — accessible from the sidebar. Goal questions cost 2 ask credits; world questions cost 1. Command plan users have higher monthly credit limits.' },
      },
      {
        q: 'What is the Concierge Engine?',
        body: [
          'The Concierge Engine is now part of unified Ask Meridian — accessible from the sidebar under "Ask Meridian." When you ask a question about your own goals, progress, scores, or predictions, Meridian automatically routes it to the Goal Intelligence engine (Claude Sonnet + your objective data). No separate page or plan required.',
          'Example questions:',
        ],
        list: [
          '"What do I need to do to get my Alaska Airlines goal to 90% confidence?"',
          '"What is blocking my captain upgrade bid right now?"',
          '"Should I focus on my investment account goal or my career goal this week?"',
          '"What happened with my elk hunt goal last week?"',
        ],
        callout: { type: 'gold', text: 'Goal Intelligence does not search the internet — it reasons over what Meridian already knows from your sweeps. Goal questions cost 2 ask credits (vs. 1 for world questions). Command plan users have higher monthly credit limits. Say "Ask Meridian" followed by your question, or visit Ask Meridian in the sidebar.' },
      },
      {
        q: 'Can I customize how Meridian sounds?',
        body: [
          'Yes. Go to Settings → Voice → Voice Personalization. Choose your preferred voice from available device voices, adjust reading speed (0.7× to 1.4×), and set the voice volume independently of your device volume. Use the Preview button to hear your selection before saving.',
        ],
        callout: { type: 'info', text: 'Natural AI voices with gender and accent options are coming soon. Current voices use your device\'s built-in text-to-speech engine.' },
      },
      {
        q: 'What does the gold dot on the microphone button mean?',
        body: [
          'A gold dot badge on the floating microphone button means your latest sweep has generated a new voice brief that you have not yet heard. Tap the mic, say "read my week," and the badge will clear after your brief completes.',
        ],
      },
      {
        q: 'What happens if I close Voice Meridian mid-session?',
        body: [
          'Unfinished tasks are saved automatically. The next time you open Voice Meridian, Meridian will let you know how many tasks are waiting and ask whether you want to continue where you left off or start fresh.',
          'Say "continue" or tap Continue to pick up where you stopped.',
        ],
      },
    ],
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    items: [
      {
        q: 'What is Meridian Fusion?',
        body: [
          'Meridian Fusion is the enterprise intelligence layer — a dedicated deployment of Meridian Arc built for teams, organizations, and high-stakes decision environments where a single-user account is not enough.',
          'Fusion expands the core platform to support multiple users tracking shared objectives, collaborative sweep analysis, team-level confidence aggregation, and organization-wide signal monitoring across parallel workstreams.',
        ],
        list: [
          'Shared objective libraries across a team or department',
          'Role-based access — analysts, decision-makers, and administrators with distinct permissions',
          'Aggregated confidence views across all active objectives in a portfolio',
          'Custom signal sources and watch lists at the organizational level',
          'Priority alert routing to team leads, Slack channels, or external systems via webhook',
          'Dedicated account support and custom sweep cadence',
        ],
        callout: { type: 'gold', text: 'Meridian Fusion is available by arrangement. Contact connect@solvega.ai for pricing, a custom demo, or to discuss requirements.' },
      },
    ],
  },
  {
    id: 'account',
    label: 'Account & Settings',
    items: [
      {
        q: 'How do I restart the onboarding tour?',
        steps: [
          { text: 'Tap Help & Tour in the top navigation bar.' },
          { text: 'Select Restart the tour. The full onboarding walkthrough will begin from step one.' },
        ],
      },
      {
        q: 'How many objectives can I track at once?',
        list: [
          'Trial — 3 objectives',
          'Explorer — 5 objectives',
          'Accelerator — 15 objectives',
          'Command — Unlimited objectives',
        ],
        callout: { type: 'info', text: 'If you\'ve reached your limit, you can archive an existing objective to free a slot without losing any of its data, signals, or history.' },
      },
      {
        q: 'How do I change my sweep frequency or upgrade my plan?',
        steps: [
          { text: 'Go to Settings → Billing.' },
          { text: 'Tap Change plan to see available tiers. Upgrades take effect immediately. Downgrades apply at the next billing cycle.' },
        ],
        callout: { type: 'gold', text: 'Sweep frequency by tier: Explorer · 1 weekly | Accelerator · 5 weekly | Command · 1 daily. Run extra sweeps any time with signal sweep credits.' },
      },
      {
        q: 'Is my objective data private?',
        body: [
          'Yes. Your objectives, confidence history, predictions, and action logs are private to your account by default. Meridian does not share individual user data with other users.',
          'Signal sweeps use external public data sources only — Meridian does not monitor your private accounts, messages, or files. Calendar data (if connected) is read-only and used solely to detect deadline and scheduling context for your objectives.',
          'For full details, review the Meridian Privacy Policy at /legal.',
        ],
      },
      {
        q: 'What does the confidence history graph show?',
        body: [
          'The confidence history graph traces how your objective\'s confidence score has moved over time, sweep by sweep. Each data point is annotated with the primary cause of the change — a new signal, a logged action, a market event, or a dependency update.',
          'This is your objective\'s intelligence record. A flat line means nothing has been logged or swept. A moving line means the engine is working and conditions are being tracked.',
        ],
      },
    ],
  },
]

// ── Callout component ─────────────────────────────────────────────────────────

function Callout({ type, text }: { type: CalloutType; text: string }) {
  const styles: Record<CalloutType, { bg: string; border: string; color: string; label: string }> = {
    info:    { bg: 'rgba(46,124,184,.08)',   border: 'rgba(46,124,184,.35)',  color: '#8AB4D4', label: 'Note' },
    gold:    { bg: 'rgba(201,162,39,.08)',   border: 'rgba(201,162,39,.4)',   color: '#E8C85A', label: 'Note' },
    caution: { bg: 'rgba(201,162,39,.08)',   border: 'rgba(201,162,39,.5)',   color: '#E8C85A', label: 'Caution' },
  }
  const s = styles[type]
  return (
    <div
      className="rounded-lg px-3.5 py-2.5 mt-3 text-[12.5px] leading-relaxed"
      style={{ background: s.bg, borderLeft: `2px solid ${s.border}`, color: s.color }}
    >
      <span className="font-semibold mr-1">{s.label}:</span>
      {text}
    </div>
  )
}

// ── Contact Modal ─────────────────────────────────────────────────────────────

function ContactModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [emailError, setEmailError] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  function validateEmail() {
    if (!email.trim()) { setEmailError('Email is required'); return false }
    if (!emailRegex.test(email.trim())) { setEmailError('Enter a valid email address'); return false }
    setEmailError('')
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateEmail()) return
    setStatus('submitting')
    try {
      const res = await fetch('/api/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), message: message.trim(), source: 'faq_page' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Server error')
      }
      setStatus('success')
      setTimeout(onClose, 2800)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,15,26,.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: '#0D1B3E', border: '1px solid rgba(255,255,255,.1)' }}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-[17px] font-semibold text-white">Send us a message</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,.45)' }}>We&apos;ll follow up within one business day.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text3)] hover:text-white transition-colors text-lg leading-none mt-0.5">✕</button>
        </div>

        {status === 'success' ? (
          <div className="py-6 text-center">
            <div className="text-[32px] mb-3">✓</div>
            <p className="text-[14px] font-medium text-white">Message received</p>
            <p className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,.5)' }}>We&apos;ll follow up within one business day.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'rgba(255,255,255,.7)' }}>
                Email address <span style={{ color: '#E8C85A' }}>*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={validateEmail}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none transition-colors"
                style={{
                  background: 'rgba(255,255,255,.06)',
                  border: `1px solid ${emailError ? 'rgba(220,80,80,.6)' : 'rgba(255,255,255,.12)'}`,
                  color: '#F7F6F3',
                }}
                disabled={status === 'submitting'}
              />
              {emailError && <p className="text-[11px] mt-1" style={{ color: '#e07070' }}>{emailError}</p>}
            </div>

            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'rgba(255,255,255,.7)' }}>
                Message <span style={{ color: '#E8C85A' }}>*</span>
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                placeholder="What's on your mind?"
                className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none resize-none transition-colors"
                style={{
                  background: 'rgba(255,255,255,.06)',
                  border: '1px solid rgba(255,255,255,.12)',
                  color: '#F7F6F3',
                }}
                disabled={status === 'submitting'}
              />
            </div>

            {status === 'error' && (
              <p className="text-[12px]" style={{ color: '#e07070' }}>
                Something went wrong. Please try again or email{' '}
                <a href="mailto:connect@solvega.ai" style={{ color: '#8AB4D4' }}>connect@solvega.ai</a>.
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full py-2.5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-60"
              style={{ background: '#C9A227', color: '#0B1829' }}
            >
              {status === 'submitting' ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ── FAQ Item (accordion row) ──────────────────────────────────────────────────

function FAQRow({ item, isOpen, onToggle }: { item: FAQItem; isOpen: boolean; onToggle: () => void }) {
  return (
    <div
      className="rounded-xl overflow-hidden transition-colors"
      style={{ border: `1px solid ${isOpen ? 'rgba(201,162,39,.25)' : 'rgba(255,255,255,.07)'}` }}
    >
      {item.id && <span id={item.id} className="sr-only" />}
      <button
        className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left"
        style={{ background: isOpen ? 'rgba(201,162,39,.04)' : 'rgba(255,255,255,.02)' }}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="text-[14px] font-medium leading-snug" style={{ color: isOpen ? '#fff' : 'rgba(255,255,255,.85)' }}>
          {item.q}
        </span>
        <span
          className="flex-shrink-0 mt-0.5 text-[11px] font-bold transition-transform"
          style={{ color: '#C9A227', transform: isOpen ? 'rotate(45deg)' : 'none' }}
        >
          ＋
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
          {item.body?.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed mb-2" style={{ color: 'rgba(255,255,255,.72)' }}>{p}</p>
          ))}

          {item.steps && (
            <ol className="flex flex-col gap-2 my-3">
              {item.steps.map((s, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                    style={{ background: 'rgba(46,124,184,.18)', border: '1px solid rgba(46,124,184,.3)', color: '#8AB4D4' }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,.72)' }}>{s.text}</span>
                </li>
              ))}
            </ol>
          )}

          {item.list && (
            <ul className="my-3 flex flex-col gap-1.5 pl-1">
              {item.list.map((l, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,.72)' }}>
                  <span style={{ color: '#C9A227' }}>·</span> {l}
                </li>
              ))}
            </ul>
          )}

          {item.callout && <Callout type={item.callout.type} text={item.callout.text} />}
          {item.secondCallout && <Callout type={item.secondCallout.type} text={item.secondCallout.text} />}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function FAQPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const visibleSections = activeSection
    ? SECTIONS.filter(s => s.id === activeSection)
    : SECTIONS

  function toggleItem(key: string) {
    setOpenItem(prev => prev === key ? null : key)
  }

  return (
    <div className="min-h-screen" style={{ background: '#060F1A', color: '#F7F6F3', fontFamily: 'Inter, sans-serif' }}>

      {/* Top bar */}
      <header
        className="sticky top-0 z-40 px-6 py-3 flex items-center justify-between"
        style={{ background: 'rgba(6,15,26,.92)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,.07)' }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span className="text-[13px] font-semibold" style={{ color: '#fff' }}>Meridian Arc</span>
        </Link>
        <Link
          href="/dashboard"
          className="text-[12px] px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'rgba(255,255,255,.55)', border: '1px solid rgba(255,255,255,.1)' }}
        >
          Back to app →
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-12">

        {/* Page header */}
        <div className="mb-10">
          <p className="text-[10px] font-semibold tracking-widest uppercase mb-2" style={{ color: '#5090C0' }}>
            Meridian Arc · Help Center
          </p>
          <h1 className="text-[32px] font-semibold mb-2" style={{ color: '#fff', fontFamily: 'Georgia, serif', fontWeight: 400 }}>
            Frequently Asked Questions
          </h1>
          <p className="text-[14px]" style={{ color: 'rgba(255,255,255,.5)' }}>
            36 answers across 9 categories. Click any question to expand.
          </p>
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => { setActiveSection(null); setOpenItem(null) }}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors"
            style={{
              background: activeSection === null ? '#C9A227' : 'rgba(255,255,255,.06)',
              color: activeSection === null ? '#0B1829' : 'rgba(255,255,255,.65)',
              border: '1px solid transparent',
            }}
          >
            All
          </button>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => { setActiveSection(activeSection === s.id ? null : s.id); setOpenItem(null) }}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors"
              style={{
                background: activeSection === s.id ? '#C9A227' : 'rgba(255,255,255,.06)',
                color: activeSection === s.id ? '#0B1829' : 'rgba(255,255,255,.65)',
                border: '1px solid transparent',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* FAQ sections */}
        <div className="flex flex-col gap-10">
          {visibleSections.map(section => (
            <div key={section.id}>
              <h2
                className="text-[11px] font-semibold uppercase tracking-widest mb-4"
                style={{ color: '#5090C0' }}
              >
                {section.label}
              </h2>
              <div className="flex flex-col gap-2">
                {section.items.map((item, i) => {
                  const key = `${section.id}-${i}`
                  return (
                    <FAQRow
                      key={key}
                      item={item}
                      isOpen={openItem === key}
                      onToggle={() => toggleItem(key)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="mt-16 pt-8 flex flex-col gap-4"
          style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}
        >
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,.5)' }}>
            Still have a question? Use Ask Meridian from any objective, or{' '}
            <button
              onClick={() => setShowModal(true)}
              className="underline transition-colors"
              style={{ color: '#8AB4D4', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit' }}
            >
              send us a message
            </button>.
          </p>
          <p className="text-[12px]" style={{ color: 'rgba(255,255,255,.3)' }}>
            Meridian Arc is an AI-powered intelligence tool. Confidence scores are analytical outputs — not professional advice. Always verify recommendations independently before acting.{' '}
            <Link href="/legal" className="underline" style={{ color: 'rgba(255,255,255,.4)' }}>
              Privacy Policy →
            </Link>
          </p>
        </div>
      </main>

      {showModal && <ContactModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
