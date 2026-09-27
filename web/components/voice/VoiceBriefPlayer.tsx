'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'
import { speak as speakTTS } from '@/lib/voice/ttsEngine'
import { VoiceBriefSection } from './VoiceBriefSection'

export type Section = 'knowledge' | 'risks_opportunities' | 'action_options' | 'scores'
const SECTION_ORDER: Section[] = ['knowledge', 'risks_opportunities', 'action_options', 'scores']

interface VoiceBriefPlayerProps {
  brief: VoiceBrief
  onTaskersReady: () => void
  initialSection?: Section
  autoPlay?: boolean
  onSectionChange?: (s: Section) => void
}

function buildScript(brief: VoiceBrief, section: Section): string {
  switch (section) {
    case 'knowledge':
      return brief.knowledge.map(k => {
        const fwd = k.fac_forward ? ` ${k.fac_forward}` : ''
        return `For your goal ${k.objective_title}: ${k.top_signal}.${fwd}`
      }).join(' ')

    case 'risks_opportunities': {
      const lines: string[] = []
      brief.risks.forEach(r => {
        if (r.items.length > 0) {
          lines.push(`Working against you on ${r.objective_title}: ${r.items.join(' and ')}.`)
        }
      })
      brief.opportunities.forEach(o => {
        if (o.items.length > 0) {
          lines.push(`Working for you on ${o.objective_title}: ${o.items.join(' and ')}.`)
        }
      })
      return lines.join(' ') || 'No significant risks or opportunities this sweep.'
    }

    case 'action_options':
      return brief.action_options.map(a =>
        `For ${a.objective_title}: ${a.actions.slice(0, 2).join('. ')}.`
      ).join(' ') || 'No recommended actions this sweep.'

    case 'scores':
      return brief.scores.map(s => {
        const dir = s.delta >= 0 ? 'up' : 'down'
        const mover = s.top_mover ? ' This was your biggest mover.' : ''
        return `Your ${s.objective_title} is at ${s.confidence}%, ${dir} ${Math.abs(s.delta)} points this week.${mover}`
      }).join(' ')
  }
}

export function VoiceBriefPlayer({ brief, onTaskersReady, initialSection, autoPlay, onSectionChange }: VoiceBriefPlayerProps) {
  const [currentSection, setCurrentSection] = useState<Section>(initialSection ?? 'knowledge')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const autoPlayedRef = useRef(false)

  const speak = useCallback((text: string, onEnd?: () => void) => {
    setIsPlaying(true)
    setIsPaused(false)
    void speakTTS(text, () => {
      setIsPlaying(false)
      onEnd?.()
    })
  }, [])

  const advanceSection = useCallback(() => {
    const idx = SECTION_ORDER.indexOf(currentSection)
    if (idx < SECTION_ORDER.length - 1) {
      const next = SECTION_ORDER[idx + 1]
      setCurrentSection(next)
      onSectionChange?.(next)
      speak(buildScript(brief, next), next === 'scores' ? onTaskersReady : undefined)
    } else {
      onTaskersReady()
    }
  }, [currentSection, brief, speak, onTaskersReady, onSectionChange])

  useEffect(() => {
    if (autoPlay && !autoPlayedRef.current) {
      autoPlayedRef.current = true
      speak(buildScript(brief, currentSection), currentSection === 'scores' ? onTaskersReady : undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePlay() {
    if (isPaused) {
      window.speechSynthesis.resume()
      setIsPlaying(true)
      setIsPaused(false)
    } else {
      speak(buildScript(brief, currentSection), currentSection === 'scores' ? onTaskersReady : undefined)
    }
  }

  function handlePause() {
    window.speechSynthesis.pause()
    setIsPlaying(false)
    setIsPaused(true)
  }

  function handleSkipSection() {
    window.speechSynthesis.cancel()
    advanceSection()
  }

  function handleSkipToTaskers() {
    window.speechSynthesis.cancel()
    onTaskersReady()
  }

  const currentObj = brief.knowledge[0]

  return (
    <div className="space-y-3">
      {/* Current section display */}
      <VoiceBriefSection label="Knowledge" isActive={currentSection === 'knowledge'}>
        {currentSection === 'knowledge' && currentObj && (
          <p>{currentObj.objective_title}</p>
        )}
      </VoiceBriefSection>

      <VoiceBriefSection label="Risks & Opportunities" isActive={currentSection === 'risks_opportunities'}>
        {currentSection === 'risks_opportunities' && (
          <p>{brief.risks.length + brief.opportunities.length} items</p>
        )}
      </VoiceBriefSection>

      <VoiceBriefSection label="Recommended Actions" isActive={currentSection === 'action_options'}>
        {currentSection === 'action_options' && (
          <p>{brief.action_options.length} objective{brief.action_options.length !== 1 ? 's' : ''} with actions</p>
        )}
      </VoiceBriefSection>

      <VoiceBriefSection label="Scores" isActive={currentSection === 'scores'}>
        {currentSection === 'scores' && (
          <p>{brief.scores.length} objective{brief.scores.length !== 1 ? 's' : ''} scored</p>
        )}
      </VoiceBriefSection>

      {/* Controls */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          className="flex-1 py-2 rounded-lg text-[13px] font-medium"
          style={{ backgroundColor: 'var(--blue)', color: '#fff' }}
        >
          {isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}
        </button>
        <button
          onClick={handleSkipSection}
          className="px-4 py-2 rounded-lg text-[13px]"
          style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          Skip section
        </button>
        <button
          onClick={handleSkipToTaskers}
          className="px-4 py-2 rounded-lg text-[13px]"
          style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          Skip to taskers
        </button>
      </div>
    </div>
  )
}
