// One verdict palette for every Strike surface (Strike tab, Strike card in Mission Control).
// Backgrounds are opaque hex, not rgba, so a pill reads the same on any page background.
// Each pair is checked for WCAG AA (4.5:1) in briefUi.test.ts.
import { goNoGoKind } from '@/lib/strikeBrief/goNoGo'

export type VerdictStyle = { label: string; bg: string; color: string }

const STYLES: Record<string, VerdictStyle> = {
  go:          { label: 'GO',          bg: '#14532d', color: '#4ade80' },
  no_go:       { label: 'NO GO',       bg: '#7f1d1d', color: '#fca5a5' },
  conditional: { label: 'CONDITIONAL', bg: '#78350f', color: '#fde68a' },
  monitor:     { label: 'MONITOR',     bg: '#1e3a8a', color: '#93c5fd' },
  // FF-089 P0: hunt is over. Neutral, no verdict colour.
  closed:      { label: 'CLOSED',      bg: '#334155', color: '#cbd5e1' },
}

// Null for a missing or unrecognised value. Unknown never renders as a verdict.
export function verdictStyle(goNoGo: string | null | undefined): VerdictStyle | null {
  const kind = goNoGoKind(goNoGo)
  return kind === 'unknown' ? null : STYLES[kind]
}

// Confidence tier chip: opaque background, white text (passes AA on every tier).
export const TIER_CHIP: Record<string, { bg: string; color: string }> = {
  T1: { bg: '#166534', color: '#ffffff' },
  T2: { bg: '#1e40af', color: '#ffffff' },
  T3: { bg: '#92400e', color: '#ffffff' },
  T4: { bg: '#334155', color: '#ffffff' },
}
