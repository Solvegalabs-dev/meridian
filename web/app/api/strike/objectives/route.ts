// GET /api/strike/objectives: the signed-in user's other non-removed Strike objectives, for the
// objective-page switcher (FF-106 Stage 2 Part C). Same session + invite gate as the other Strike
// routes. Read-only, and intentionally small: it reuses buildOtherObjectives (which itself reuses
// resolveObjectiveTitle, windowStatusChip and focusState) rather than re-deriving title/chip/group logic.
import { NextResponse } from 'next/server'
import { requireInvitedUser } from '@/lib/strike/ownerGuard'
import { evaluateProfilesWindow, PROFILE_WINDOW_COLUMNS, type ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'
import { buildOtherObjectives, evaluationKey, type OtherProfileRow } from '@/lib/strike/otherObjectives'

export const dynamic = 'force-dynamic'

export async function GET() {
  const invited = await requireInvitedUser()
  if (invited instanceof NextResponse) return invited
  const { userId, db } = invited

  // Campaign units included: unlike the home page's "standalone" list, the switcher lists every
  // Strike objective the user owns, so a campaign unit's objective still appears to switch to.
  const { data, error } = await db
    .from('objective_profiles')
    .select(`${PROFILE_WINDOW_COLUMNS}, geo, created_at`)
    .eq('user_id', userId)
    .eq('org_source', 'strike')
    .in('status', ['active', 'completed'])
  if (error) {
    console.error('[strike/objectives] profile read failed:', error.message)
    return NextResponse.json({ error: 'Could not load objectives. Try again.' }, { status: 500 })
  }

  const profiles = (data ?? []) as unknown as OtherProfileRow[]
  const keyed: ObjectiveWindowProfile[] = profiles.map(p => ({ ...p, objective_id: evaluationKey(p) }))
  const evaluations = await evaluateProfilesWindow(db, keyed)

  const objectiveIds = profiles.map(p => p.objective_id).filter((id): id is string => !!id)
  const { data: titleRows } = objectiveIds.length > 0
    ? await db.from('objectives').select('id, title').eq('user_id', userId).in('id', objectiveIds)
    : { data: [] as Array<{ id: string; title: string | null }> }
  const storedTitles = new Map<string, string | null>(
    ((titleRows ?? []) as Array<{ id: string; title: string | null }>).map(o => [o.id, o.title])
  )

  const items = buildOtherObjectives({ profiles, evaluations, briefs: new Map(), storedTitles })

  return NextResponse.json({
    objectives: items.map(o => ({ id: o.id, title: o.title, chip: o.chip, group: o.group, tripStart: o.tripStart })),
  })
}
