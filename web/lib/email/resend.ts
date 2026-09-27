import { ADMIN_EMAIL } from '@/lib/admin/requireAdminUser'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'jason@solvega.ai'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://meridianarc.ai'

export async function sendConfidenceAlert({
  toEmail,
  objectiveTitle,
  prevScore,
  newScore,
  delta,
}: {
  toEmail: string
  objectiveTitle: string
  prevScore: number
  newScore: number
  delta: number
}) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email')
    return
  }

  const direction = delta > 0 ? 'increased' : 'decreased'
  const arrow = delta > 0 ? '↑' : '↓'

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="margin-bottom: 24px;">
        <span style="font-size: 13px; color: #8098B4; text-transform: uppercase; letter-spacing: 0.1em;">Meridian Arc · Confidence Alert</span>
      </div>
      <h2 style="font-size: 20px; font-weight: 500; color: #1A1A2E; margin: 0 0 8px;">
        ${arrow} ${Math.abs(delta)} point${Math.abs(delta) !== 1 ? 's' : ''} ${direction}
      </h2>
      <p style="font-size: 14px; color: #4A5568; margin: 0 0 24px;">
        <strong>${objectiveTitle}</strong> confidence ${direction} from ${prevScore}% to ${newScore}% after your latest sweep.
      </p>
      <a href="${APP_URL}/objectives" style="display: inline-block; background: #0B1829; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;">
        View scorecard →
      </a>
      <p style="font-size: 11px; color: #8098B4; margin-top: 32px;">
        Solvega Labs · meridianarc.ai · <a href="#" style="color: #8098B4;">Unsubscribe</a>
      </p>
    </div>
  `

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Meridian Arc <${FROM_EMAIL}>`,
        to: toEmail,
        subject: `${arrow} ${objectiveTitle} confidence ${direction} to ${newScore}%`,
        html,
      }),
    })
  } catch (err) {
    console.error('Resend email failed:', err)
  }
}

interface SweepReportObjective {
  title: string
  confidence_prev: number
  confidence_new: number
  delta: number
  actions: string[]
}

interface SweepFACReport {
  signal_category: string
  signal_summary: string
  forward_signal_type: 'risk' | 'opportunity' | 'condition_change'
  confidence_implication: number
}

// Per-account bulk-sweep report email. Unlike sendConfidenceAlert (a
// best-effort side notification that swallows its own errors), this one
// throws on failure so the caller (executeBulkSweepJob) can record a real
// email_status = 'failed' with the actual error, rather than silently
// treating every send as successful.
export async function sendSweepReportEmail({
  toEmail,
  summary,
  topPriorityAction,
  objectives,
  facReports,
}: {
  toEmail: string
  summary: string | null
  topPriorityAction: string | null
  objectives: SweepReportObjective[]
  facReports?: SweepFACReport[]
}) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not set — cannot send sweep report email')
  }

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const deltaRows = objectives.map(o => {
    const arrow = o.delta > 0 ? '↑' : o.delta < 0 ? '↓' : '→'
    const color = o.delta > 0 ? '#2EA88C' : o.delta < 0 ? '#C0392B' : '#8098B4'
    return `
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #1A1A2E;">${o.title}</td>
        <td style="padding: 8px 0; font-size: 13px; color: ${color}; text-align: right; white-space: nowrap;">
          ${o.confidence_prev}% ${arrow} ${o.confidence_new}%
        </td>
      </tr>
    `
  }).join('')

  const actionsHtml = objectives
    .flatMap(o => o.actions.slice(0, 2))
    .slice(0, 5)
    .map(a => `<li style="margin-bottom: 6px;">${a}</li>`)
    .join('')

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="margin-bottom: 24px;">
        <span style="font-size: 13px; color: #8098B4; text-transform: uppercase; letter-spacing: 0.1em;">Meridian Arc · Sweep Report</span>
      </div>
      <h2 style="font-size: 20px; font-weight: 500; color: #1A1A2E; margin: 0 0 8px;">
        Your sweep — ${dateStr}
      </h2>
      ${summary ? `<p style="font-size: 14px; color: #4A5568; margin: 0 0 20px;">${summary}</p>` : ''}
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        ${deltaRows}
      </table>
      ${topPriorityAction ? `
        <div style="background: #F4F6F8; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="font-size: 11px; color: #8098B4; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 6px;">Top priority</p>
          <p style="font-size: 13px; color: #1A1A2E; margin: 0;">${topPriorityAction}</p>
        </div>
      ` : ''}
      ${actionsHtml ? `
        <p style="font-size: 11px; color: #8098B4; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px;">Recommended actions</p>
        <ul style="font-size: 13px; color: #4A5568; padding-left: 18px; margin: 0 0 24px;">${actionsHtml}</ul>
      ` : ''}
      ${facReports && facReports.length > 0 ? `
        <div style="border-top: 1px solid #E2E8F0; margin: 24px 0; padding-top: 20px;">
          <p style="font-size: 11px; color: #8098B4; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 12px;">⚡ What&apos;s ahead — FAC Engine</p>
          ${facReports.map(r => {
            const icon = r.forward_signal_type === 'risk' ? '⚠️' :
                         r.forward_signal_type === 'opportunity' ? '🟢' : '📡';
            const impl = r.confidence_implication > 0 ? `+${r.confidence_implication}%` : `${r.confidence_implication}%`;
            return `<div style="margin-bottom: 12px;">
              <p style="font-size: 11px; font-weight: 600; color: #1A1A2E; margin: 0 0 3px; text-transform: uppercase; letter-spacing: 0.04em;">${icon} ${r.signal_category.replace(/_/g, ' ')}</p>
              <p style="font-size: 12px; color: #4A5568; margin: 0;">${r.signal_summary} <span style="color: #8098B4;">(Confidence: ${impl})</span></p>
            </div>`;
          }).join('')}
        </div>
      ` : ''}
      <p style="font-size: 13px; color: #4A5568; margin: 0 0 20px;">
        Log in and fill out Sections A through D of your Alpha Journal based on this week's sweep.
      </p>
      <a href="${APP_URL}/dashboard" style="display: inline-block; background: #0B1829; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;">
        Open Meridian Arc →
      </a>
      <p style="font-size: 11px; color: #8098B4; margin-top: 32px;">
        Solvega Labs · meridianarc.ai
      </p>
    </div>
  `

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Meridian Arc <${FROM_EMAIL}>`,
      to: toEmail,
      subject: `Your Meridian Arc sweep — ${dateStr}`,
      html,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Resend API error (${res.status}): ${text}`)
  }
}

export async function sendAgentEscalationAlert({
  agentKey,
  consecutiveErrors,
  lastErrorMessage,
}: {
  agentKey: string
  consecutiveErrors: number
  lastErrorMessage?: string
}) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping agent escalation alert')
    return
  }

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <span style="font-size: 13px; color: #C0392B; text-transform: uppercase; letter-spacing: 0.1em;">🚨 Meridian Arc · Swarm Maestro</span>
      <h2 style="font-size: 20px; color: #1A1A2E; margin: 12px 0 8px;">
        Agent down — ${consecutiveErrors} consecutive errors
      </h2>
      <p style="font-size: 14px; color: #4A5568; margin: 0 0 8px;">
        <strong>${agentKey}</strong> has failed ${consecutiveErrors} times in a row.
      </p>
      ${lastErrorMessage ? `
        <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 12px; margin: 16px 0;">
          <p style="font-size: 12px; color: #C0392B; font-family: monospace; margin: 0; word-break: break-all;">${lastErrorMessage}</p>
        </div>
      ` : ''}
      <p style="font-size: 13px; color: #4A5568; margin: 16px 0;">
        This agent has crossed the Definition of Insanity threshold. Manual investigation required — this agent will not resolve itself.
      </p>
      <a href="${APP_URL}/admin" style="display: inline-block; background: #C0392B; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;">
        Open admin panel →
      </a>
      <p style="font-size: 11px; color: #8098B4; margin-top: 32px;">
        Solvega Labs · meridianarc.ai
      </p>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Meridian Arc <${FROM_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `🚨 ${agentKey} — ${consecutiveErrors} consecutive failures`,
        html,
      }),
    })
    if (!res.ok) {
      console.error('[resend] Agent escalation alert failed:', await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[resend] Agent escalation alert failed:', err)
  }
}

// Internal notification to Jason — one email per job, batched after the
// full account loop finishes, not one per failure.
export async function sendBulkSweepFailureAlert({
  jobId,
  cohort,
  totalAccounts,
  failures,
}: {
  jobId: string
  cohort: string
  totalAccounts: number
  failures: Array<{ userId: string; email: string | null; error: string }>
}) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping bulk sweep failure alert')
    return
  }

  const rows = failures.map(f => `
    <tr>
      <td style="padding: 6px 12px 6px 0; font-size: 12px; color: #1A1A2E; font-family: monospace; vertical-align: top;">${f.email ?? f.userId}</td>
      <td style="padding: 6px 0; font-size: 12px; color: #C0392B; vertical-align: top;">${f.error}</td>
    </tr>
  `).join('')

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
      <span style="font-size: 13px; color: #8098B4; text-transform: uppercase; letter-spacing: 0.1em;">Meridian Arc · Bulk Sweep Alert</span>
      <h2 style="font-size: 18px; color: #1A1A2E; margin: 8px 0;">
        ${failures.length} failure${failures.length !== 1 ? 's' : ''} in bulk sweep job
      </h2>
      <p style="font-size: 13px; color: #4A5568; margin: 0 0 16px;">
        Job <code>${jobId}</code> · cohort <strong>${cohort}</strong> · ${totalAccounts} account${totalAccounts !== 1 ? 's' : ''} total, ${failures.length} failed
      </p>
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Meridian Arc <${FROM_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `Bulk sweep: ${failures.length} failure${failures.length !== 1 ? 's' : ''} in job ${jobId.slice(0, 8)}`,
        html,
      }),
    })
    if (!res.ok) {
      console.error('Failed to send bulk sweep failure alert:', await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('Failed to send bulk sweep failure alert:', err)
  }
}
