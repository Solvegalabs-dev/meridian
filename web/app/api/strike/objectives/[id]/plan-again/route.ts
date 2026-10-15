// POST /api/strike/objectives/[id]/plan-again: a finished Strike objective spawns a new one for
// next year (FF-106 Stage 2 Part B). Same session, invite and ownership guards as the other
// /api/strike/objectives/[id]/* routes.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeStrikeOwner, managementErrorResponse } from '@/lib/strike/ownerGuard'
import { planAgainForNextYear, LimitReachedError } from '@/lib/strike/planAgain'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const owner = await authorizeStrikeOwner(params.id)
  if (owner instanceof NextResponse) return owner

  // Strike-friend limits apply only to users who joined via /join, same check as the create
  // route and /api/strike/slots (app_metadata.signup_source === 'strike').
  const { data: { user } } = await createClient().auth.getUser()
  const isStrikeFriend = user?.app_metadata?.signup_source === 'strike'

  try {
    const result = await planAgainForNextYear(owner.db, owner.profile, isStrikeFriend)
    return NextResponse.json({ objective_id: result.profileId, arc_objective_id: result.objectiveId }, { status: 201 })
  } catch (err) {
    if (err instanceof LimitReachedError) {
      return NextResponse.json({ error: 'objective_limit_reached', category: err.category, max: err.max }, { status: 403 })
    }
    return managementErrorResponse(err)
  }
}
