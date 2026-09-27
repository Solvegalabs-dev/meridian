'use client'

import { Mic, MicOff } from 'lucide-react'

interface VoiceMicButtonProps {
  isListening: boolean
  isSupported: boolean
  onStart: () => void
  onStop: () => void
  size?: number
}

export function VoiceMicButton({ isListening, isSupported, onStart, onStop, size = 16 }: VoiceMicButtonProps) {
  if (!isSupported) return null

  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={isListening ? onStop : onStart}
      style={{
        minWidth: 44,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isListening ? 'var(--blue)' : 'var(--text3)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
      aria-label={isListening ? 'Stop listening' : 'Start voice input'}
    >
      {isListening ? (
        <Mic size={size} className="animate-pulse" style={{ color: 'var(--blue)' }} />
      ) : (
        <MicOff size={size} />
      )}
    </button>
  )
}
