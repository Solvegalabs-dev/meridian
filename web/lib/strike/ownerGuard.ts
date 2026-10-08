// Shared gate for the Strike objective management routes (FF-096): session, invite list, then ownership.
// 401 with no session, 403 for a user who is not invited, 404 for any id that is not the caller's own
// Strike objective (a 403 there would confirm that an id exists).
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isUserInvited, INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'
import { requireObjectiveAccess, ObjectiveAccessError } from '@/lib/auth/ownership'
import { MANAGEMENT_COLUMNS, ManagementError, type ManagedProfile } from '@/lib/strike/objectiveManagement'

export type StrikeOwner = { userId: string; db: SupabaseClient; profile: ManagedProfile }

// Session and invite list only (no objective yet). 401 with no session, 403 when the user is not invited.
export async function requireInvitedUser(): Promise<{ userId: string; db: SupabaseClient } | NextResponse> {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient() as unknown as SupabaseClient
  if (!(await isUserInvited(db as unknown as Parameters<typeof isUserInvited>[0], user))) {
    return NextResponse.json({ error: INVITE_ONLY_MESSAGE }, { status: 403 })
  }
  return { userId: user.id, db }
}

export async function authorizeStrikeOwner(id: string): Promise<StrikeOwner | NextResponse> {
  const invited = await requireInvitedUser()
  if (invited instanceof NextResponse) return invited
  const { userId, db } = invited

  try {
    const profile = await requireObjectiveAccess(db as unknown as Parameters<typeof requireObjectiveAccess>[0], userId, id, MANAGEMENT_COLUMNS)
    // Arc and partner objectives have their own flows. Strike manages Strike objectives only.
    if (profile.org_source !== 'strike') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return { userId, db, profile: profile as unknown as ManagedProfile }
  } catch (err) {
    if (err instanceof ObjectiveAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw err
  }
}

// Maps a management error to a response. Messages are written for the user and carry no coordinates.
export function managementErrorResponse(err: unknown): NextResponse {
  if (err instanceof ManagementError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  console.error('[strike/objectives] unexpected error:', err instanceof Error ? err.message : 'unknown')
  return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
}
