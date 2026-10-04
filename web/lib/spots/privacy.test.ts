import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pendingBriefPayload } from '@/lib/mip/briefPayload'

// FF-075 privacy: spot and objective coordinates never reach a MIP partner payload or a log line.
const ROOT = join(__dirname, '..', '..')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
}

describe('MIP payload privacy', () => {
  it('the pending payload carries no coordinates or spot fields', () => {
    const payload = pendingBriefPayload('obj-1') as unknown as Record<string, unknown>
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(['lat', 'lon', 'spot_id', 'spots', 'active_spot_id']))
  })

  it('the MIP route and payload code never reference spot tables or snapshots', () => {
    const files = [
      ...filesUnder(join(ROOT, 'app', 'api', 'mip')),
      join(ROOT, 'lib', 'mip', 'briefPayload.ts'),
    ]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/objective_spots|spot_id|geo_snapshot|activeSpot/)
    }
  })
})

describe('no coordinates in logs or errors from the spot and hunt code', () => {
  it('new spot and hunt modules do not log latitude or longitude', () => {
    const files = [
      ...filesUnder(join(ROOT, 'lib', 'spots')),
      ...filesUnder(join(ROOT, 'lib', 'hunts')),
      join(ROOT, 'app', 'api', 'hunts', 'lookup', 'route.ts'),
      join(ROOT, 'app', 'api', 'objectives', '[id]', 'hunt-code', 'route.ts'),
    ].filter(f => !f.endsWith('.test.ts') && !f.endsWith('testDb.ts'))
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const logLines = src.split('\n').filter(l => /console\.(log|error|warn)/.test(l))
      for (const line of logLines) {
        expect(line, f).not.toMatch(/\blat\b|\blon\b/)
      }
    }
  })
})
