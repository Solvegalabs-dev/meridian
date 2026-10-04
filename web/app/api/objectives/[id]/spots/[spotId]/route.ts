// PATCH  /api/objectives/[id]/spots/[spotId]  — {name?, lat?, lon?}
// DELETE /api/objectives/[id]/spots/[spotId]  — the active spot can go only when it is the last one
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireObjectiveOwner, readJson, spotErrorResponse } from '@/lib/spots/access'
import { deleteSpot, updateSpot } from '@/lib/spots/spotService'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: { id: string; spotId: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  const body = await readJson(request)
  if (body instanceof NextResponse) return body
  try {
    const { location } = await updateSpot(createServiceClient(), owner.objectiveId, params.spotId, {
      name: body.name,
      lat: body.lat,
      lon: body.lon,
    })
    return NextResponse.json({ ok: true, location })
  } catch (err) {
    return spotErrorResponse(err)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string; spotId: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  try {
    await deleteSpot(createServiceClient(), owner.objectiveId, params.spotId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return spotErrorResponse(err)
  }
}
