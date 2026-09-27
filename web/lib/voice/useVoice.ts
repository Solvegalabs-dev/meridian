'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any

declare global {
  interface Window {
    SpeechRecognition: new () => AnyRecognition
    webkitSpeechRecognition: new () => AnyRecognition
  }
}

interface UseVoiceReturn {
  isSupported: boolean
  isListening: boolean
  transcript: string
  interimTranscript: string
  confidence: number
  startListening: () => void
  stopListening: () => void
  resetTranscript: () => void
}

export function useVoice(): UseVoiceReturn {
  const [isSupported] = useState(() =>
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [confidence, setConfidence] = useState(0)
  const recognitionRef = useRef<AnyRecognition>(null)

  useEffect(() => {
    if (!isSupported) return
    const SpeechRecognitionCtor: new () => AnyRecognition =
      (window as Window).SpeechRecognition ?? (window as Window).webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return
    const recognition: AnyRecognition = new SpeechRecognitionCtor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: AnyRecognition) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const conf: number = result[0].confidence
          setTranscript(result[0].transcript as string)
          setConfidence(conf)
          setInterimTranscript('')
        } else {
          interim += result[0].transcript as string
        }
      }
      if (interim) setInterimTranscript(interim)
    }

    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    return () => {
      recognition.abort()
    }
  }, [isSupported])

  const startListening = useCallback(() => {
    if (!isSupported || !recognitionRef.current || isListening) return
    setTranscript('')
    setInterimTranscript('')
    setConfidence(0)
    recognitionRef.current.start()
    setIsListening(true)
  }, [isSupported, isListening])

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListening) return
    recognitionRef.current.stop()
    setIsListening(false)
  }, [isListening])

  const resetTranscript = useCallback(() => {
    setTranscript('')
    setInterimTranscript('')
    setConfidence(0)
  }, [])

  if (!isSupported) {
    return {
      isSupported: false,
      isListening: false,
      transcript: '',
      interimTranscript: '',
      confidence: 0,
      startListening: () => {},
      stopListening: () => {},
      resetTranscript: () => {},
    }
  }

  return { isSupported, isListening, transcript, interimTranscript, confidence, startListening, stopListening, resetTranscript }
}
