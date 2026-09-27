let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(
  frequencies: number[],
  durationMs: number,
  type: OscillatorType = 'sine'
): void {
  const audioCtx = getCtx()
  const now = audioCtx.currentTime
  const stepMs = durationMs / frequencies.length

  frequencies.forEach((freq, i) => {
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.type = type
    osc.frequency.value = freq

    const start = now + (i * stepMs) / 1000
    const end = start + stepMs / 1000

    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.3, start + 0.01)
    gain.gain.linearRampToValueAtTime(0, end - 0.01)

    osc.start(start)
    osc.stop(end)
  })
}

// A4 → C5 ascending two-note ping (160ms) — mic is listening
export function playActivateTone(): void {
  playTone([440, 523], 160)
}

// C5 → E5 → G5 ascending chime (180ms) — action logged / done
export function playSuccessTone(): void {
  playTone([523, 659, 784], 180)
}

// G4 single click (60ms) — skipped / closed
export function playSkipTone(): void {
  playTone([392], 60)
}

// E4 → C4 descending two-note (160ms) — error / offline
export function playErrorTone(): void {
  playTone([330, 262], 160)
}
