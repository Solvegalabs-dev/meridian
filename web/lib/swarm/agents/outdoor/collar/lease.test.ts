import { describe, it, expect, vi, beforeEach } from 'vitest'

type LeaseRow = { id: number; locked_until: string | null; holder: string | null; cooldown_until: string | null }

let leaseRow: LeaseRow

function resetLeaseRow() {
  leaseRow = { id: 1, locked_until: null, holder: null, cooldown_until: null }
}

// Evaluates a PostgREST-style "col.op.value,col.op.value" OR clause against
// the in-memory row — just enough of the real semantics (is.null / lt) to
// exercise acquireLease's actual WHERE logic rather than a canned mock.
function evalOrClause(clause: string, row: LeaseRow): boolean {
  return clause.split(',').some(cond => {
    const [col, op, ...rest] = cond.split('.')
    const value = rest.join('.')
    const rowVal = (row as unknown as Record<string, string | null>)[col]
    if (op === 'is' && value === 'null') return rowVal === null
    if (op === 'lt') return rowVal !== null && rowVal < value
    return false
  })
}

type Result = { data: LeaseRow | null }
type Builder = PromiseLike<Result> & {
  update: (patch: Partial<LeaseRow>) => Builder
  select: () => Builder
  eq: (col: string, val: unknown) => Builder
  maybeSingle: () => Promise<Result>
  or: (clause: string) => Builder
}

function makeLeaseClient() {
  const fromSpy = vi.fn((table: string) => {
    if (table !== 'movebank_lease') throw new Error(`unexpected table ${table}`)
    const eqFilters: Record<string, unknown> = {}
    const orClauses: string[] = []
    let updatePatch: Partial<LeaseRow> | undefined

    // Supabase-js query builders are thenable — `await supabase.from(...).update(...).eq(...)`
    // with no explicit `.maybeSingle()`/`.select()` terminal (as setCooldown's
    // update does) still executes. A plain object isn't awaitable that way,
    // so `.then()` has to do the same resolution `.maybeSingle()` does.
    const resolve = async (): Promise<Result> => {
      const eqMatch = Object.entries(eqFilters).every(([col, val]) => (leaseRow as unknown as Record<string, unknown>)[col] === val)
      const orMatch = orClauses.every(clause => evalOrClause(clause, leaseRow))

      if (!updatePatch) {
        // Plain select (e.g. setCooldown's current-value read) — id filter
        // always matches the single row in these tests.
        return { data: eqMatch ? { ...leaseRow } : null }
      }
      if (!eqMatch || !orMatch) return { data: null }
      Object.assign(leaseRow, updatePatch)
      return { data: { ...leaseRow } }
    }

    const builder: Builder = {
      update: (patch) => { updatePatch = patch; return builder },
      select: () => builder,
      eq: (col, val) => { eqFilters[col] = val; return builder },
      or: (clause) => { orClauses.push(clause); return builder },
      maybeSingle: resolve,
      then: (onFulfilled, onRejected) => resolve().then(onFulfilled, onRejected),
    }
    return builder
  })

  return { from: fromSpy }
}

const { leaseClient } = vi.hoisted(() => ({ leaseClient: { current: null as unknown } }))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => leaseClient.current,
}))

beforeEach(() => {
  resetLeaseRow()
  leaseClient.current = makeLeaseClient()
  vi.resetModules()
})

describe('acquireLease', () => {
  it('succeeds when the lease is free, and a second acquire fails while held', async () => {
    const { acquireLease } = await import('./lease')

    expect(await acquireLease('worker-1', 280)).toBe(true)
    expect(leaseRow.holder).toBe('worker-1')

    expect(await acquireLease('worker-2', 280)).toBe(false)
    expect(leaseRow.holder).toBe('worker-1') // unchanged
  })

  it('allows acquiring an expired lease', async () => {
    leaseRow.locked_until = new Date(Date.now() - 60000).toISOString() // expired 1 min ago
    leaseRow.holder = 'worker-1'

    const { acquireLease } = await import('./lease')
    expect(await acquireLease('worker-2', 280)).toBe(true)
    expect(leaseRow.holder).toBe('worker-2')
  })

  it('refuses to acquire during an active cooldown, even with the lease free', async () => {
    leaseRow.cooldown_until = new Date(Date.now() + 60000).toISOString() // active for another minute

    const { acquireLease } = await import('./lease')
    expect(await acquireLease('worker-1', 280)).toBe(false)
  })

  it('allows acquiring once the cooldown has expired', async () => {
    leaseRow.cooldown_until = new Date(Date.now() - 1000).toISOString()

    const { acquireLease } = await import('./lease')
    expect(await acquireLease('worker-1', 280)).toBe(true)
  })
})

describe('releaseLease', () => {
  it('only releases a lease the given holder actually owns', async () => {
    const { acquireLease, releaseLease } = await import('./lease')
    await acquireLease('worker-1', 280)

    await releaseLease('worker-2') // not the holder — must not release worker-1's lease
    expect(leaseRow.holder).toBe('worker-1')

    await releaseLease('worker-1')
    expect(leaseRow.holder).toBeNull()
    expect(leaseRow.locked_until).toBeNull()
  })
})

describe('setCooldown', () => {
  it('never shortens an existing, later cooldown', async () => {
    const { setCooldown } = await import('./lease')

    await setCooldown(260)
    const longCooldown = leaseRow.cooldown_until

    await setCooldown(65) // shorter — must not overwrite the 260s cooldown
    expect(leaseRow.cooldown_until).toBe(longCooldown)
  })

  it('extends the cooldown when the new value is later', async () => {
    const { setCooldown } = await import('./lease')

    await setCooldown(65)
    const shortCooldown = leaseRow.cooldown_until

    await setCooldown(260)
    expect(leaseRow.cooldown_until).not.toBe(shortCooldown)
    expect(new Date(leaseRow.cooldown_until!).getTime()).toBeGreaterThan(new Date(shortCooldown!).getTime())
  })
})

describe('registerMovebankFailure (A4 — backoff schedule)', () => {
  it.each([
    [0, 65, false],
    [1, 130, false],
    [2, 260, false],
    [3, 260, true],
  ])('consecutive429s=%i -> cooldown %is, requeue=%s', async (consecutive429s, expectedSeconds, expectedRequeue) => {
    const { registerMovebankFailure } = await import('./lease')
    const result = await registerMovebankFailure('429', consecutive429s)
    expect(result.cooldownSeconds).toBe(expectedSeconds)
    expect(result.requeue).toBe(expectedRequeue)
  })

  it.each(['abort', 'timeout', '5xx'] as const)('applies a flat 65s cooldown for %s, never requeues', async (kind) => {
    const { registerMovebankFailure } = await import('./lease')
    const result = await registerMovebankFailure(kind)
    expect(result.cooldownSeconds).toBe(65)
    expect(result.requeue).toBe(false)
  })
})
