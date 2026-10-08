// PATCH /api/strike/objectives/[id]: edit a Strike objective's title, trip dates and note.
// Only those four fields are read; species, hunt type, state and hunt number are not editable here.
import { NextResponse } from 'next/server'
import { authorizeStrikeOwner, managementErrorResponse } from '@/lib/strike/ownerGuard'
import { updateObjective, validateObjectivePatch } from '@/lib/strike/objectiveManagement'
import { readJson } from '@/lib/spots/access'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const owner = await authorizeStrikeOwner(params.id)
  if (owner instanceof NextResponse) return owner

  const body = await readJson(request)
  if (body instanceof NextResponse) return body

  const checked = validateObjectivePatch(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

  try {
    const result = await updateObjective(owner.db, owner.profile, checked.value)
    return NextResponse.json(result)
  } catch (err) {
    return managementErrorResponse(err)
  }
}
