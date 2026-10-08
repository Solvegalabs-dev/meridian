'use client'

// Shown instead of the brief for a removed objective (FF-096 Part 1). The page only renders it for the owner.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RemovedObjectiveNotice({ objectiveId, title }: { objectiveId: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function restore() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/strike/objectives/${objectiveId}/restore`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setMessage(body.error ?? 'Could not restore the objective. Try again.')
        return
      }
      router.refresh()
    } catch {
      setMessage('Could not restore the objective. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white px-4 py-6 space-y-4">
      <Link href="/strike" className="inline-flex items-center min-h-[44px] text-sm text-slate-200 hover:text-white">
        ← Objectives
      </Link>
      <div className="bg-slate-800 rounded-xl px-4 py-5 space-y-3">
        <h1 className="text-lg font-semibold break-words">This objective was removed</h1>
        <p className="text-sm text-slate-200 break-words">{title}</p>
        <p className="text-sm text-slate-300">It is hidden from your list. Restore it to see its brief again.</p>
        <button
          type="button"
          onClick={restore}
          disabled={busy}
          className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:bg-slate-600 disabled:text-slate-300"
        >
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        {message && <p role="alert" className="text-sm text-slate-100">{message}</p>}
      </div>
    </div>
  )
}
