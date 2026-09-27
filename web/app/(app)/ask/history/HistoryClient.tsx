'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { timeAgo } from '@/lib/utils/timeAgo'

interface AskHistoryRow {
  id: string
  question: string
  response: string | null
  web_search_used: boolean | null
  credits_used: number | null
  created_at: string | null
}

interface Props {
  rows: AskHistoryRow[]
}

function getDateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function HistoryClient({ rows }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <p style={{ color: 'var(--ov-text-dim)' }}>
          No Ask Meridian history yet.{' '}
          <Link href="/ask" style={{ color: 'var(--gold)' }}>
            Ask your first question to get started.
          </Link>
        </p>
      </div>
    )
  }

  // Group rows by date label, preserving DESC order from server
  const groups = new Map<string, AskHistoryRow[]>()
  for (const row of rows) {
    const label = row.created_at ? getDateLabel(row.created_at) : 'Unknown'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(row)
  }

  return (
    <div className="max-w-2xl mx-auto">
      {Array.from(groups.entries()).map(([label, groupRows]) => (
        <div key={label}>
          <p
            className="text-[10px] uppercase tracking-widest font-semibold mt-6 mb-2"
            style={{ color: 'var(--blue-mid)' }}
          >
            {label}
          </p>

          <div className="flex flex-col gap-2">
            {groupRows.map(row => {
              const isExpanded = expanded.has(row.id)
              return (
                <div
                  key={row.id}
                  style={{
                    backgroundColor: 'var(--ov-navy-card)',
                    border: '1px solid var(--ov-border-md)',
                    borderRadius: 12,
                  }}
                >
                  <button
                    onClick={() => toggle(row.id)}
                    className="w-full px-4 py-3 flex items-start justify-between gap-3"
                  >
                    <p
                      className="text-[13px] font-medium text-left"
                      style={{ color: 'var(--ov-text-hi)' }}
                    >
                      {row.question}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {row.web_search_used && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--blue-mid)', color: '#fff', opacity: 0.85 }}
                        >
                          Web
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: 'var(--ov-text-dim)' }}>
                        {row.created_at ? timeAgo(row.created_at) : ''}
                      </span>
                      <ChevronDown
                        size={14}
                        style={{ color: 'var(--ov-text-dim)', transform: isExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      className="px-4 pb-4 pt-1 border-t"
                      style={{ borderColor: 'var(--ov-border)' }}
                    >
                      <p
                        className="text-[12px] leading-relaxed whitespace-pre-wrap"
                        style={{ color: 'var(--ov-text-mid)' }}
                      >
                        {row.response}
                      </p>
                      <p className="text-[10px] mt-2" style={{ color: 'var(--ov-text-dim)' }}>
                        {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                        {row.credits_used ? ` · ${row.credits_used} credit used` : ''}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
