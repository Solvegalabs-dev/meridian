// Readable text for the raw reason codes stored on campaign units (e.g. missed_reason).
const KNOWN_REASONS: Record<string, string> = {
  access_fell_through: 'Access fell through',
}

// Known codes get their mapped label. Any other snake_case code becomes sentence case with spaces.
export function formatReason(raw: string): string {
  const known = KNOWN_REASONS[raw]
  if (known) return known
  const words = raw.trim().replace(/_+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
