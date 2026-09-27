import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  identifyTriggeredCases,
  calculateMinimalSweepSet,
} from '@/lib/enterprise/progressiveSweep'
import { computeCohortMembership } from '@/lib/enterprise/computeCohortMembership'
import { runAdaptiveLearning } from '@/lib/enterprise/adaptiveLearning'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const institution_id: string | undefined = body?.institution_id
  const include_scheduled: boolean = body?.include_scheduled === true
  const dry_run: boolean = body?.dry_run === true

  if (!institution_id) {
    return NextResponse.json({ error: 'institution_id required' }, { status: 400 })
  }

  const startTime = Date.now()

  // Step 1: Ensure cohort membership is current for any cases added since last run
  const membershipResult = await computeCohortMembership(institution_id, null)
  console.log(`[progressive-sweep] Membership computed:`, membershipResult)

  // Step 2: Identify triggered cases
  const triggered = await identifyTriggeredCases(institution_id, {
    includeScheduled: include_scheduled,
    lookbackHours: 24,
    maxCases: 500,
  })

  if (!triggered.length) {
    return NextResponse.json({
      triggered: 0,
      to_sweep: 0,
      to_propagate: 0,
      message: 'No triggered cases found',
      duration_ms: Date.now() - startTime,
    })
  }

  // Step 3: Calculate minimal sweep set
  const { caseIdsToSweep, propagationMap } = calculateMinimalSweepSet(triggered)

  const totalPropagation = Array.from(propagationMap.values())
    .reduce((sum, targets) => sum + targets.length, 0)

  const costReductionPct = triggered.length > 0
    ? Math.round((1 - caseIdsToSweep.length / triggered.length) * 100)
    : 0

  console.log(`[progressive-sweep] Institution ${institution_id}: triggered=${triggered.length} to_sweep=${caseIdsToSweep.length} to_propagate=${totalPropagation} cost_reduction=${costReductionPct}%`)

  if (dry_run) {
    return NextResponse.json({
      triggered: triggered.length,
      to_sweep: caseIdsToSweep.length,
      to_propagate: totalPropagation,
      cost_reduction_pct: costReductionPct,
      dry_run: true,
      cases_to_sweep: caseIdsToSweep,
      propagation_map: Object.fromEntries(Array.from(propagationMap.entries())),
    })
  }

  // Step 4: Write sweep plan to enterprise_sweep_signals as a metadata record.
  // The existing FF-035 enterprise sweep engine handles the actual Anthropic call.
  // FF-042 will add automatic sweep execution. For now, write the plan and return
  // case_ids_to_sweep for the admin to trigger individually.
  const supabase = createServiceClient()

  await supabase.from('enterprise_sweep_signals').insert({
    institution_id,
    signal_type: 'sweep_plan',
    cohort_key: null,
    signal_body: JSON.stringify({
      triggered: triggered.length,
      to_sweep: caseIdsToSweep.length,
      to_propagate: totalPropagation,
      case_ids_to_sweep: caseIdsToSweep,
      propagation_map: Object.fromEntries(Array.from(propagationMap.entries())),
    }),
    magnitude: 3,
    direction: 'neutral',
    expires_at: new Date(Date.now() + 4 * 3600000).toISOString(), // 4h plan window
  })

  // Run adaptive learning in background — fire-and-forget, must not block response
  runAdaptiveLearning(institution_id).then(result => {
    console.log(`[adaptive-learning] Institution ${institution_id}:`, result)
  }).catch(err => {
    console.error('[adaptive-learning] Error:', err)
  })

  return NextResponse.json({
    triggered: triggered.length,
    to_sweep: caseIdsToSweep.length,
    to_propagate: totalPropagation,
    cost_reduction_pct: costReductionPct,
    duration_ms: Date.now() - startTime,
    message: 'Sweep plan written. Trigger individual sweeps for case_ids_to_sweep.',
    case_ids_to_sweep: caseIdsToSweep,
  })
}
