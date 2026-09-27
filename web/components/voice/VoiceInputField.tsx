'use client'

import { useEffect } from 'react'
import { useVoice } from '@/lib/voice/useVoice'
import { VoiceMicButton } from '@/components/voice/VoiceMicButton'

interface VoiceInputFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
}

export function VoiceInputField({ value, onChange, placeholder, rows = 3, className, disabled }: VoiceInputFieldProps) {
  const { isSupported, isListening, transcript, interimTranscript, confidence, startListening, stopListening } = useVoice()

  useEffect(() => {
    if (transcript) {
      onChange(transcript)
    }
  }, [transcript, onChange])

  const lowConfidence = transcript && confidence > 0 && confidence < 0.92

  if (!isSupported) {
    return (
      <textarea
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        style={{ width: '100%', resize: 'none' }}
      />
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={isListening && interimTranscript ? undefined : placeholder}
        className={className}
        disabled={disabled}
        style={{
          width: '100%',
          resize: 'none',
          paddingRight: 48,
          outline: isListening ? '2px solid var(--blue)' : undefined,
          outlineOffset: isListening ? '2px' : undefined,
        }}
      />
      {isListening && interimTranscript && (
        <p
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 48,
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--text3)',
            pointerEvents: 'none',
          }}
        >
          {interimTranscript}
        </p>
      )}
      <div style={{ position: 'absolute', bottom: 4, right: 4 }}>
        <VoiceMicButton
          isListening={isListening}
          isSupported={isSupported}
          onStart={startListening}
          onStop={stopListening}
          size={15}
        />
      </div>
      {lowConfidence && (
        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          Review before submitting — low confidence transcription
        </p>
      )}
    </div>
  )
}
