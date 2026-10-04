// History box on an ended hunt: the newest real verdict, never the deterministic CLOSED row.
import { isClosedBrief } from '@/lib/strikeBrief/goNoGo'
import { formatBriefDate } from '@/lib/strikeBrief/closedBrief'
import { verdictStyle } from './verdictStyles'

export type LastHuntRow = {
  brief_date?: string | null
  go_no_go?: string | null
  synthesis?: string | null
}

// Rows are newest first. CLOSED rows are end-of-hunt markers, so they are skipped even when they are the latest.
export function selectLastHuntBrief<T extends LastHuntRow>(rows: T[]): T | null {
  return rows.find(r => Boolean(r.go_no_go) && !isClosedBrief(r)) ?? null
}

// "Last hunt brief, Oct 1, 2026 · NO GO"
export function lastHuntHeading(row: LastHuntRow): string {
  const date = row.brief_date ? `, ${formatBriefDate(row.brief_date)}` : ''
  const verdict = verdictStyle(row.go_no_go)?.label ?? row.go_no_go ?? ''
  return `Last hunt brief${date} · ${verdict}`
}

// Strips the "(T2: ...)" tier annotations the model adds, same as the live brief.
export function cleanSynthesis(raw: string | null | undefined): string | null {
  const text = raw ?? ''
  const stripped = text.replace(/ \(T[1-4]: [^)]+\)/g, '').trim()
  return stripped || text.trim() || null
}
