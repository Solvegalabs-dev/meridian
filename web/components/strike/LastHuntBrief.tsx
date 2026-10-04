'use client'

import { useState } from 'react'
import { NOTICE_CLASSES } from '@/lib/strike/noticeStyles'

// Longer than about three lines at 375 px. Shorter text never gets a toggle.
const COLLAPSE_OVER_CHARS = 140

// Read-only history of the last real hunt verdict. Collapsed to about three lines.
export default function LastHuntBrief({ heading, synthesis }: { heading: string; synthesis: string | null }) {
  const [open, setOpen] = useState(false)
  const collapsible = synthesis !== null && synthesis.length > COLLAPSE_OVER_CHARS

  return (
    <div className={NOTICE_CLASSES.history}>
      <div className={NOTICE_CLASSES.historyHeading}>{heading}</div>
      {synthesis && (
        <p className={`mt-1 leading-relaxed ${collapsible && !open ? 'line-clamp-3' : ''}`}>{synthesis}</p>
      )}
      {collapsible && (
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="min-h-[44px] px-1 text-sm font-medium text-blue-300 hover:text-blue-200 transition-colors"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
