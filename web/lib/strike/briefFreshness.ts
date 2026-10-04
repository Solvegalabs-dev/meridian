// "Updated …" line and the stale-brief note. Shared by the Strike tab and the Mission Control card.
import { timeAgo } from '@/lib/utils/timeAgo'

export const STALE_BRIEF_HOURS = 36

export function briefAgeHours(generatedAt: string, now: Date): number {
  return (now.getTime() - new Date(generatedAt).getTime()) / (60 * 60 * 1000)
}

// Only an active hunt gets the stale note: a finished or not-yet-open hunt is not expected to refresh.
export function isStaleBrief(generatedAt: string, now: Date, huntActive: boolean): boolean {
  return huntActive && briefAgeHours(generatedAt, now) > STALE_BRIEF_HOURS
}

export function staleBriefNote(generatedAt: string, now: Date): string {
  return `This brief is ${Math.floor(briefAgeHours(generatedAt, now))} h old; the next sweep updates it.`
}

// "Updated 3h ago (Oct 3, 6:15 AM)": relative time, then the viewer's local date and time.
export function updatedLabel(generatedAt: string): string {
  const local = new Date(generatedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return `Updated ${timeAgo(generatedAt)} (${local})`
}

// The stored brief's time, so a refresh does not reset "Updated" to the request time.
// Falls back to now only when the row has no created_at (no brief row at all).
export function briefGeneratedAt(createdAt: string | null | undefined, now: Date = new Date()): string {
  return createdAt ?? now.toISOString()
}

// A strike partner payload with time_windows === null is the no-brief stub; any stored brief has an array.
export function hasStoredBrief(payload: { time_windows?: unknown[] | null } | null | undefined): boolean {
  return payload?.time_windows != null
}
