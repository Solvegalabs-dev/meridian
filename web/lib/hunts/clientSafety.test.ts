import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// huntCode.ts is imported by client components (HuntNumberCard, /strike/new). Neither it nor the
// point-in-polygon module it uses may pull in server code, or the Vercel build fails with
// "You're importing a component that needs next/headers".
const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function importSpecs(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  return Array.from(noComments.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g))
    .map(m => m[1] ?? m[2])
}

describe('client-safe hunt modules', () => {
  it('huntCode.ts does not import the server Supabase client or the unit resolver', () => {
    const specs = importSpecs(read('lib/hunts/huntCode.ts'))
    expect(specs).not.toContain('@/lib/supabase/server')
    expect(specs.some(s => s.includes('lib/supabase/server'))).toBe(false)
    expect(specs.some(s => s.includes('unitResolver'))).toBe(false)
  })

  it('pointInPolygon.ts has no imports at all', () => {
    expect(importSpecs(read('lib/geo/pointInPolygon.ts'))).toEqual([])
  })

  it('huntCode.ts reaches point-in-polygon through the pure module', () => {
    expect(importSpecs(read('lib/hunts/huntCode.ts'))).toContain('@/lib/geo/pointInPolygon')
  })

  it('unitResolver.ts still re-exports inGeometry for existing callers', () => {
    expect(read('lib/geo/unitResolver.ts')).toMatch(/export \{ inGeometry \} from '@\/lib\/geo\/pointInPolygon'/)
  })
})
