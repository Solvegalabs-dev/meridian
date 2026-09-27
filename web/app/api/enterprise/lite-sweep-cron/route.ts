import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runPortfolioSweep } from '@/lib/enterprise/sweep-fork1'
import { runObjectiveSweep } from '@/lib/enterprise/sweep-fork2'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Runs daily via Vercel Cron. Finds monitoring_lite objectives due for their
// next lite sweep (per lite_sweep_cadence_days) and sweeps each one. Reuses
// the same runObjectiveSweep() used by /api/enterprise/sweep — a "lite" sweep
// is just an objective sweep on an objective whose objective_state is
// 'monitoring_lite' (see sweep-fork2.ts). Alert evaluation and any
// escalation-to-focus notification happen inside runObjectiveSweep itself.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data: liteObjectives, error: objErr } = await supabase
    .from('enterprise_objectives')
    .select('id, obj_id, institution_id, last_lite_sweep_at, lite_sweep_cadence_days')
    .eq('objective_state', 'monitoring_lite')
    .eq('status', 'active')

  if (objErr) {
    console.error('[FF-035D:lite-sweep-cron] failed to load objectives:', objErr)
    return NextResponse.json({ error: objErr.message }, { status: 500 })
  }

  const now = Date.now()
  const due = (liteObjectives ?? []).filter(o => {
    if (!o.last_lite_sweep_at) return true
    const cadenceMs = (o.lite_sweep_cadence_days ?? 14) * 86400000
    return new Date(o.last_lite_sweep_at as string).getTime() + cadenceMs <= now
  })

  if (due.length === 0) {
    return NextResponse.json({ checked: liteObjectives?.length ?? 0, due: 0, succeeded: 0, failed: 0 })
  }

  // Each due objective needs a portfolio_metrics_id for scope/context. Reuse
  // the institution's latest metrics row instead of running a fresh (Sonnet,
  // non-lite-cost) portfolio sweep per institution per day; only seed one if
  // the institution has never had a portfolio sweep at all.
  const institutionIds = Array.from(new Set(due.map(o => o.institution_id as string)))
  const metricsIdByInstitution = new Map<string, string>()

  for (const institutionId of institutionIds) {
    const { data: latest } = await supabase
      .from('enterprise_portfolio_metrics')
      .select('id')
      .eq('institution_id', institutionId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single()

    if (latest) {
      metricsIdByInstitution.set(institutionId, latest.id as string)
      continue
    }

    try {
      const fork1 = await runPortfolioSweep(institutionId)
      metricsIdByInstitution.set(institutionId, fork1.metricsId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[FF-035D:lite-sweep-cron] seed portfolio sweep failed for institution ${institutionId}:`, msg)
    }
  }

  const settled = await Promise.allSettled(
    due.map(async obj => {
      const metricsId = metricsIdByInstitution.get(obj.institution_id as string)
      if (!metricsId) throw new Error(`no portfolio metrics available for institution ${obj.institution_id}`)

      const result = await runObjectiveSweep(obj.institution_id as string, obj.id as string, metricsId)

      await supabase
        .from('enterprise_objectives')
        .update({ last_lite_sweep_at: new Date().toISOString() })
        .eq('id', obj.id)

      return result
    })
  )

  const succeeded = settled.filter(r => r.status === 'fulfilled').length
  const errors: Array<{ objective_id: string; obj_id: string; error: string }> = []

  const failureLogs: Array<PromiseLike<unknown>> = []
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const obj = due[i]
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.error(`[FF-035D:lite-sweep-cron] sweep failed for ${obj.obj_id} (${obj.id}):`, msg)
      errors.push({ objective_id: obj.id as string, obj_id: obj.obj_id as string, error: msg })

      // Record the rejection so the sweep health dashboard can surface it —
      // a rejected runObjectiveSweep() call otherwise leaves no trace in
      // enterprise_sweeps.
      failureLogs.push(
        supabase.from('enterprise_sweeps').insert({
          institution_id: obj.institution_id,
          objective_id: obj.id,
          trigger_type: 'scheduled',
          status: 'failed',
          fork: 'objective',
          sweep_type: 'lite',
          engine_version: 'ff-035b-v1',
          started_at: new Date(now).toISOString(),
          completed_at: new Date().toISOString(),
          error_message: msg,
        })
      )
    }
  })
  await Promise.allSettled(failureLogs)

  return NextResponse.json({
    checked: liteObjectives?.length ?? 0,
    due: due.length,
    succeeded,
    failed: errors.length,
    errors,
  })
}
