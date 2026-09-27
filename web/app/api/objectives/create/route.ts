// POST /api/objectives/create — MIP Objective Intake
// Core: intake contract is universal. org_source is the cohort partition key.
// Third-vertical test: BaseMaps, GoHunt, and FishBrain all POST to this same route — YES
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAgentBundle } from '@/lib/swarm/objectiveRouter'
import { resolveFullGeography } from '@/lib/geo/locationResolver'

export const dynamic = 'force-dynamic'

type CreateObjectiveBody = {
  domain: string
  taxonomy_key: string
  geo: { state?: string; unit?: string; lat?: number; lon?: number }
  priority_stack: unknown[]
  timing: Record<string, unknown>
  org_source?: string
  user_id?: string
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()

  let body: CreateObjectiveBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { domain, taxonomy_key, geo, priority_stack, timing } = body
  const org_source = body.org_source ?? 'arc'

  if (!domain || !taxonomy_key || !geo || !priority_stack || !timing) {
    return NextResponse.json(
      { error: 'Missing required fields: domain, taxonomy_key, geo, priority_stack, timing' },
      { status: 400 }
    )
  }

  // Resolve agent bundle from registry
  const { agents, buildStatus } = await resolveAgentBundle(taxonomy_key, geo)

  // Determine user from explicit user_id (authenticated intake) or org_source service account
  let profile: { id: string } | null = null
  if (body.user_id) {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', body.user_id)
      .maybeSingle()
    profile = data
  } else {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('org_source', org_source)
      .limit(1)
      .maybeSingle()
    profile = data
  }

  // If BaseMaps org_source → set account_type = enterprise on their profile
  if (org_source === 'basemaps' && profile) {
    await supabase
      .from('profiles')
      .update({ account_type: 'enterprise' })
      .eq('id', profile.id)
  }

  const { lat, lon } = geo

  // Insert objective_profiles row
  const { data: objProfile, error: insertError } = await supabase
    .from('objective_profiles')
    .insert({
      user_id: profile?.id ?? null,
      org_source,
      domain,
      taxonomy_key,
      geo,
      priority_stack,
      timing,
      assigned_agents: agents,
      agent_build_status: buildStatus === 'ready'
        ? 'ready'
        : buildStatus === 'partial'
          ? 'building'
          : 'queued',
      status: 'active',
      ...(lat != null ? { lat } : {}),
      ...(lon != null ? { lon } : {}),
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[objectives/create] insert failed', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Resolve full geography (FF-089) if lat/lon provided — non-blocking, best-effort.
  // waitUntil keeps the function alive after the response so the ~8s resolve completes.
  if (lat != null && lon != null && objProfile?.id) {
    waitUntil(resolveFullGeography(lat, lon).then(async (geo) => {
      if (!geo) return
      const { error } = await supabase
        .from('objective_profiles')
        .update(geo)
        .eq('id', objProfile.id)
      if (error) console.error('[objectives/create] geography update failed:', error.message)
    }).catch(e => console.error('[objectives/create] geography update failed:', e)))
  }

  return NextResponse.json(
    {
      objective_id: objProfile.id,
      assigned_agents: agents,
      agent_build_status: objProfile ? 'ready' : buildStatus,
    },
    { status: 201 }
  )
}
