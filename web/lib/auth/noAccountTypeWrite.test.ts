// FF-092: the partner path used to flip profiles.account_type to 'enterprise' based on a body field.
// This test fails if any source file writes that value again.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

const ROOTS = ['app', 'lib', 'components', 'middleware.ts']
const WRITE_PATTERN = /account_type['"]?\s*:\s*['"]enterprise['"]/

function sourceFiles(entry: string): string[] {
  const stat = statSync(entry)
  if (stat.isFile()) return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [entry] : []
  return readdirSync(entry).flatMap(name => sourceFiles(path.join(entry, name)))
}

describe('no account_type write from request data', () => {
  it('no source file sets account_type to enterprise', () => {
    const hits = ROOTS.flatMap(sourceFiles).filter(f => WRITE_PATTERN.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })

  it('the create route does not mention account_type at all', () => {
    const src = readFileSync(path.join('app', 'api', 'objectives', 'create', 'route.ts'), 'utf8')
    expect(src).not.toMatch(/account_type/)
  })
})
