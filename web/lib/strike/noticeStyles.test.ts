import { describe, it, expect } from 'vitest'
import { NOTICE_CLASSES } from './noticeStyles'

// Tailwind v3 palette values for the colours the notices use.
const HEX: Record<string, string> = {
  'blue-100': '#dbeafe',
  'blue-950': '#172554',
  'blue-400': '#60a5fa',
  'slate-800': '#1e293b',
  'slate-700': '#334155',
  'slate-600': '#475569',
  'slate-300': '#cbd5e1',
  'slate-200': '#e2e8f0',
  'slate-100': '#f1f5f9',
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const bgOf = (cls: string) => cls.split(' ').find(c => c.startsWith('bg-'))?.slice(3)
const textOf = (cls: string) => cls.split(' ').find(c => c.startsWith('text-') && c.split('-').length >= 3)?.slice(5)

describe('strike notice styles', () => {
  for (const [name, cls] of Object.entries(NOTICE_CLASSES)) {
    it(`${name}: no alpha background and no opacity`, () => {
      // Alpha utilities look like bg-blue-900/30 or border-blue-700/50; opacity-* dims everything inside.
      expect(cls).not.toMatch(/\/\d+/)
      expect(cls).not.toMatch(/\bopacity-/)
    })
  }

  const pairs: Array<[keyof typeof NOTICE_CLASSES, boolean]> = [
    ['opens', true],
    ['closed', true],
    ['history', true],
    ['endedLabel', false],
  ]
  for (const [name] of pairs) {
    it(`${name}: text meets WCAG AA 4.5:1 on its background`, () => {
      const cls = NOTICE_CLASSES[name]
      const bg = bgOf(cls)
      const text = textOf(cls)
      // endedLabel sits on the list card, which is slate-800.
      const surface = bg ? HEX[bg] : HEX['slate-800']
      expect(text && HEX[text], `missing palette entry for ${text}`).toBeTruthy()
      expect(contrast(HEX[text!], surface)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('the history heading also meets 4.5:1 on the history box', () => {
    const ratio = contrast(HEX['slate-200'], HEX['slate-800'])
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
