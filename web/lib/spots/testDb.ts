// In-memory stand-in for the slice of the Supabase client the spot code uses. Test-only:
// nothing in the app imports it. Supports select/eq/in/order/insert/update/delete/single and rpc.
type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null }

class Query implements PromiseLike<Result> {
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private payload: Row = {}
  private sortCol: string | null = null

  constructor(private db: FakeDb, private table: string) {}

  select() { return this }
  eq(col: string, val: unknown) { this.filters.push(r => r[col] === val); return this }
  in(col: string, vals: unknown[]) { this.filters.push(r => vals.includes(r[col])); return this }
  // Supports the one form the app uses: not(col, 'is', null).
  not(col: string, op: string, val: unknown) {
    if (op === 'is' && val === null) this.filters.push(r => r[col] !== null && r[col] !== undefined)
    return this
  }
  order(col: string) { this.sortCol = col; return this }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this }
  upsert(row: Row) { this.op = 'upsert'; this.payload = row; return this }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }

  private run(): Result {
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = [])
    const matched = rows.filter(r => this.filters.every(f => f(r)))
    if (this.op === 'insert') {
      const row: Row = { id: `${this.table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...this.payload }
      rows.push(row)
      return { data: row, error: null }
    }
    if (this.op === 'upsert') {
      // Matches an existing row on hunt_code or id, as the tables used here are keyed.
      const key = 'hunt_code' in this.payload ? 'hunt_code' : 'id'
      const existing = rows.find(r => r[key] === this.payload[key])
      if (existing) Object.assign(existing, this.payload)
      else rows.push({ id: `${this.table}-${rows.length + 1}`, ...this.payload })
      return { data: this.payload, error: null }
    }
    if (this.op === 'update') {
      matched.forEach(r => Object.assign(r, this.payload))
      return { data: matched, error: null }
    }
    if (this.op === 'delete') {
      this.db.tables[this.table] = rows.filter(r => !matched.includes(r))
      return { data: null, error: null }
    }
    return { data: matched, error: null }
  }

  private sorted(data: unknown): unknown {
    if (!this.sortCol || !Array.isArray(data)) return data
    const col = this.sortCol
    return [...data].sort((a, b) => String((a as Row)[col] ?? '').localeCompare(String((b as Row)[col] ?? '')))
  }

  maybeSingle(): Promise<Result> {
    const r = this.run()
    const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : []
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  }

  single(): Promise<Result> {
    return Promise.resolve(this.run())
  }

  then<A, B>(onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const r = this.run()
    return Promise.resolve({ ...r, data: this.sorted(r.data) }).then(onfulfilled, onrejected)
  }
}

export class FakeDb {
  tables: Record<string, Row[]>
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables
  }

  from(table: string) {
    return new Query(this, table)
  }

  // Mirrors activate_objective_spot: clears the old active spot, sets the new one.
  rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
    this.rpcCalls.push({ fn, args })
    if (fn !== 'activate_objective_spot') return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } })
    const rows = this.tables.objective_spots ?? []
    rows.forEach(r => {
      if (r.objective_id === args.p_objective_id && r.is_active) r.is_active = false
    })
    const target = rows.find(r => r.id === args.p_spot_id && r.objective_id === args.p_objective_id)
    if (!target) return Promise.resolve({ data: null, error: { message: 'spot_not_found' } })
    target.is_active = true
    target.activated_at = target.activated_at ?? new Date().toISOString()
    return Promise.resolve({ data: target, error: null })
  }
}
