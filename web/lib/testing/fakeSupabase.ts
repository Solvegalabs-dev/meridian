// Minimal chainable stand-in for the supabase-js query builder, for unit tests.
// Records every query (table, op, payload, filters) so tests can assert on writes.
// Each test supplies a responder that returns the rows/error for a given query.

export type FakeCall = {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  payload?: unknown
  onConflict?: string
  filters: Array<[string, string, unknown]>
  head?: boolean
  single?: 'maybe' | 'single'
}

export type FakeResult = {
  data?: unknown
  error?: { message: string; code?: string } | null
  count?: number | null
}

export type FakeResponder = (call: FakeCall) => FakeResult

export function fakeSupabase(respond: FakeResponder) {
  const calls: FakeCall[] = []

  function builder(table: string) {
    const call: FakeCall = { table, op: 'select', filters: [] }

    const run = () => {
      calls.push(call)
      const r = respond(call)
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }
    }

    const b = {
      select(_cols?: string, opts?: { head?: boolean }) {
        call.head = opts?.head
        return b
      },
      insert(payload: unknown) {
        call.op = 'insert'
        call.payload = payload
        return b
      },
      update(payload: unknown) {
        call.op = 'update'
        call.payload = payload
        return b
      },
      upsert(payload: unknown, opts?: { onConflict?: string }) {
        call.op = 'upsert'
        call.payload = payload
        call.onConflict = opts?.onConflict
        return b
      },
      delete() {
        call.op = 'delete'
        return b
      },
      eq(col: string, val: unknown) {
        call.filters.push([col, 'eq', val])
        return b
      },
      neq(col: string, val: unknown) {
        call.filters.push([col, 'neq', val])
        return b
      },
      in(col: string, val: unknown) {
        call.filters.push([col, 'in', val])
        return b
      },
      or(expr: string) {
        call.filters.push(['or', 'or', expr])
        return b
      },
      not() { return b },
      is() { return b },
      gte() { return b },
      order() { return b },
      limit() { return b },
      maybeSingle() {
        call.single = 'maybe'
        return Promise.resolve(run())
      },
      single() {
        call.single = 'single'
        return Promise.resolve(run())
      },
      then<T1, T2>(resolve: (v: ReturnType<typeof run>) => T1, reject?: (e: unknown) => T2) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return b
  }

  return {
    from: (table: string) => builder(table),
    calls,
    writes: () => calls.filter(c => c.op !== 'select'),
  }
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>
