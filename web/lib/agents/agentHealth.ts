import { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { sendAgentEscalationAlert } from '@/lib/email/resend'

const anthropic = new Anthropic()

export async function updateAgentHealth(
  supabase: SupabaseClient,
  agentKey: string,
  result: 'hit' | 'miss' | 'error',
  errorMessage?: string
): Promise<void> {
  if (result !== 'error') {
    await supabase
      .from('agent_health_log')
      .upsert(
        {
          agent_key: agentKey,
          consecutive_errors: 0,
          status: 'healthy',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'agent_key' }
      )
    return
  }

  const { data: current } = await supabase
    .from('agent_health_log')
    .select('consecutive_errors, status')
    .eq('agent_key', agentKey)
    .maybeSingle()

  const newErrors = ((current?.consecutive_errors as number) ?? 0) + 1

  let newStatus: string
  if (newErrors >= 10) newStatus = 'escalated'
  else if (newErrors >= 5) newStatus = 'investigating'
  else if (newErrors >= 3) newStatus = 'degraded'
  else newStatus = 'healthy'

  await supabase
    .from('agent_health_log')
    .upsert(
      {
        agent_key: agentKey,
        consecutive_errors: newErrors,
        last_error_message: errorMessage ?? null,
        last_error_at: new Date().toISOString(),
        status: newStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agent_key' }
    )

  // At exactly 5 errors: Haiku investigates the failure pattern (non-fatal)
  if (newErrors === 5) {
    runHaikuInvestigation(supabase, agentKey, errorMessage).catch(err =>
      console.error(`[agentHealth] Haiku investigation failed for ${agentKey}:`, err)
    )
  }

  // Definition of Insanity rule: 10 consecutive errors = immediate founder alert
  if (newErrors === 10) {
    sendAgentEscalationAlert({
      agentKey,
      consecutiveErrors: newErrors,
      lastErrorMessage: errorMessage,
    }).catch(err => console.error(`[agentHealth] Escalation alert failed for ${agentKey}:`, err))

    await supabase
      .from('agent_health_log')
      .update({ last_escalation_at: new Date().toISOString() })
      .eq('agent_key', agentKey)
  }
}

async function runHaikuInvestigation(
  supabase: SupabaseClient,
  agentKey: string,
  lastErrorMessage?: string
): Promise<void> {
  const { data: agent } = await supabase
    .from('agent_configs')
    .select('display_name, source_url_template, threshold_type, threshold_value')
    .eq('agent_key', agentKey)
    .maybeSingle()

  const { data: recentRuns } = await supabase
    .from('agent_run_log')
    .select('ran_at, error_message')
    .eq('agent_key', agentKey)
    .eq('result', 'error')
    .order('ran_at', { ascending: false })
    .limit(5)

  const errorLines = (recentRuns ?? [])
    .map(r => `- ${r.ran_at}: ${r.error_message ?? 'no message'}`)
    .join('\n')

  const prompt = `You are diagnosing a failing API agent. Return only a JSON object, no other text.

Agent: ${agentKey} (${agent?.display_name ?? agentKey})
URL: ${agent?.source_url_template ?? 'unknown'}
Threshold: ${agent?.threshold_type ?? 'unknown'} = ${agent?.threshold_value ?? 'unknown'}

Recent errors:
${errorLines || `Last error: ${lastErrorMessage ?? 'unknown'}`}

Return this exact JSON shape:
{
  "diagnosis": "2-3 sentence diagnosis of the most likely cause and what a developer should check first",
  "is_credential_issue": true or false,
  "credential_name": "environment variable name (e.g. MY_API_KEY) if credential issue, else null",
  "registration_url": "URL where the credential can be obtained, or null",
  "instructions": "brief instructions for obtaining and configuring the credential, or null"
}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (msg.content[0] as { type: string; text: string }).text

  let diagnosis = raw
  let isCredentialIssue = false
  let credentialName: string | null = null
  let registrationUrl: string | null = null
  let instructions: string | null = null

  try {
    const parsed = JSON.parse(raw) as {
      diagnosis?: string
      is_credential_issue?: boolean
      credential_name?: string | null
      registration_url?: string | null
      instructions?: string | null
    }
    diagnosis = parsed.diagnosis ?? raw
    isCredentialIssue = parsed.is_credential_issue === true
    credentialName = parsed.credential_name ?? null
    registrationUrl = parsed.registration_url ?? null
    instructions = parsed.instructions ?? null
  } catch {
    // Haiku didn't return valid JSON — use raw text as diagnosis, skip credential extraction
  }

  await supabase
    .from('agent_health_log')
    .update({ investigation_summary: diagnosis, updated_at: new Date().toISOString() })
    .eq('agent_key', agentKey)

  console.log(`[agentHealth] Haiku investigation for ${agentKey}: ${diagnosis}`)

  if (isCredentialIssue && credentialName) {
    // Dedup: skip if a pending request already exists for this agent + credential
    const { data: existing } = await supabase
      .from('agent_credential_requests')
      .select('id')
      .eq('agent_key', agentKey)
      .eq('credential_name', credentialName)
      .eq('status', 'pending')
      .maybeSingle()

    if (!existing) {
      await supabase.from('agent_credential_requests').insert({
        agent_key: agentKey,
        credential_name: credentialName,
        registration_url: registrationUrl,
        instructions: instructions,
        status: 'pending',
      })
      console.log(`[agentHealth] Credential request queued for ${agentKey}: ${credentialName}`)
    }
  }
}
