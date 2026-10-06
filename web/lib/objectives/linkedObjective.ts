// Creates an objectives row and its objective_profiles row, linked by objective_id (FF-092 Part 1).
// The sweep, strike_briefs and the crons read objectives. A profile without an objectives row
// (objective_id NULL) was invisible to all of them. Both rows are created here, or neither is.
import type { createServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createServiceClient>

export class LinkedObjectiveError extends Error {
  constructor(message: string, readonly cause_message?: string) {
    super(message)
    this.name = 'LinkedObjectiveError'
  }
}

export type LinkedObjectiveInput = {
  ownerUserId: string
  taxonomyKey: string
  huntCode: string | null
  timing: Record<string, unknown>
  // objective_profiles columns. user_id and objective_id are set here, not by the caller.
  profile: Record<string, unknown>
}

export type LinkedObjective = { objectiveId: string; profileId: string; objId: string }

// "elk.bull.archery" -> "elk · bull · archery", with the hunt number appended when there is one.
export function objectiveTitle(taxonomyKey: string, huntCode: string | null): string {
  const base = (taxonomyKey || 'Objective').replace(/\./g, ' · ')
  return huntCode ? `${base} · ${huntCode}` : base
}

// timing.trip_end, when it is a plain YYYY-MM-DD date. Otherwise null.
export function objectiveTargetDate(timing: Record<string, unknown>): string | null {
  const end = timing?.trip_end
  return typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null
}

// Next OBJ-NN after the highest existing number. Gaps from deleted rows are not reused.
export function nextObjNumber(existingObjIds: Array<string | null | undefined>): string {
  const max = existingObjIds.reduce((m, id) => {
    const match = (id ?? '').match(/^OBJ-(\d+)$/)
    return match ? Math.max(m, parseInt(match[1], 10)) : m
  }, 0)
  return `OBJ-${String(max + 1).padStart(2, '0')}`
}

export async function createLinkedObjective(db: Db, input: LinkedObjectiveInput): Promise<LinkedObjective> {
  const { data: existing, error: listError } = await db
    .from('objectives')
    .select('obj_id')
    .eq('user_id', input.ownerUserId)
  if (listError) throw new LinkedObjectiveError('Could not read existing objectives', listError.message)

  const objId = nextObjNumber((existing ?? []).map(o => o.obj_id as string | null))
  const title = objectiveTitle(input.taxonomyKey, input.huntCode)

  const { data: objective, error: objectiveError } = await db
    .from('objectives')
    .insert({
      user_id: input.ownerUserId,
      obj_id: objId,
      title,
      category: 'personal',
      outcome: `Complete the ${title} objective`,
      target_date: objectiveTargetDate(input.timing),
      status: 'active',
      objective_type: input.taxonomyKey,
      deadline_type: 'hard',
      confidence: 50,
      sort_order: (existing ?? []).length + 1,
    })
    .select('id')
    .single()
  if (objectiveError || !objective) {
    throw new LinkedObjectiveError('Could not create the objective', objectiveError?.message)
  }

  const objectiveId = objective.id as string
  const { data: profile, error: profileError } = await db
    .from('objective_profiles')
    .insert({ ...input.profile, user_id: input.ownerUserId, objective_id: objectiveId })
    .select('id')
    .single()

  if (profileError || !profile) {
    // Roll back the objectives row so no half-created record is left behind.
    const { error: rollbackError } = await db.from('objectives').delete().eq('id', objectiveId)
    if (rollbackError) {
      console.error('[linkedObjective] rollback failed for objectives row', objectiveId, rollbackError.message)
    }
    throw new LinkedObjectiveError('Could not create the objective profile', profileError?.message)
  }

  return { objectiveId, profileId: profile.id as string, objId }
}
