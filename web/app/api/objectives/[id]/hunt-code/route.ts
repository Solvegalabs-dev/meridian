// GET   /api/objectives/[id]/hunt-code — the saved hunt number and what is known about it
// PATCH /api/objectives/[id]/hunt-code {code | null} — save the hunt number (owner only)
// Saving keeps the number even when the lookup fails. The lookup only decides the state
// (UT, when empty) and the display text. Then every spot's boundary flag is recomputed.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireObjectiveOwner, readJson, spotErrorResponse } from '@/lib/spots/access'
import { normalizeHuntCode } from '@/lib/hunts/huntCode'
import { lookupHuntNumberCached, readCache } from '@/lib/hunts/udwrCache'
import { recomputeSpotBoundaryFlags } from '@/lib/hunts/boundary'
import { seasonOnFile } from '@/lib/hunts/seasonOnFile'

export const dynamic = 'force-dynamic'

const PROFILE_SELECT = 'state, taxonomy_key, hunt_unit_id, hunt_code, lat, lon'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  try {
    const service = createServiceClient()
    const { data: profile } = await service
      .from('objective_profiles')
      .select(PROFILE_SELECT)
      .eq('objective_id', owner.objectiveId)
      .maybeSingle()
    if (!profile) return NextResponse.json({ error: 'No objective profile found for this objective' }, { status: 404 })

    const code = (profile.hunt_code as string | null) ?? null
    const cached = code ? await readCache(service, code) : null
    return NextResponse.json({
      hunt_code: code,
      state: profile.state ?? null,
      season_text: cached?.season_text ?? null,
      boundary_found: cached?.boundary_geojson != null,
      season_on_file: code ? await seasonOnFile(service, profile as Parameters<typeof seasonOnFile>[1]) : false,
      source: 'Utah DWR',
    })
  } catch (err) {
    return spotErrorResponse(err)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  const body = await readJson(request)
  if (body instanceof NextResponse) return body

  let code: string | null = null
  if (body.code !== null) {
    code = normalizeHuntCode(body.code)
    if (!code) return NextResponse.json({ error: 'Hunt numbers look like EA2004: two letters and four digits.' }, { status: 400 })
  }

  try {
    const service = createServiceClient()
    const { data: profile } = await service
      .from('objective_profiles')
      .select(PROFILE_SELECT)
      .eq('objective_id', owner.objectiveId)
      .maybeSingle()
    if (!profile) return NextResponse.json({ error: 'No objective profile found for this objective' }, { status: 404 })

    let status: string | null = null
    let seasonText: string | null = null
    let boundaryFound = false
    const updates: Record<string, unknown> = { hunt_code: code }

    if (code) {
      const result = await lookupHuntNumberCached(service, code)
      status = result.status
      if (result.status === 'found') {
        seasonText = result.record.season_text
        boundaryFound = result.record.boundary_geojson != null
        if (!profile.state) updates.state = 'UT'
      }
    }

    const { error } = await service.from('objective_profiles').update(updates).eq('objective_id', owner.objectiveId)
    if (error) throw new Error(error.message)

    await recomputeSpotBoundaryFlags(service, owner.objectiveId)

    const saved = { ...profile, ...updates }
    return NextResponse.json({
      hunt_code: code,
      status,
      state: saved.state ?? null,
      season_text: seasonText,
      boundary_found: boundaryFound,
      season_on_file: code ? await seasonOnFile(service, saved as Parameters<typeof seasonOnFile>[1]) : false,
      source: 'Utah DWR',
    })
  } catch (err) {
    return spotErrorResponse(err)
  }
}
