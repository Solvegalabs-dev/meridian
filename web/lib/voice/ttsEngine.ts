import { useAppStore } from '@/store/useAppStore'

function getVoiceByName(name: string | null): SpeechSynthesisVoice | null {
  if (!name) return null
  return window.speechSynthesis.getVoices().find(v => v.name === name) ?? null
}

export async function speak(text: string, onEnd?: () => void): Promise<void> {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel()
    const { voiceType, voiceRate, voiceVolume } = useAppStore.getState()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = voiceRate ?? 1.0
    u.volume = voiceVolume ?? 1.0
    const voice = getVoiceByName(voiceType)
    if (voice) u.voice = voice
    u.onend = () => { onEnd?.(); resolve() }
    u.onerror = () => { onEnd?.(); resolve() }
    window.speechSynthesis.speak(u)
  })
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel()
}

export function isSpeaking(): boolean {
  return window.speechSynthesis.speaking
}

export async function getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) {
      resolve(voices.filter(v => v.lang.startsWith('en')))
      return
    }
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')))
    }
  })
}
