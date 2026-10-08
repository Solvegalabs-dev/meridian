// POST /api/strike/objectives/[id]/restore: bring a removed Strike objective back (owner only).
import { NextResponse } from 'next/server'
import { authorizeStrikeOwner, managementErrorResponse } from '@/lib/strike/ownerGuard'
import { restoreObjective } from '@/lib/strike/objectiveManagement'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const owner = await authorizeStrikeOwner(params.id)
  if (owner instanceof NextResponse) return owner
  try {
    const result = await restoreObjective(owner.db, owner.profile)
    return NextResponse.json(result)
  } catch (err) {
    return managementErrorResponse(err)
  }
}
