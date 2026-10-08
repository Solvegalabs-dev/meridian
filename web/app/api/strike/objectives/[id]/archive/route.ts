// POST /api/strike/objectives/[id]/archive: remove a Strike objective from the owner's lists (soft archive).
// Not the Arc abandon flow: no outcome, episode, prediction or abandonment record is written, and nothing is deleted.
import { NextResponse } from 'next/server'
import { authorizeStrikeOwner, managementErrorResponse } from '@/lib/strike/ownerGuard'
import { archiveObjective } from '@/lib/strike/objectiveManagement'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const owner = await authorizeStrikeOwner(params.id)
  if (owner instanceof NextResponse) return owner
  try {
    const result = await archiveObjective(owner.db, owner.profile)
    return NextResponse.json(result)
  } catch (err) {
    return managementErrorResponse(err)
  }
}
