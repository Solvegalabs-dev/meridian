import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processSingleJobAccount } from '@/lib/sweep/executeBulkSweepJob'
import { sendBulkSweepFailureAlert } from '@/lib/email/resend'

export const dynamic = 'force-dynamic'
export const maxDuration = 600


export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret')
  const expectedSecret = process.env.CRON_SECRET?.trim() ?? ''
  if (!expectedSecret || cronSecret?.trim() !== expectedSecret) {
    console.error('[queue-worker] auth failed — x-cron-secret mismatch')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Pick the oldest pending account across all running jobs.
  const { data: nextAccount } = await supabase
  .from('bulk_sweep_job_accounts')
  .select('id, job_id, user_id, bulk_sweep_jobs!inner(status)')
  .eq('sweep_status', 'pending')
  .eq('bulk_sweep_jobs.status', 'running')
  .order('created_at', { ascending: true })
  .limit(1)
  .maybeSingle()

  if (!nextAccount) {
    return NextResponse.json({ processed: 0, message: 'Queue empty' })
  }

  // Mark this account running immediately to prevent double-processing on concurrent cron fires.
  await supabase
    .from('bulk_sweep_job_accounts')
    .update({ sweep_status: 'running', started_at: new Date().toISOString() })
    .eq('id', nextAccount.id)
    .eq('sweep_status', 'pending') // only if still pending (prevent double-processing)

  console.log(`[queue-worker] processing account=${nextAccount.id} job=${nextAccount.job_id} user=${nextAccount.user_id}`)

  const result = await processSingleJobAccount(
    nextAccount.id,
    nextAccount.job_id,
    nextAccount.user_id
  )

  // Check if this job is now fully complete.
  const { count: remaining } = await supabase
    .from('bulk_sweep_job_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', nextAccount.job_id)
    .in('sweep_status', ['pending', 'running'])

  if (remaining === 0) {
    await supabase.from('bulk_sweep_jobs')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', nextAccount.job_id)

    const { data: failedAccounts } = await supabase
      .from('bulk_sweep_job_accounts')
      .select('user_id, sweep_error')
      .eq('job_id', nextAccount.job_id)
      .eq('sweep_status', 'failed')

    if (failedAccounts && failedAccounts.length > 0) {
      const { data: job } = await supabase
        .from('bulk_sweep_jobs').select('cohort_filter').eq('id', nextAccount.job_id).single()
      const { count: totalCount } = await supabase
        .from('bulk_sweep_job_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', nextAccount.job_id)

      await sendBulkSweepFailureAlert({
        jobId: nextAccount.job_id,
        cohort: job?.cohort_filter ?? 'unknown',
        totalAccounts: totalCount ?? 0,
        failures: failedAccounts.map(a => ({
          userId: a.user_id,
          email: null,
          error: (a.sweep_error as string | null) ?? 'Unknown error',
        })),
      }).catch(console.error)
    }

    console.log(`[queue-worker] job ${nextAccount.job_id} complete`)
  }

  return NextResponse.json({
    processed: 1,
    account_id: nextAccount.id,
    job_id: nextAccount.job_id,
    success: result.success,
    remaining,
  })
}
