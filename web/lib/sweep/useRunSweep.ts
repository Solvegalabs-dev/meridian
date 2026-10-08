'use client'

// State for a Run Sweep button. Behaviour is the one SweepButton always had: "Sweeping..." while running, the
// rate-limited state on a 429, the server's error text on failure, and a full page reload on success.
import { useState } from 'react'
import { executeSweep, isRateLimited } from './runSweep'

export function useRunSweep(opts: { nextSweepAt?: string | null; onSweepComplete?: (result: unknown) => void } = {}) {
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextSweepAt, setNextSweepAt] = useState<string | null>(opts.nextSweepAt ?? null)

  const rateLimited = isRateLimited(nextSweepAt)

  async function run() {
    if (rateLimited || isRunning) return
    setIsRunning(true)
    setError(null)
    await executeSweep({
      onRateLimited: setNextSweepAt,
      onError: setError,
      onSuccess: data => opts.onSweepComplete?.(data),
      reload: () => window.location.reload(),
    })
    setIsRunning(false)
  }

  return { isRunning, error, nextSweepAt, rateLimited, disabled: isRunning || rateLimited, run }
}
