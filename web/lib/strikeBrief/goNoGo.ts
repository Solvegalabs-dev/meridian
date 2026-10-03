// One place that classifies a strike_briefs.go_no_go value for display.
// Anything not recognised is 'unknown', and unknown never renders as GO.
export type GoNoGoKind = 'go' | 'conditional' | 'monitor' | 'no_go' | 'closed' | 'unknown'

export function goNoGoKind(value: string | null | undefined): GoNoGoKind {
  if (!value) return 'unknown'
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  switch (normalized) {
    case 'GO':          return 'go'
    case 'CONDITIONAL': return 'conditional'
    case 'MONITOR':     return 'monitor'
    case 'NO_GO':       return 'no_go'
    case 'CLOSED':      return 'closed'
    default:            return 'unknown'
  }
}

// Hunt is over: no GO/NO-GO verdict, no time window, no confidence tier.
export function isClosedBrief(brief: { go_no_go?: string | null } | null | undefined): boolean {
  return goNoGoKind(brief?.go_no_go) === 'closed'
}
