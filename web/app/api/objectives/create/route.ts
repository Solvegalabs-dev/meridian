// POST /api/objectives/create — MIP Objective Intake
// Core: intake contract is universal. Two doors, decided by the request (FF-092):
//   Session (Strike): the signed-in user owns the objective. org_source is 'strike'.
//     The body cannot name a user. The user must be on the invite list (403 if not).
//   Partner (Authorization: Bearer <key>): the key decides the partner, its org_source, and its
//     service owner. org_source and user_id in the body are ignored. partner_user_ref is the partner's
//     opaque id for its customer.
// Every objective gets an objectives row linked to its objective_profiles row, so the sweep and crons see it.
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAgentBundle } from '@/lib/swarm/objectiveRouter'
import { resolveFullGeography } from '@/lib/geo/locationResolver'
import { toProfileColumns } from '@/lib/geo/profileColumns'
import { normalizeHuntCode } from '@/lib/hunts/huntCode'
import { authenticatePartner, isPartnerRequest } from '@/lib/auth/partnerAuth'
import { partnerRateLimitResponse } from '@/lib/auth/rateLimit'
import { isUserInvited, INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'
import { checkCoverage, coverageNotice, toStateCode, COVERAGE_MODE } from '@/lib/strike/coverage'
import { loadSeasonIndex } from '@/lib/strike/coverageData'
import { checkTripDate } from '@/lib/strike/tripDateRange'
import { createLinkedObjective, LinkedObjectiveError } from '@/lib/objectives/linkedObjective'
import { createSpot, PRIMARY_SPOT_NAME } from '@/lib/spots/spotService'
import { runAgentsForObjective } from '@/lib/agents/runAgentsForObjective'

export const dynamic = 'force-dynamic'
// FF-105B: the Strike session path now also creates the first spot and kicks off the
// objective's first agent run after the response is sent (both best-effort, below).
export const maxDuration = 120

const MAX_PARTNER_REF = 128
// FF-105: Strike friends who joined via /join are capped at 2 objectives. This session
// door has no tier/limit check at all otherwise, and Arc's getMaxObjectives (trial: 3)
// is not wired into this path — so this is a small, Strike-friend-only check, not a tier change.
const STRIKE_FRIEND_MAX_OBJECTIVES = 2

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

  const service = createServiceClient()

  // FF-092 Part 2.3: the session door is invite-only. Partner keys never reach this branch.
  if (!(await isUserInvited(service, user))) {
    return NextResponse.json({ error: INVITE_ONLY_MESSAGE }, { status: 403 })
  }

  if (user.app_metadata?.signup_source === 'strike') {
    const { data: existing } = await service.from('objectives').select('status').eq('user_id', user.id)
    const activeCount = (existing ?? []).filter(o => o.status === 'active').length
    if (activeCount >= STRIKE_FRIEND_MAX_OBJECTIVES) {
      return NextResponse.json(
        { error: 'objective_limit_reached', max: STRIKE_FRIEND_MAX_OBJECTIVES },
        { status: 403 },
      )
    }
  }

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

  // FF-096b: Strike trip dates must be real and within last year to three years ahead (a year 0027 was once saved).
  // Partner requests keep their own contract.
  if (caller.partnerId === null) {
    const tripWindow = timing as { trip_start?: unknown; trip_end?: unknown }
    const problem = checkTripDate(tripWindow.trip_start, 'Trip start') ?? checkTripDate(tripWindow.trip_end, 'Trip end')
    if (problem) return NextResponse.json({ error: problem, code: 'invalid_dates' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // FF-096 Part 3: with COVERAGE_MODE 'block', a Strike (session) objective we have no data for is refused.
  // In the default 'warn' mode nothing happens here: the intake form shows the notice and asks for a second tap.
  if (COVERAGE_MODE === 'block' && caller.partnerId === null) {
    const coverage = checkCoverage({ taxonomyKey: taxonomy_key, state: geo.state, seasonIndex: await loadSeasonIndex(supabase) })
    if (coverage.covered === false) {
      return NextResponse.json({ error: coverageNotice(coverage, 'block'), code: 'not_covered' }, { status: 422 })
    }
  }

  // Resolve agent bundle from registry
  const { agents, buildStatus } = await resolveAgentBundle(taxonomy_key, geo)

  const { lat, lon } = geo

  // FF-091: the season matcher reads the state and hunt number columns, not the geo json.
  const huntCode = normalizeHuntCode(geo.unit)
  // "Utah", "ut" and "UT" all store as UT, so the season matcher finds the state's rows.
  const stateColumn = typeof geo.state === 'string' && geo.state.trim()
    ? (toStateCode(geo.state) ?? geo.state.trim().toUpperCase())
    : null

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

  // FF-105B Fix 1: the Strike session path's pin becomes the objective's first spot, resolved
  // exactly as a hand-added spot would be. Best-effort — a failure here still lets the
  // objective succeed; the user can add the spot by hand. Partner objectives are untouched.
  let primarySpotCreated = false
  if (caller.partnerId === null && lat != null && lon != null) {
    try {
      await createSpot(supabase, {
        objectiveId: created.objectiveId,
        userId: caller.ownerUserId,
        name: PRIMARY_SPOT_NAME,
        lat,
        lon,
        makeActive: true,
      })
      primarySpotCreated = true
    } catch (err) {
      // No pin coordinates in the log.
      console.error('[objectives/create] primary spot failed', err instanceof Error ? err.message : 'unknown')
    }
  }

  // Resolve full geography (FF-089) if lat/lon provided — non-blocking, best-effort.
  // waitUntil keeps the function alive after the response so the ~8s resolve completes.
  // Skipped when the primary spot above already wrote the same columns synchronously.
  if (lat != null && lon != null && !primarySpotCreated) {
    waitUntil(resolveFullGeography(lat, lon).then(async (geo) => {
      if (!geo) return
      const { error } = await supabase
        .from('objective_profiles')
        .update(toProfileColumns(geo))
        .eq('id', created.profileId)
      if (error) console.error('[objectives/create] geography update failed:', error.message)
    }).catch(e => console.error('[objectives/create] geography update failed:', e)))
  }

  // FF-105B Fix 2: run this Strike objective's own assigned agents once, after the response is
  // sent, so Intel and Signals have first readings before the next 6-hourly swarm. Never for
  // partner/MIP objectives, and never the sweep or a brief.
  if (caller.partnerId === null) {
    waitUntil(
      runAgentsForObjective(supabase, created.objectiveId).catch(e =>
        console.error('[objectives/create] first collection run failed:', e)
      )
    )
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
