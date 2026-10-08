import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Client components import these modules (the intake form, the Objective details card, the Strike home).
// Anything they pull in, directly or through other modules, must be free of server-only code, or the Vercel
// build fails with "You're importing a component that needs next/headers".
const ROOT = join(__dirname, '..', '..')
const FORBIDDEN = ['@/lib/supabase/server', 'next/headers', 'server-only', 'node:fs', 'node:crypto']

function specs(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // `import type` is erased at build time, so it cannot pull server code in.
  return Array.from(noComments.matchAll(/(?:import|export)\s(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)).map(m => m[1] ?? m[2])
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? join(from, '..', spec) : null
  if (!base) return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate
  return null
}

function reachable(entry: string): { files: Set<string>; imports: Set<string> } {
  const files = new Set<string>()
  const imports = new Set<string>()
  const queue = [join(ROOT, entry)]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    for (const spec of specs(readFileSync(file, 'utf8'))) {
      imports.add(spec)
      const next = resolve(file, spec)
      if (next) queue.push(next)
    }
  }
  return { files, imports }
}

const CLIENT_ENTRIES = [
  'lib/strike/coverage.ts',
  'lib/strike/objectivePatch.ts',
  'lib/strike/otherObjectives.ts',
  'lib/objectives/objectiveTitle.ts',
  'components/strike/ObjectiveMenu.tsx',
  'components/strike/ObjectiveDetailsCard.tsx',
  'components/strike/RemovedObjectives.tsx',
  'components/strike/RemovedObjectiveNotice.tsx',
  'components/strike/CampaignView.tsx',
  'app/(strike)/strike/new/page.tsx',
  // FF-098
  'lib/strike/sweepStatus.ts',
  'lib/sweep/useRunSweep.ts',
  'lib/strikeBrief/evidence.ts',
  'components/strike/RunSweepButton.tsx',
  'components/strike/RunSweepPrompt.tsx',
  'components/strike/StrikeBriefPanel.tsx',
  'components/strike/StrikeBriefClient.tsx',
  // FF-099
  'lib/strike/signalFormat.ts',
  'lib/strike/signalCards.ts',
  'lib/strike/signalChips.ts',
  'components/strike/MoonIcon.tsx',
  'components/strike/SignalChipRow.tsx',
  'components/strike/StrikeSignalsPanel.tsx',
  'components/strike/StrikeIntelPanel.tsx',
]

describe('FF-096 client-safe modules', () => {
  for (const entry of CLIENT_ENTRIES) {
    it(`${entry} reaches no server-only code`, () => {
      const { imports } = reachable(entry)
      for (const bad of FORBIDDEN) expect(Array.from(imports), `${entry} imports ${bad}`).not.toContain(bad)
    })
  }

  it('the walker would catch a server import (self-check)', () => {
    const { imports } = reachable('lib/strike/ownerGuard.ts')
    expect(Array.from(imports)).toContain('@/lib/supabase/server')
  })
})
