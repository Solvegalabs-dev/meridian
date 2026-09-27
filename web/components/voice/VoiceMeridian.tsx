'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { X, HelpCircle, Mic } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'
import type { ConciergeResponse } from '@/lib/concierge/conciergePrompt'
import { classifyVoiceCommand, type VoiceRoute } from '@/lib/voice/commandRouter'
import { playActivateTone, playSuccessTone, playSkipTone, playErrorTone } from '@/lib/voice/soundSystem'
import { speak as speakTTS, stopSpeaking } from '@/lib/voice/ttsEngine'
import { isOnline } from '@/lib/voice/networkCheck'
import { useVoice } from '@/lib/voice/useVoice'
import { useAppStore } from '@/store/useAppStore'
import { createClient } from '@/lib/supabase/client'
import { VoiceBriefPlayer, type Section as BriefSection } from './VoiceBriefPlayer'
import { ActionRunner } from './ActionRunner'
import { DrivingMode } from './DrivingMode'
import { InlineAskResult } from './InlineAskResult'

type VMState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'routing' | 'in_feature'

const ONBOARDING_SCRIPT =
  'Welcome to Voice Meridian. I am your voice interface to your goals. ' +
  'You can say: read my week, log an action, or ask Meridian anything. ' +
  'Say help anytime to hear all commands. Let us get started.'

const RECOVERY_PHRASES = [
  'I did not catch that. Try: read my week, log an action, or ask Meridian a question.',
  'Not sure I understood. You can say: summary, log an action, or ask me anything.',
  'Say something like: read my week, log what I did, or ask Meridian.',
]

const HELP_SCRIPT =
  'Here is what you can say. ' +
  'Read my week — to hear your weekly brief. ' +
  'Log an action — to record what you did on a goal. ' +
  'Ask Meridian — followed by any question about your goals. ' +
  'Score a prediction — to mark a prediction hit or miss. ' +
  'Driving mode — for eyes-free use while driving. ' +
  'Say stop or close to exit. ' +
  'Say help anytime to hear this again.'

const HELP_COMMANDS = [
  'Read my week', 'Log an action', 'Ask Meridian',
  'Score a prediction', 'Driving mode', 'Stop',
]

interface VoiceMeridianProps {
  onClose: () => void
  initialBrief?: VoiceBrief | null
  onBriefHeard?: () => void
}

function speak(text: string, onEnd?: () => void): void {
  void speakTTS(text, onEnd)
}

function randomPhrase(): string {
  return RECOVERY_PHRASES[Math.floor(Math.random() * RECOVERY_PHRASES.length)]
}

function getDefaultChips(state: VMState, route: VoiceRoute | null): string[] {
  if (route === 'brief') return ['Skip section', 'Start taskers', 'Ask Meridian']
  if (route === 'action_runner' || route === 'score') return ['Next', 'Skip this', 'Stop']
  return ['Read my week', 'Log an action', 'Ask Meridian']
}

export function VoiceMeridian({ onClose, initialBrief, onBriefHeard }: VoiceMeridianProps) {
  const router = useRouter()
  const [vmState, setVMState] = useState<VMState>('idle')
  const [transcript, setTranscript] = useState('')
  const [currentRoute, setCurrentRoute] = useState<VoiceRoute | null>(null)
  const [activeFeature, setActiveFeature] = useState<'brief' | 'action_runner' | 'driving' | 'help' | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [pendingTaskCount, setPendingTaskCount] = useState(0)

  // FF-066 Fix 2: inline Ask state
  const [inlineAskQuery, setInlineAskQuery] = useState('')
  const [inlineAskResult, setInlineAskResult] = useState<ConciergeResponse | string | null>(null)

  // FF-066 Fix 3: brief tab recovery state
  const [showResumePrompt, setShowResumePrompt] = useState(false)
  const [briefPausedSection, setBriefPausedSection] = useState<BriefSection>('knowledge')
  const [briefRerenderKey, setBriefRerenderKey] = useState(0)

  // Refs for stale-closure-safe visibility handler
  const activeFeatureRef = useRef<typeof activeFeature>(null)
  const showResumePromptRef = useRef(false)
  const briefCurrentSectionRef = useRef<BriefSection>('knowledge')

  const retryRef = useRef(false)
  const { isSupported, transcript: liveTranscript, isListening, startListening, stopListening, resetTranscript } = useVoice()
  const { voiceOnboarded, setVoiceOnboarded, setPendingVoiceTaskCount } = useAppStore()

  // Sync refs
  useEffect(() => { activeFeatureRef.current = activeFeature }, [activeFeature])
  useEffect(() => { showResumePromptRef.current = showResumePrompt }, [showResumePrompt])

  const startListen = useCallback(() => {
    resetTranscript()
    setTranscript('')
    setVMState('listening')
    startListening()
  }, [resetTranscript, startListening])

  // On open: play activate tone then run open flow
  useEffect(() => {
    playActivateTone()
    if (!isOnline()) {
      setVMState('idle')
      return
    }
    void doOpenFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doOpenFlow() {
    if (!voiceOnboarded) {
      setVMState('speaking')
      await speakTTS(ONBOARDING_SCRIPT)
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_onboarded: true }),
      })
      setVoiceOnboarded(true)
    }

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { count } = await supabase
          .from('voice_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'pending')
        if (count && count > 0) {
          setPendingTaskCount(count)
          setPendingVoiceTaskCount(count)
        }
      }
    } catch {
      // non-fatal
    }

    if (isSupported) startListen()
    else setVMState('idle')
  }

  // FF-066 Fix 3: tab visibility handler — uses refs to avoid stale closures
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (activeFeatureRef.current === 'brief') {
          stopSpeaking()
          setBriefPausedSection(briefCurrentSectionRef.current)
          setShowResumePrompt(true)
        }
      } else {
        if (showResumePromptRef.current) {
          setVMState('speaking')
          speak('Welcome back. Want me to continue your brief?', () => {
            setVMState('idle')
          })
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Track live transcript
  useEffect(() => {
    if (liveTranscript) setTranscript(liveTranscript)
  }, [liveTranscript])

  // When listening stops and we have a transcript, classify
  useEffect(() => {
    if (!isListening && transcript && vmState === 'listening') {
      void handleTranscript(transcript)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening])

  async function handleTranscript(text: string) {
    setVMState('thinking')
    const { route, extractedQuery } = await classifyVoiceCommand(text)
    setCurrentRoute(route)
    setVMState('routing')
    await dispatch(route, extractedQuery)
  }

  // FF-066 Fix 2: all voice Ask queries handled inline — Hands-Free Contract
  async function doInlineAsk(query: string) {
    setVMState('thinking')
    setInlineAskQuery(query)
    setInlineAskResult(null)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query, intent: 'internal' }),
      })
      const data = await res.json() as { response: ConciergeResponse | string }
      const response = data.response
      setInlineAskResult(response)
      const prose = typeof response === 'object' ? response.answer_prose : String(response)
      const topAction =
        typeof response === 'object' && response.ranked_actions?.[0]
          ? ` You could: ${response.ranked_actions[0].action}.`
          : ''
      setVMState('speaking')
      speak(prose + topAction, () => {
        setVMState('idle')
        setTimeout(() => {
          setInlineAskResult(null)
          setInlineAskQuery('')
          speak('Anything else?', () => {
            if (isSupported) startListen()
          })
        }, 8000)
      })
    } catch {
      speak("Sorry, I couldn't get an answer right now.", () => {
        setVMState('idle')
        if (isSupported) startListen()
      })
    }
  }

  async function dispatch(route: VoiceRoute, extractedQuery?: string) {
    if (route === 'stop') {
      playSkipTone()
      onClose()
      return
    }

    if (route === 'help') {
      setVMState('speaking')
      speak(HELP_SCRIPT, () => {
        setShowHelp(true)
        setVMState('in_feature')
        setActiveFeature('help')
      })
      return
    }

    if (route === 'brief') {
      setVMState('speaking')
      speak('Reading your week.', () => {
        setVMState('in_feature')
        setActiveFeature('brief')
      })
      return
    }

    if (route === 'action_runner') {
      setVMState('speaking')
      speak('Opening your taskers.', () => {
        setVMState('in_feature')
        setActiveFeature('action_runner')
      })
      return
    }

    if (route === 'score') {
      setVMState('speaking')
      speak("Let's score your predictions.", () => {
        setVMState('in_feature')
        setActiveFeature('action_runner')
      })
      return
    }

    // FF-066 Fix 2: inline Ask — never navigate away
    if (route === 'concierge') {
      const query = extractedQuery ?? ''
      setVMState('speaking')
      speak('Asking Meridian.', () => {
        void doInlineAsk(query)
      })
      return
    }

    if (route === 'driving_mode') {
      setVMState('speaking')
      speak('Starting driving mode.', () => {
        setVMState('in_feature')
        setActiveFeature('driving')
      })
      return
    }

    if (route === 'scores') {
      if (initialBrief && initialBrief.scores.length > 0) {
        const scoreText = initialBrief.scores
          .map(s => {
            const dir = s.delta >= 0 ? 'up' : 'down'
            return `Your ${s.objective_title} is at ${s.confidence}%, ${dir} ${Math.abs(s.delta)} points.`
          })
          .join(' ')
        setVMState('speaking')
        speak("Here are your goal scores. " + scoreText, () => {
          setVMState('idle')
        })
      } else {
        speak("No sweep scores available yet.", () => setVMState('idle'))
      }
      return
    }

    if (route === 'new_goal') {
      setVMState('speaking')
      speak('Opening new goal.', () => {
        router.push('/objectives/new')
        onClose()
      })
      return
    }

    // unknown — recovery
    if (!retryRef.current) {
      retryRef.current = true
      setVMState('speaking')
      speak(randomPhrase(), () => {
        retryRef.current = false
        if (isSupported) startListen()
        else setVMState('idle')
      })
    } else {
      retryRef.current = false
      playErrorTone()
      setVMState('idle')
    }
  }

  function handleFeatureComplete() {
    if (activeFeature === 'brief') {
      onBriefHeard?.()
    }
    playSuccessTone()
    setActiveFeature(null)
    setCurrentRoute(null)
    setShowHelp(false)
    setShowResumePrompt(false)
    setVMState('speaking')
    speak('All done. Anything else?', () => {
      if (isSupported) startListen()
      else setVMState('idle')
    })
  }

  function handleInterrupt() {
    if (vmState === 'speaking') {
      stopSpeaking()
      playActivateTone()
      if (isSupported) startListen()
    }
  }

  function handleChipTap(cmd: string) {
    stopListening()
    stopSpeaking()
    void handleTranscript(cmd)
  }

  const chips = getDefaultChips(vmState, currentRoute)

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ backgroundColor: 'rgba(15, 30, 53, 0.96)' }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <button
          onClick={() => {
            playSkipTone()
            stopSpeaking()
            onClose()
          }}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Close Voice Meridian"
        >
          <X size={24} />
        </button>
        <button
          onClick={() => void handleTranscript('help')}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Help"
        >
          <HelpCircle size={22} />
        </button>
      </div>

      {/* Logo */}
      <div className="text-center mt-2">
        <span className="text-[13px] uppercase tracking-[0.15em]" style={{ color: 'var(--gold, #C8A84B)' }}>
          ◉ MERIDIAN
        </span>
      </div>

      {/* Pending tasks notice */}
      {pendingTaskCount > 0 && vmState !== 'in_feature' && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(200,168,75,0.1)', border: '1px solid rgba(200,168,75,0.3)' }}>
          <p className="text-[12px]" style={{ color: 'var(--gold, #C8A84B)' }}>
            {pendingTaskCount} pending task{pendingTaskCount !== 1 ? 's' : ''} from last session
          </p>
        </div>
      )}

      {/* Visual state display */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        {vmState === 'listening' && (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleInterrupt}
              className="w-20 h-20 rounded-full animate-pulse flex items-center justify-center"
              style={{ backgroundColor: 'var(--gold, #C8A84B)' }}
              aria-label="Listening"
            >
              <Mic size={32} color="#0F1E35" />
            </button>
            <span className="text-white/70 text-sm">Listening...</span>
          </div>
        )}

        {(vmState === 'thinking' || vmState === 'routing') && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, backgroundColor: '#1A2E45' }}
                />
              ))}
            </div>
            <span className="text-white/70 text-sm">Thinking...</span>
          </div>
        )}

        {vmState === 'speaking' && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-1 items-end h-10">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="w-2 rounded-sm animate-bounce"
                  style={{
                    height: `${16 + i * 6}px`,
                    animationDelay: `${i * 0.1}s`,
                    backgroundColor: 'var(--gold, #C8A84B)',
                  }}
                />
              ))}
            </div>
            <span className="text-white/70 text-sm">Speaking...</span>
          </div>
        )}

        {vmState === 'idle' && (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => {
                if (isSupported) {
                  playActivateTone()
                  startListen()
                }
              }}
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'rgba(200, 168, 75, 0.4)' }}
              aria-label="Tap to speak"
            >
              <Mic size={26} style={{ color: 'var(--gold, #C8A84B)' }} />
            </button>
            <span className="text-white/50 text-sm">Tap to speak</span>
          </div>
        )}

        {/* FF-066 Fix 2: inline Ask result card */}
        {inlineAskResult && (
          <InlineAskResult
            query={inlineAskQuery}
            response={inlineAskResult}
            onDismiss={() => {
              setInlineAskResult(null)
              setInlineAskQuery('')
            }}
          />
        )}

        {/* Live transcript */}
        {transcript && vmState !== 'in_feature' && !inlineAskResult && (
          <p className="text-white text-center text-sm max-w-sm opacity-80">{transcript}</p>
        )}

        {/* Active feature — brief */}
        {vmState === 'in_feature' && activeFeature === 'brief' && initialBrief && (
          <div className="w-full max-w-md">
            <VoiceBriefPlayer
              key={briefRerenderKey}
              brief={initialBrief}
              onTaskersReady={handleFeatureComplete}
              initialSection={briefPausedSection}
              autoPlay={briefRerenderKey > 0}
              onSectionChange={(s) => { briefCurrentSectionRef.current = s }}
            />
          </div>
        )}

        {vmState === 'in_feature' && (activeFeature === 'action_runner' || activeFeature === 'brief' && !initialBrief) && initialBrief && (
          <div className="w-full max-w-md">
            <ActionRunner
              brief={initialBrief}
              onComplete={handleFeatureComplete}
              onConciergeRequest={(q) => {
                // FF-066 Fix 2: inline Ask from ActionRunner — Hands-Free Contract
                void doInlineAsk(q ?? '')
                setActiveFeature(null)
                setVMState('thinking')
              }}
            />
          </div>
        )}

        {vmState === 'in_feature' && activeFeature === 'driving' && initialBrief && (
          <div className="w-full max-w-md">
            <DrivingMode brief={initialBrief} onExit={handleFeatureComplete} />
          </div>
        )}

        {vmState === 'in_feature' && activeFeature === 'help' && showHelp && (
          <div className="w-full max-w-sm rounded-xl p-5" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-white/60 text-xs uppercase tracking-wider mb-3">What you can say</p>
            <ul className="space-y-2">
              {HELP_COMMANDS.map(cmd => (
                <li key={cmd} className="text-white text-sm">• {cmd}</li>
              ))}
            </ul>
            <button
              onClick={() => { setActiveFeature(null); setShowHelp(false); if (isSupported) startListen() }}
              className="mt-4 text-xs text-white/50 hover:text-white/80"
            >
              Got it →
            </button>
          </div>
        )}
      </div>

      {/* FF-066 Fix 3: resume prompt chips (tab return recovery) */}
      {showResumePrompt && vmState !== 'in_feature' && (
        <div className="flex justify-center gap-3 px-6 pb-8 pt-4">
          <button
            onClick={() => {
              setShowResumePrompt(false)
              setBriefRerenderKey(k => k + 1)
              setVMState('in_feature')
              setActiveFeature('brief')
            }}
            className="px-4 py-2 rounded-full text-sm text-white border border-white/30 hover:border-white/60 transition-all"
          >
            Continue
          </button>
          <button
            onClick={() => {
              setShowResumePrompt(false)
              setBriefPausedSection('knowledge')
              setBriefRerenderKey(k => k + 1)
              setVMState('in_feature')
              setActiveFeature('brief')
            }}
            className="px-4 py-2 rounded-full text-sm text-white/60 border border-white/20 hover:border-white/40 transition-all"
          >
            Start over
          </button>
        </div>
      )}

      {/* Command chips */}
      {vmState !== 'in_feature' && !showResumePrompt && (
        <div className="flex justify-center gap-2 px-6 pb-8 pt-4 flex-wrap">
          {chips.map(chip => (
            <button
              key={chip}
              onClick={() => handleChipTap(chip)}
              className="px-3 py-1.5 rounded-full text-xs text-white/70 border border-white/20 hover:border-white/40 hover:text-white transition-all"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
