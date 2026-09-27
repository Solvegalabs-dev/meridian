'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'

const BLUE  = '#2D6BE4'
const TEXT  = '#1A1A2E'
const MUTED = '#6B7280'

const CHAR_THRESHOLD = 400

const CASE_REF_PATTERN = /\b([A-Z]{2,5}-[A-Z]-\d{3,})\b/g

export interface CaseMap {
  [caseRef: string]: {
    alias: string | null
    elementId: string
  }
}

function linkifyCaseRefs(text: string, caseMap: CaseMap): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0

  CASE_REF_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CASE_REF_PATTERN.exec(text)) !== null) {
    const ref = match[1]
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const entry = caseMap[ref]
    if (entry) {
      parts.push(
        <a
          key={`${ref}-${match.index}`}
          href={`#${entry.elementId}`}
          onClick={e => {
            e.preventDefault()
            const el = document.getElementById(entry.elementId)
            if (!el) return
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('case-card--highlighted')
            setTimeout(() => el.classList.remove('case-card--highlighted'), 2000)
          }}
          style={{ color: BLUE, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
        >
          {entry.alias ?? ref}
        </a>
      )
    } else {
      parts.push(ref)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length === 0 ? text : <>{parts}</>
}

interface ExpandableSectionProps {
  label: string
  content: string
  defaultLines?: number
  caseMap?: CaseMap
}

export function ExpandableSection({ label, content, defaultLines = 4, caseMap }: ExpandableSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length >= CHAR_THRESHOLD

  const rendered = caseMap ? linkifyCaseRefs(content, caseMap) : content

  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.8, color: BLUE, marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={!expanded && isLong ? {
        display: '-webkit-box',
        WebkitLineClamp: defaultLines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        fontSize: 11,
        color: TEXT,
        lineHeight: 1.5,
      } : {
        fontSize: 11,
        color: TEXT,
        lineHeight: 1.5,
      }}>
        {rendered}
      </div>
      {isLong ? (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 5,
            background: 'none',
            border: 'none',
            padding: 0,
            color: BLUE,
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: 0.2,
          }}
        >
          {expanded ? 'Read less ↑' : 'Read more ↓'}
        </button>
      ) : (
        <div style={{ height: 19 }} aria-hidden />
      )}
      {!isLong && content.length === 0 && (
        <span style={{ fontSize: 10, color: MUTED, fontStyle: 'italic' }}>No data</span>
      )}
    </div>
  )
}
