'use client'

// "Plan again for next year" (FF-106 Stage 2 Part B): creates a new objective, one year out,
// from a finished one. Shared by the "..." menu and the closed-notice button on the Strike tab.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { limitReachedMessage, type LimitCategory } from '@/lib/strike/limitMessages'

type PlanAgainResponse = { objective_id?: string; error?: string; category?: LimitCategory; max?: number }

export default function PlanAgainButton({
  objectiveId,
  className,
  label = 'Plan again for next year',
}: {
  objectiveId: string
  className: string
  label?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function planAgain() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/strike/objectives/${objectiveId}/plan-again`, { method: 'POST' })
      const body = await res.json().catch(() => ({})) as PlanAgainResponse
      if (!res.ok) {
        setMessage(
          body.error === 'objective_limit_reached' && body.category && typeof body.max === 'number'
            ? limitReachedMessage(body.category, body.max)
            : body.error ?? 'Could not plan this again. Try again.'
        )
        setBusy(false)
        return
      }
      router.push(`/strike/${body.objective_id}`)
    } catch {
      setMessage('Could not plan this again. Try again.')
      setBusy(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={planAgain} disabled={busy} className={className}>
        {busy ? 'Planning…' : label}
      </button>
      {message && <p role="alert" className="mt-2 text-sm text-red-300 break-words">{message}</p>}
    </div>
  )
}
