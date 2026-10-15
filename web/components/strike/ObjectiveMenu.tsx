'use client'

// "..." menu in the strike objective header (FF-096 Part 1; FF-106 Stage 2 Part B adds Plan again).
// Hidden entirely when nothing can be done, so a campaign unit with no finished window shows no menu.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PlanAgainButton from './PlanAgainButton'

export const REMOVE_CONFIRM_TEXT = (title: string) =>
  `Remove ${title}? It disappears from your list. You can restore it from Removed objectives.`

const MENU_ITEM = 'w-full min-h-[44px] px-4 text-left text-sm text-slate-100 hover:bg-slate-700 rounded-lg transition-colors'

// Presentational pieces, exported so their markup can be tested without a browser.
export function MenuPanel({ objectiveId, onRemove, showPlanAgain }: {
  objectiveId: string; onRemove?: () => void; showPlanAgain?: boolean
}) {
  return (
    <div role="menu" className="absolute right-0 top-full z-20 w-56 rounded-lg bg-slate-800 border border-slate-600 shadow-lg">
      {showPlanAgain && <PlanAgainButton objectiveId={objectiveId} className={MENU_ITEM} />}
      {onRemove && (
        <button
          type="button"
          role="menuitem"
          onClick={onRemove}
          className="w-full min-h-[44px] px-4 text-left text-sm text-red-300 hover:bg-slate-700 rounded-lg transition-colors"
        >
          Remove objective
        </button>
      )}
    </div>
  )
}

export function RemoveConfirm({ title, busy, message, onCancel, onRemove }: {
  title: string; busy: boolean; message: string | null; onCancel: () => void; onRemove: () => void
}) {
  return (
    <div role="alertdialog" aria-label="Remove objective" className="fixed inset-x-0 bottom-0 z-30 bg-slate-800 border-t border-slate-600 px-4 py-4 space-y-3">
      <p className="text-sm text-slate-100 break-words">{REMOVE_CONFIRM_TEXT(title)}</p>
      {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 min-h-[44px] rounded-lg text-sm font-medium bg-slate-700 text-white hover:bg-slate-600 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="flex-1 min-h-[44px] rounded-lg text-sm font-medium bg-red-700 text-white hover:bg-red-600 transition-colors disabled:bg-slate-600 disabled:text-slate-300"
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

export default function ObjectiveMenu({ objectiveId, title, canRemove, canPlanAgain = false }: {
  objectiveId: string; title: string; canRemove: boolean; canPlanAgain?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!canRemove && !canPlanAgain) return null

  async function remove() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/strike/objectives/${objectiveId}/archive`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setMessage(body.error ?? 'Could not remove the objective. Try again.')
        setBusy(false)
        return
      }
      router.push('/strike')
      router.refresh()
    } catch {
      setMessage('Could not remove the objective. Try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-label="Objective options"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(o => !o); setConfirming(false); setMessage(null) }}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lg text-slate-200 hover:text-white transition-colors"
        >
          <span aria-hidden="true">···</span>
        </button>
        {open && !confirming && (
          <MenuPanel
            objectiveId={objectiveId}
            showPlanAgain={canPlanAgain}
            onRemove={canRemove ? () => setConfirming(true) : undefined}
          />
        )}
      </div>

      {open && confirming && (
        <RemoveConfirm
          title={title}
          busy={busy}
          message={message}
          onCancel={() => { setConfirming(false); setOpen(false) }}
          onRemove={remove}
        />
      )}
    </>
  )
}
