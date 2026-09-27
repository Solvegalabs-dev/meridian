import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Kick-off only — account processing handled by process-account-queue worker

// Vercel Cron only — never callable by an end user. Secured with CRON_SECRET.
// Responsibilities:
//   1. Reap sweep rows stuck at status='running' longer than Vercel's max function duration.
//   2. Reap bulk_sweep_job_accounts stuck at sweep_status='running' for >15 min and mark affected jobs complete.
//   3. Transition bulk_sweep_jobs that are due (scheduled_at <= now) from 'scheduled' -> 'running'.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // 1. Reap sweeps stuck at status='running' for more than 10 minutes.
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: staleSweeps, error: staleErr } = await supabase
    .from('sweeps')
    .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'Timed out — reaped by watchdog' })
    .eq('status', 'running')
    .lt('started_at', staleThreshold)
    .select('id, user_id')

  if (staleErr) {
    console.error('[cron:stale-recovery] error marking stale sweeps failed:', staleErr)
  } else if (staleSweeps && staleSweeps.length > 0) {
    console.log(`[cron:stale-recovery] marked ${staleSweeps.length} stale sweep(s) failed:`, staleSweeps.map(s => s.id))
  }

  // 2. Reap bulk_sweep_job_accounts stuck at sweep_status='running' for >15 min.
  // Each process-account-queue invocation has a 600s Vercel budget; 15 min means the invocation died.
  const stuckAccountThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: stuckAccounts, error: stuckErr } = await supabase
    .from('bulk_sweep_job_accounts')
    .update({
      sweep_status: 'failed',
      sweep_error: 'Timed out — reaped by watchdog',
      completed_at: new Date().toISOString(),
    })
    .eq('sweep_status', 'running')
    .or(`started_at.is.null,started_at.lt.${stuckAccountThreshold}`)
    .select('id, job_id')

  if (stuckErr) {
    console.error('[cron:stuck-accounts] error reaping stuck accounts:', stuckErr)
  } else if (stuckAccounts && stuckAccounts.length > 0) {
    console.log(`[cron:stuck-accounts] reaped ${stuckAccounts.length} stuck account(s)`)

    // Mark any jobs that now have 0 pending/running accounts as complete.
    const affectedJobIds = Array.from(new Set(stuckAccounts.map(a => a.job_id)))
    for (const jobId of affectedJobIds) {
      const { count } = await supabase
        .from('bulk_sweep_job_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .in('sweep_status', ['pending', 'running'])

      if (count === 0) {
        await supabase.from('bulk_sweep_jobs')
          .update({ status: 'complete', completed_at: new Date().toISOString() })
          .eq('id', jobId)
          .eq('status', 'running')
        console.log(`[cron:job-complete] job ${jobId} marked complete after stuck-account reap`)
      }
    }
  }

  // 3. Transition due bulk_sweep_jobs from 'scheduled' -> 'running'.
  const { data: dueJobs } = await supabase
    .from('bulk_sweep_jobs')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  if (dueJobs && dueJobs.length > 0) {
    for (const job of dueJobs) {
      await supabase.from('bulk_sweep_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', job.id)
      console.log(`[cron:job-started] ${job.id} — kicking off queue worker`)
    }
  }

  // Drain one pending account from any running job.
  // Self-chaining was removed from process-account-queue — each cron fire here
  // picks up exactly one pending account. At */5 cadence: ~5 min per account.
  const { count: pendingCount } = await supabase
    .from('bulk_sweep_job_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('sweep_status', 'pending')

  if ((pendingCount ?? 0) > 0) {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 500)
    await fetch(`${baseUrl}/api/admin/sweeps/process-account-queue`, {
      headers: { 'X-Cron-Secret': process.env.CRON_SECRET ?? '' },
      signal: controller.signal,
    }).catch(() => {})
  }

  return NextResponse.json({
    kicked_off: dueJobs?.length ?? 0,
    stale_reaped: staleSweeps?.length ?? 0,
    pending_drained: (pendingCount ?? 0) > 0 ? 1 : 0,
  })
}
