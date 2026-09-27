import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendAgentEscalationAlert } from '@/lib/email/resend'

export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data: unhealthy, error } = await supabase
    .from('agent_health_log')
    .select('*')
    .neq('status', 'healthy')
    .order('consecutive_errors', { ascending: false })

  if (error) {
    console.error('[swarm-health] Failed to query agent_health_log:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const counts = { degraded: 0, investigating: 0, escalated: 0, realerted: 0 }

  for (const row of unhealthy ?? []) {
    const agentKey = row.agent_key as string
    const status = row.status as string
    const errors = row.consecutive_errors as number

    console.log(`[swarm-health] ${agentKey}: status=${status} consecutive_errors=${errors}`)

    if (status === 'degraded') {
      counts.degraded++
    }

    if (status === 'investigating') {
      counts.investigating++
    }

    if (status === 'escalated') {
      counts.escalated++

      // Re-alert every 24h until the agent is manually fixed or self-heals
      const lastAlertAt = row.last_escalation_at ? new Date(row.last_escalation_at as string) : null
      const hoursElapsed = lastAlertAt ? (Date.now() - lastAlertAt.getTime()) / 3600000 : Infinity

      if (hoursElapsed >= 24) {
        console.log(`[swarm-health] ${agentKey}: re-alerting founder (${errors} errors, last alert ${Math.floor(hoursElapsed)}h ago)`)
        try {
          await sendAgentEscalationAlert({
            agentKey,
            consecutiveErrors: errors,
            lastErrorMessage: row.last_error_message as string | undefined,
          })
          await supabase
            .from('agent_health_log')
            .update({ last_escalation_at: new Date().toISOString() })
            .eq('agent_key', agentKey)
          counts.realerted++
        } catch (err) {
          console.error(`[swarm-health] Re-alert failed for ${agentKey}:`, err)
        }
      }
    }
  }

  console.log(`[swarm-health] scan complete — unhealthy=${unhealthy?.length ?? 0} ${JSON.stringify(counts)}`)

  return NextResponse.json({
    ok: true,
    unhealthy: unhealthy?.length ?? 0,
    ...counts,
  })
}
