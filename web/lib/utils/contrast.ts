// WCAG 2.x contrast ratio for opaque 6-digit hex colours. Used by tests that pin
// text/background pairs to 4.5:1 (AA normal text).
function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

// Accepts "#rrggbb" or "rrggbb".
export function relativeLuminance(hex: string): number {
  const h = hex.replace(/^#/, '')
  const [r, g, b] = [0, 2, 4].map(i => channel(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
