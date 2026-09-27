'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp } from 'lucide-react'

interface AskMeridianBarProps {
  context?: string
  placeholder?: string
  topObjectiveName?: string
  showChips?: boolean
  onSend?: (message: string) => void
}

export default function AskMeridianBar({
  placeholder = 'Ask Meridian about your goals or the world…',
  topObjectiveName,
  showChips = false,
  onSend,
}: AskMeridianBarProps) {
  const router = useRouter()
  const [value, setValue] = useState('')

  function submit(message: string) {
    const trimmed = message.trim()
    if (!trimmed) return

    if (onSend) {
      onSend(trimmed)
      setValue('')
      return
    }

    // Don't include `context` in the URL — /ask fetches its own sweep context
    // server-side, and a long sweep summary in the URL can exceed browser URL
    // length limits, silently dropping the `q` param and preventing auto-submit.
    router.push(`/ask?q=${encodeURIComponent(trimmed)}`)
  }

  const chips = [
    topObjectiveName ? `Is ${topObjectiveName} still on track?` : null,
    'What should I do this week?',
    "What's my biggest risk?",
  ].filter((c): c is string => !!c)

  return (
    <div
      className="sticky bottom-0 pt-8 pb-4 px-1"
      style={{ background: 'linear-gradient(to top, rgba(11,24,41,0.92), rgba(11,24,41,0))' }}
    >
      {showChips && (
        <div className="flex flex-wrap gap-2 mb-2 max-w-2xl mx-auto">
          {chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => submit(chip)}
              className="text-[11px] px-3 py-1.5 rounded-full"
              style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={e => { e.preventDefault(); submit(value) }}
        className="flex items-center gap-2 max-w-2xl mx-auto"
      >
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-4 py-3 rounded-full text-[13px] focus:outline-none"
          style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: '#fff' }}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!value.trim()}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50"
          style={{ backgroundColor: 'var(--blue)' }}
        >
          <ArrowUp size={16} color="#fff" />
        </button>
      </form>
    </div>
  )
}
