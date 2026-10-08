// The "Run Sweep" action, shared by Mission Control (components/dashboard/SweepButton.tsx) and Strike
// (components/strike/RunSweepButton.tsx). One sweep runs every active objective and counts once toward the
// 23-hour limit, so both buttons post the same empty body to /api/sweep and handle the answer the same way.

export type SweepHandlers = {
  onRateLimited: (nextSweepAt: string) => void
  onError: (message: string) => void
  onSuccess: (data: unknown) => void
  // Called after onSuccess so the page shows the new data.
  reload: () => void
}

// Posts to /api/sweep and reports what happened through the handlers:
//   429 with next_sweep_at  -> onRateLimited
//   any other failure       -> onError with the server's text, or "Sweep failed"
//   success                 -> onSuccess, then reload
export async function executeSweep(handlers: SweepHandlers, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl('/api/sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const data = await res.json() as { error?: string; next_sweep_at?: string; [key: string]: unknown }

    if (!res.ok) {
      if (res.status === 429 && data.next_sweep_at) handlers.onRateLimited(data.next_sweep_at)
      else handlers.onError(data.error ?? 'Sweep failed')
      return
    }

    handlers.onSuccess(data)
    handlers.reload()
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : 'Sweep failed')
  }
}

export function isRateLimited(nextSweepAt: string | null, now: number = Date.now()): boolean {
  return nextSweepAt !== null && new Date(nextSweepAt).getTime() > now
}

export function formatLastSweep(dateStr: string, now: number = Date.now()): string {
  const diffHours = Math.floor((now - new Date(dateStr).getTime()) / (1000 * 60 * 60))
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export function formatNextSweep(dateStr: string, now: number = Date.now()): string {
  const diffMs = new Date(dateStr).getTime() - now
  if (diffMs <= 0) return 'now'
  const mins = Math.ceil(diffMs / (1000 * 60))
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
}
