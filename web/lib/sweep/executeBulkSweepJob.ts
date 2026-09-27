import { createServiceClient } from '@/lib/supabase/server'
import { runSweepForUser } from './runSweepForUser'
import { sendSweepReportEmail, sendBulkSweepFailureAlert } from '@/lib/email/resend'

interface JobFailure {
  userId: string
  email: string | null
  error: string
}

// Processes a single bulk_sweep_job_accounts row and sends the email.
// Called by the account-queue worker (one account per cron invocation) so
// that each account gets its own 300 s Vercel budget regardless of cohort size.
export async function processSingleJobAccount(
  accountId: string,
  jobId: string,
  userId: string
): Promise<{ success: boolean; userEmail: string | null; error?: string }> {
  const supabase = createServiceClient()

  await supabase.from('bulk_sweep_job_accounts')
    .update({ sweep_status: 'running' })
    .eq('id', accountId)

  try {
    const result = await runSweepForUser(userId, { triggerType: 'scheduled' })

    if (!result.success) {
      const errorMsg = result.error ?? 'Unknown sweep error'
      await supabase.from('bulk_sweep_job_accounts')
        .update({ sweep_status: 'failed', sweep_error: errorMsg, email_status: 'skipped' })
        .eq('id', accountId)
      return { success: false, userEmail: result.userEmail, error: errorMsg }
    }

    await supabase.from('bulk_sweep_job_accounts')
      .update({ sweep_status: 'complete', sweep_id: result.sweepId })
      .eq('id', accountId)

    if (!result.userEmail) {
      await supabase.from('bulk_sweep_job_accounts')
        .update({ email_status: 'skipped', email_error: 'No email on account' })
        .eq('id', accountId)
      return { success: true, userEmail: null }
    }

    try {
      await sendSweepReportEmail({
        toEmail: result.userEmail,
        summary: result.summary,
        topPriorityAction: result.topPriorityAction,
        objectives: result.objectives,
        facReports: result.facReports,
      })
      await supabase.from('bulk_sweep_job_accounts')
        .update({ email_status: 'sent', email_sent_at: new Date().toISOString() })
        .eq('id', accountId)
    } catch (emailErr) {
      await supabase.from('bulk_sweep_job_accounts')
        .update({
          email_status: 'failed',
          email_error: emailErr instanceof Error ? emailErr.message : 'Email send failed',
        })
        .eq('id', accountId)
    }

    return { success: true, userEmail: result.userEmail }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unexpected error'
    await supabase.from('bulk_sweep_job_accounts')
      .update({ sweep_status: 'failed', sweep_error: errorMsg, email_status: 'skipped' })
      .eq('id', accountId)
    return { success: false, userEmail: null, error: errorMsg }
  }
}

// Runs every pending account row on a bulk_sweep_jobs job, one at a time.
// Callable both immediately (from the admin trigger route) and from the
// scheduled-job cron poller. Each account is wrapped in its own try/catch
// so one failure never stops the rest of the job from running.
export async function executeBulkSweepJob(jobId: string): Promise<void> {
  const supabase = createServiceClient()

  const [{ data: job }, { data: accounts }] = await Promise.all([
    supabase.from('bulk_sweep_jobs').select('*').eq('id', jobId).single(),
    supabase.from('bulk_sweep_job_accounts').select('*').eq('job_id', jobId),
  ])

  if (!job || !accounts || accounts.length === 0) return

  const failures: JobFailure[] = []

  for (const account of accounts) {
    try {
      await supabase.from('bulk_sweep_job_accounts')
        .update({ sweep_status: 'running' })
        .eq('id', account.id)

      const result = await runSweepForUser(account.user_id, { triggerType: 'scheduled' })

      if (!result.success) {
        const errorMsg = result.error ?? 'Unknown sweep error'
        await supabase.from('bulk_sweep_job_accounts')
          .update({
            sweep_status: 'failed',
            sweep_error: errorMsg,
            // Never email a broken or partial report.
            email_status: 'skipped',
          })
          .eq('id', account.id)
        failures.push({ userId: account.user_id, email: result.userEmail, error: errorMsg })
        continue
      }

      await supabase.from('bulk_sweep_job_accounts')
        .update({ sweep_status: 'complete', sweep_id: result.sweepId })
        .eq('id', account.id)

      if (!result.userEmail) {
        await supabase.from('bulk_sweep_job_accounts')
          .update({ email_status: 'skipped', email_error: 'No email on account' })
          .eq('id', account.id)
        continue
      }

      try {
        await sendSweepReportEmail({
          toEmail: result.userEmail,
          summary: result.summary,
          topPriorityAction: result.topPriorityAction,
          objectives: result.objectives,
          facReports: result.facReports,
        })
        await supabase.from('bulk_sweep_job_accounts')
          .update({ email_status: 'sent', email_sent_at: new Date().toISOString() })
          .eq('id', account.id)
      } catch (emailErr) {
        await supabase.from('bulk_sweep_job_accounts')
          .update({
            email_status: 'failed',
            email_error: emailErr instanceof Error ? emailErr.message : 'Email send failed',
          })
          .eq('id', account.id)
      }

    } catch (err) {
      // Catch-all — an unexpected exception for this account (not a
      // graceful runSweepForUser failure) still must not stop the loop.
      const errorMsg = err instanceof Error ? err.message : 'Unexpected error'
      await supabase.from('bulk_sweep_job_accounts')
        .update({ sweep_status: 'failed', sweep_error: errorMsg, email_status: 'skipped' })
        .eq('id', account.id)
      failures.push({ userId: account.user_id, email: null, error: errorMsg })
    }
  }

  await supabase.from('bulk_sweep_jobs')
    .update({ status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', jobId)

  // One alert per job, sent after the loop finishes — not one per failure.
  if (failures.length > 0) {
    await sendBulkSweepFailureAlert({
      jobId,
      cohort: job.cohort_filter ?? 'unknown',
      totalAccounts: accounts.length,
      failures,
    }).catch(console.error)
  }
}
