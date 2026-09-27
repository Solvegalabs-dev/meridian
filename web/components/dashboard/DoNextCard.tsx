'use client'

import { useState } from 'react'
import { Clock } from 'lucide-react'

interface DoNextCardProps {
  topAction: string | null
  moreActions: string[]
  hasSweep: boolean
}

export default function DoNextCard({ topAction, moreActions, hasSweep }: DoNextCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: 'rgba(201,162,39,0.05)', border: '1px solid rgba(201,162,39,0.2)' }}
    >
      <p className="text-[9px] uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--gold)' }}>
        <Clock size={11} />
        Do this first
      </p>

      {!hasSweep || !topAction ? (
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
          Run your first scan to get personalized action items.
        </p>
      ) : (
        <>
          <p className="text-[13px] leading-[1.45]" style={{ color: 'var(--ov-text-hi)' }}>
            {topAction}
          </p>

          {moreActions.length > 0 && (
            <>
              {!expanded ? (
                <button
                  onClick={() => setExpanded(true)}
                  className="text-[11px] font-medium mt-2"
                  style={{ color: 'var(--gold)' }}
                >
                  + {moreActions.length} more action{moreActions.length !== 1 ? 's' : ''}
                </button>
              ) : (
                <>
                  <ul className="mt-3 space-y-2">
                    {moreActions.map((action, i) => (
                      <li key={i} className="text-[13px] leading-[1.45]" style={{ color: 'var(--ov-text-mid)' }}>
                        {action}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => setExpanded(false)}
                    className="text-[11px] font-medium mt-3"
                    style={{ color: 'var(--gold)' }}
                  >
                    Collapse ↑
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
