// Which tab a hunt opens on. Driven by the evaluated window state, never by parsing a date here.
import type { WindowState } from '@/lib/objectives/windowState'

export type StrikeTab = 'prep' | 'strike' | 'intel' | 'signals' | 'notes'

export function defaultStrikeTab(state: WindowState | null | undefined): StrikeTab {
  // Before the season or trip opens there is no brief to read yet: the prep is the useful screen.
  if (state === 'upcoming' || state === 'season_not_open') return 'prep'
  // Active, ended (the closed message shows on the Strike tab) and unknown all land on the brief.
  return 'strike'
}
