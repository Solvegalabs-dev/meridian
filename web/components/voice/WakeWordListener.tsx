'use client'

import { useEffect, useRef } from 'react'
import { initPorcupine } from '@/lib/voice/porcupine'
import { useAppStore } from '@/store/useAppStore'

interface PorcupineSession {
  stop: () => Promise<void>
}

export function WakeWordListener() {
  const setWakeWordActive = useAppStore(s => s.setWakeWordActive)
  const sessionRef = useRef<PorcupineSession | null>(null)

  useEffect(() => {
    let cancelled = false

    function onWakeWord() {
      setWakeWordActive(true)

      // Short confirmation beep (440 Hz, 150ms)
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 440
        gain.gain.setValueAtTime(0.15, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.15)
        osc.onended = () => ctx.close()
      } catch {
        // audio context may be blocked before user gesture — silent
      }

      // Auto-reset after 5 seconds if no speech
      setTimeout(() => {
        if (!cancelled) setWakeWordActive(false)
      }, 5000)
    }

    initPorcupine(onWakeWord).then(session => {
      if (!cancelled) {
        sessionRef.current = session
      } else {
        void session?.stop()
      }
    })

    return () => {
      cancelled = true
      void sessionRef.current?.stop()
      sessionRef.current = null
    }
  }, [setWakeWordActive])

  return null
}
