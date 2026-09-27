'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function DeferredTasksBanner() {
  const [count, setCount] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function loadCount() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { count: n } = await supabase
        .from('voice_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending')
      setCount(n ?? 0)
    }
    void loadCount()
  }, [supabase])

  async function handleDismiss() {
    setDismissed(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('voice_tasks')
      .update({ status: 'dismissed' })
      .eq('user_id', user.id)
      .eq('status', 'pending')
  }

  if (dismissed || count === null || count === 0) return null

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 mb-4"
      style={{ backgroundColor: 'rgba(46,124,184,0.12)', border: '1px solid rgba(46,124,184,0.25)' }}
    >
      <p className="text-[13px]" style={{ color: '#7ab3e0' }}>
        You have {count} deferred voice task{count !== 1 ? 's' : ''} from your drive.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href="/objectives"
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: 'var(--blue)', color: '#fff' }}
        >
          Resume
        </a>
        <button
          onClick={handleDismiss}
          className="text-[12px] px-2 py-1.5 rounded-lg"
          style={{ color: 'rgba(255,255,255,0.4)' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
