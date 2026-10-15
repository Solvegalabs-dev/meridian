// Collection cadence by focus (FF-106 Stage 2 Part A): how often the agent swarm cron collects
// for a Strike objective, based on where it sits on the calendar (lib/strike/focusState.ts).
// Pure: no DB, no network. `now` is the cron's invocation time (UTC).
import type { FocusState } from './focusState'

// The cron runs every 6 hours at these UTC hours (vercel.json: '0 */6 * * *').
export const RADAR_CYCLE_HOUR = 6
export const NEXT_YEAR_CYCLE_HOUR = 6
// Date#getUTCDay(): 0 = Sunday, 1 = Monday.
export const NEXT_YEAR_WEEKDAY = 1

export function shouldCollectThisCycle(focus: FocusState, now: Date): boolean {
  switch (focus) {
    case 'now':
    case 'prep':
      return true
    case 'radar':
      return now.getUTCHours() === RADAR_CYCLE_HOUR
    case 'next_year':
      return now.getUTCHours() === NEXT_YEAR_CYCLE_HOUR && now.getUTCDay() === NEXT_YEAR_WEEKDAY
    case 'ended':
      return false
  }
}
