'use client'

// Collapsed "Removed objectives" list at the bottom of /strike (FF-096 Part 1). Hidden when empty.
// Restore calls POST /api/strike/objectives/[id]/restore. If the server refuses (for example because the
// trip window has ended), its message is shown here and the row stays.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { OTHER_OBJECTIVE_CLASSES as OC } from '@/lib/strike/otherObjectives'

export type RemovedObjective = { id: string; title: string }

export default function RemovedObjectives({ items }: { items: RemovedObjective[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (items.length === 0) return null

  async function restore(id: string) {
    setBusyId(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/strike/objectives/${id}/restore`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setMessage(body.error ?? 'Could not restore the objective. Try again.')
        return
      }
      router.refresh()
    } catch {
      setMessage('Could not restore the objective. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <details className="mt-2" data-testid="removed-objectives">
      <summary className={OC.removedSummary}>Removed objectives ({items.length})</summary>
      <div className={OC.card}>
        {items.map(item => (
          <div key={item.id} className={OC.removedRow}>
            <div className={OC.removedTitle}>{item.title}</div>
            <button
              type="button"
              onClick={() => restore(item.id)}
              disabled={busyId !== null}
              className={`${OC.restoreButton} disabled:bg-slate-600 disabled:text-slate-300`}
            >
              {busyId === item.id ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
      {message && <p role="alert" className={OC.removedMessage}>{message}</p>}
    </details>
  )
}
