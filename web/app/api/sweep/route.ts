import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runSweepForUser } from '@/lib/sweep/runSweepForUser'
import { checkWatchSources } from '@/lib/watchlist/checkWatchSources'
import { generateVoiceBrief } from '@/lib/voice/generateVoiceBrief'

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // Vercel Pro — 12000 token budget at ~267s leaves 333s runway

const RATE_LIMITED_TYPES = new Set(['alpha_personal', 'alpha_business', 'beta', 'personal'])
const RATE_LIMIT_MS = 23 * 60 * 60 * 1000

export async function POST(request: NextRequest) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    objective_ids?: string[]
    manual_signals?: string
  }

  // Fetch profile for rate limit check
  const service = createServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('account_type, last_sweep_at')
    .eq('id', user.id)
    .single()

  // Rate limit: 23h minimum gap for all current account types.
  // @solvegalabs.com accounts are exempt — internal use, no cap.
  const isInternal = user.email?.endsWith('@solvegalabs.com') ?? false
  if (!isInternal && RATE_LIMITED_TYPES.has(profile?.account_type ?? 'personal')) {
    if (profile?.last_sweep_at) {
      const nextSweepAt = new Date(new Date(profile.last_sweep_at).getTime() + RATE_LIMIT_MS)
      if (nextSweepAt > new Date()) {
        return NextResponse.json(
          { error: 'rate_limited', next_sweep_at: nextSweepAt.toISOString() },
          { status: 429 }
        )
      }
    }
  }

  const result = await runSweepForUser(user.id, {
    objectiveIds: body.objective_ids,
    manualSignals: body.manual_signals,
  })

  if (!result.success) {
    const status = result.error === 'No active objectives found' ? 400 : 500
    return NextResponse.json({ error: result.error ?? 'Sweep failed' }, { status })
  }

  // Record sweep time on success
  await service
    .from('profiles')
    .update({ last_sweep_at: new Date().toISOString() })
    .eq('id', user.id)

  // Generate voice brief post-sweep — non-fatal
  try {
    await generateVoiceBrief(service, user.id, result.sweepId!)
  } catch (err) {
    console.error('[voice:brief] generateVoiceBrief failed:', err)
  }

  // Check watch sources post-sweep — non-fatal
  try {
    const watchResults = await checkWatchSources(user.id)
    const fired = watchResults.filter(r => r.status === 'signal_confirmed' || r.status === 'signal_detected').length
    console.log(`[watch:done] sources=${watchResults.length} alerts_fired=${fired}`)
  } catch (err) {
    console.error('[watch:error] checkWatchSources failed:', err)
  }

  return NextResponse.json({
    sweep_id: result.sweepId,
    status: 'complete',
    signal_count: result.signalCount,
    objectives: result.objectives,
    summary: result.summary,
    top_priority_action: result.topPriorityAction,
    cross_dependencies: result.crossDependencies,
    tokens_used: result.tokensUsed,
    cost_usd: result.costUsd,
  })
}
