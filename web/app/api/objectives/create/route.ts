// POST /api/objectives/create — MIP Objective Intake
// Core: intake contract is universal. Two doors, decided by the request (FF-092):
//   Session (Strike): the signed-in user owns the objective. org_source is 'strike'.
//     The body cannot name a user.
//   Partner (Authorization: Bearer <key>): the key decides the partner, its org_source, and its
//     service owner. org_source and user_id in the body are ignored. partner_user_ref is the partner's
//     opaque id for its customer.
// Every objective gets an objectives row linked to its objective_profiles row, so the sweep and crons see it.
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAgentBundle } from '@/lib/swarm/objectiveRouter'
import { resolveFullGeography } from '@/lib/geo/locationResolver'
import { normalizeHuntCode } from '@/lib/hunts/huntCode'
import { authenticatePartner, isPartnerRequest } from '@/lib/auth/partnerAuth'
import { partnerRateLimitResponse } from '@/lib/auth/rateLimit'
import { createLinkedObjective, LinkedObjectiveError } from '@/lib/objectives/linkedObjective'

export const dynamic = 'force-dynamic'

const MAX_PARTNER_REF = 128

type CreateObjectiveBody = {
  domain: string
  taxonomy_key: string
  geo: { state?: string; unit?: string; lat?: number; lon?: number }
  priority_stack: unknown[]
  timing: Record<string, unknown>
  partner_user_ref?: unknown
}

type Caller = {
  ownerUserId: string
  orgSource: string
  partnerId: string | null
  partnerRef: string | null
}

// Returns the caller, or the response to send (401, 429, 503 or 400).
async function resolveCaller(request: NextRequest, body: CreateObjectiveBody): Promise<Caller | NextResponse> {
  if (isPartnerRequest(request)) {
    const partner = await authenticatePartner(request)
    if (!partner) return NextResponse.json({ error: 'Invalid or revoked partner key' }, { status: 401 })

    const limited = partnerRateLimitResponse(partner)
    if (limited) return limited

    if (!partner.ownerUserId) {
      console.error('[objectives/create] partner has no service owner:', partner.slug)
      return NextResponse.json({ error: 'Partner is not set up yet. Contact Meridian.' }, { status: 503 })
    }

    const ref = body.partner_user_ref
    if (ref !== undefined && ref !== null) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.length > MAX_PARTNER_REF) {
        return NextResponse.json(
          { error: `partner_user_ref must be a non-empty string up to ${MAX_PARTNER_REF} characters` },
          { status: 400 },
        )
      }
    }

    return {
      ownerUserId: partner.ownerUserId,
      orgSource: partner.slug,
      partnerId: partner.partnerId,
      partnerRef: typeof ref === 'string' ? ref.trim() : null,
    }
  }

  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return { ownerUserId: user.id, orgSource: 'strike', partnerId: null, partnerRef: null }
}

export async function POST(request: NextRequest) {
  let body: CreateObjectiveBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { domain, taxonomy_key, geo, priority_stack, timing } = body

  if (!domain || !taxonomy_key || !geo || !priority_stack || !timing) {
    return NextResponse.json(
      { error: 'Missing required fields: domain, taxonomy_key, geo, priority_stack, timing' },
      { status: 400 }
    )
  }

  const caller = await resolveCaller(request, body)
  if (caller instanceof NextResponse) return caller

  const supabase = createServiceClient()

  // Resolve agent bundle from registry
  const { agents, buildStatus } = await resolveAgentBundle(taxonomy_key, geo)

  const { lat, lon } = geo

  // FF-091: the season matcher reads the state and hunt number columns, not the geo json.
  const huntCode = normalizeHuntCode(geo.unit)
  const stateColumn = typeof geo.state === 'string' && geo.state.trim() ? geo.state.trim().toUpperCase() : null

  let created
  try {
    created = await createLinkedObjective(supabase, {
      ownerUserId: caller.ownerUserId,
      taxonomyKey: taxonomy_key,
      huntCode,
      timing,
      profile: {
        org_source: caller.orgSource,
        partner_id: caller.partnerId,
        partner_user_ref: caller.partnerRef,
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
        ...(stateColumn ? { state: stateColumn } : {}),
        ...(huntCode ? { hunt_code: huntCode } : {}),
      },
    })
  } catch (err) {
    // Log the message only. The payload can hold coordinates.
    const message = err instanceof LinkedObjectiveError ? err.cause_message ?? err.message : 'unknown'
    console.error('[objectives/create] insert failed:', message)
    return NextResponse.json({ error: 'Could not create the objective. Try again.' }, { status: 500 })
  }

  // Resolve full geography (FF-089) if lat/lon provided — non-blocking, best-effort.
  // waitUntil keeps the function alive after the response so the ~8s resolve completes.
  if (lat != null && lon != null) {
    waitUntil(resolveFullGeography(lat, lon).then(async (geo) => {
      if (!geo) return
      const { error } = await supabase
        .from('objective_profiles')
        .update(geo)
        .eq('id', created.profileId)
      if (error) console.error('[objectives/create] geography update failed:', error.message)
    }).catch(e => console.error('[objectives/create] geography update failed:', e)))
  }

  return NextResponse.json(
    {
      // objective_id stays the objective_profiles id, as before. arc_objective_id is the objectives id.
      objective_id: created.profileId,
      arc_objective_id: created.objectiveId,
      assigned_agents: agents,
      agent_build_status: 'ready',
    },
    { status: 201 }
  )
}
