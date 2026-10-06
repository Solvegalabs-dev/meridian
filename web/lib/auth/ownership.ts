// Ownership gates for objective ids (FF-092 Part 2). An id may be an objective_profiles PK or an
// objectives id (objective_profiles.objective_id). Both forms resolve here, PK first.
// Every miss is a 404: no row, or a row that belongs to someone else. A 403 would tell a caller
// that the id exists, so ids cannot be probed.
import type { createServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createServiceClient>

export class ObjectiveAccessError extends Error {
  readonly status = 404

  constructor() {
    super('Not found')
    this.name = 'ObjectiveAccessError'
  }
}

// Always selected, so the checks below can run. Callers add the columns they need.
const CHECK_COLUMNS = ['id', 'objective_id', 'user_id', 'partner_id']

export type ObjectiveProfileRow = {
  id: string
  objective_id: string | null
  user_id: string | null
  partner_id: string | null
  [column: string]: unknown
}

// Returns the profile row for a PK or an arc objective_id, or null when neither matches.
export async function findObjectiveProfile(
  db: Db,
  id: string,
  extraColumns: string[] = [],
): Promise<ObjectiveProfileRow | null> {
  const columns = Array.from(new Set([...CHECK_COLUMNS, ...extraColumns])).join(', ')

  const { data: byPk } = await db
    .from('objective_profiles')
    .select(columns)
    .eq('id', id)
    .maybeSingle()
  if (byPk) return byPk as unknown as ObjectiveProfileRow

  const { data: byArcId } = await db
    .from('objective_profiles')
    .select(columns)
    .eq('objective_id', id)
    .maybeSingle()
  return (byArcId as unknown as ObjectiveProfileRow | null) ?? null
}

// Session path: the signed-in user must own the profile (objective_profiles.user_id).
export async function requireObjectiveAccess(
  db: Db,
  userId: string,
  id: string,
  extraColumns: string[] = [],
): Promise<ObjectiveProfileRow> {
  const row = await findObjectiveProfile(db, id, extraColumns)
  if (!row || !userId || row.user_id !== userId) throw new ObjectiveAccessError()
  return row
}

// Partner path: the profile must belong to this partner (objective_profiles.partner_id).
export async function requirePartnerObjective(
  db: Db,
  partnerId: string,
  id: string,
  extraColumns: string[] = [],
): Promise<ObjectiveProfileRow> {
  const row = await findObjectiveProfile(db, id, extraColumns)
  if (!row || !partnerId || row.partner_id !== partnerId) throw new ObjectiveAccessError()
  return row
}
