import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// Regression guard: Tailwind only generates utilities for files its `content` globs match.
// lib/ holds class strings (lib/strike/noticeStyles.ts), so it must stay in the list.
const configSource = readFileSync(fileURLToPath(new URL('../tailwind.config.ts', import.meta.url)), 'utf8')

const contentBlock = configSource.match(/content:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
const contentGlobs = Array.from(contentBlock.matchAll(/"([^"]+)"/g), m => m[1])

describe('tailwind.config.ts content globs', () => {
  it('scans ./lib so utilities used only in lib are generated', () => {
    expect(contentGlobs.some(g => g.startsWith('./lib/') && g.includes('**'))).toBe(true)
  })

  it('still scans pages, components and app', () => {
    for (const dir of ['./pages/', './components/', './app/']) {
      expect(contentGlobs.some(g => g.startsWith(dir))).toBe(true)
    }
  })
})
