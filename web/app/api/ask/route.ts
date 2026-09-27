// app/api/ask/route.ts
// FF-017 — Ask Meridian: On-Demand Intelligence Queries
// FF-065 — Unified Ask: intent router (external = Brave+Sonnet, internal = Concierge/Sonnet)
// Solvega Labs LLC · Meridian Arc · Confidential

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getAnthropicClient } from '@/lib/anthropic/client'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { createClient } from '@/lib/supabase/server'
import { extractAskSignals } from '@/lib/ask/extractSignals'
import { extractResponseSignals } from '@/lib/ask/extractResponseSignals'
import { classifyAskIntent, type AskIntent } from '@/lib/ask/intentClassifier'
import { buildConciergeContext } from '@/lib/concierge/buildConciergeContext'
import { buildConciergePrompt, type ConciergeResponse } from '@/lib/concierge/conciergePrompt'
import { executeBraveSearch } from '@/lib/signals/braveSearch'

// ── Tier gate ──────────────────────────────────────────────────────────────
const ASK_LIMITS: Record<string, number> = {
  command: 20,
  accelerator: 10,
  explorer: 5,
  trial: 0,
}

function getEffectiveTier(profile: {
  pricing_tier: string | null
  tier: string | null
  complimentary_expires_at: string | null
}): string {
  if (
    profile.complimentary_expires_at &&
    new Date(profile.complimentary_expires_at) > new Date()
  ) {
    return 'explorer'
  }
  const raw = profile.pricing_tier ?? profile.tier ?? 'trial'
  if (raw.includes('explorer')) return 'explorer'
  if (raw.includes('accelerator')) return 'accelerator'
  if (raw.includes('command')) return 'command'
  return raw
}

// ── Phase C: synchronous action candidate extraction ──────────────────────
function extractActionCandidates(text: string): string[] {
  const stripped = text
    .replace(/\*\*/g, '')
    .replace(/^[-*#\d.]+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  const sentences = stripped
    .split(/\n|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 200)

  const nonImperativeStarters = /^(i |the |a |an |this |that |it |there |we |you |based |most |many |some |each |if |when |as |because|note|usually|typically|historically|often|since|while)/i

  const likely = sentences.filter(s => {
    if (nonImperativeStarters.test(s)) return false
    return /^[A-Z][a-z]/.test(s)
      && s.split(' ').length > 5
      && !/\(.*\)$/.test(s)
  })

  return likely.slice(0, 3)
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createClient()

  // 1. Authenticate
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse + validate request body
  let body: { question?: string; intent?: AskIntent }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const question = (body.question ?? '').trim()
  if (!question || question.length > 1000) {
    return NextResponse.json(
      { error: 'question is required and must be under 1000 characters' },
      { status: 400 }
    )
  }

  const intentHint = body.intent

  // 3. Load profile for tier + credit check
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('tier, pricing_tier, complimentary_expires_at, sweep_credits, ask_credits')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const effectiveTier = getEffectiveTier(profile)
  const baseLimit = ASK_LIMITS[effectiveTier] ?? 0

  if (baseLimit === 0) {
    return NextResponse.json(
      {
        error: 'Ask Meridian is not available on your current plan. Upgrade to Explorer or higher to get started.',
        upgrade_required: true,
      },
      { status: 403 }
    )
  }

  // 4. Count this month's queries
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const { count: monthlyCount, error: countError } = await supabase
    .from('ask_queries')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStart.toISOString())

  if (countError) {
    console.error('[ask] Usage count failed:', countError.message)
    return NextResponse.json({ error: 'Failed to check usage. Please try again.' }, { status: 500 })
  }

  const used = monthlyCount ?? 0

  // 5. Enforce monthly limit — ask_credits are overflow
  const askCredits = profile.ask_credits ?? 0
  let useAskCredit = false
  let useCredit = false

  if (used >= baseLimit) {
    if (askCredits > 0) {
      useAskCredit = true
    } else if (effectiveTier === 'accelerator' && (profile.sweep_credits ?? 0) > 0) {
      useCredit = true
    } else {
      const upgradeHint =
        effectiveTier === 'explorer'
          ? ' Upgrade to Accelerator for 10/month.'
          : effectiveTier === 'accelerator'
          ? ' Add ask query credits in Settings or upgrade to Command.'
          : ''
      return NextResponse.json(
        {
          error: `You've used all ${baseLimit} Ask ${baseLimit === 1 ? 'query' : 'queries'} for this month.${upgradeHint}`,
          limit_reached: true,
          used,
          limit: baseLimit,
        },
        { status: 429 }
      )
    }
  }

  // 6. Load active objectives as context
  const { data: objectives, error: objError } = await supabase
    .from('objectives')
    .select('id, title, outcome, goal_description, status, target_date, objective_type, context, signal_keywords')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(12)

  if (objError) console.error('[ask:objectives] query error:', objError.message)
  const objectiveContext = objectives ?? []

  function syncMatchObjectives(q: string, objs: typeof objectiveContext): string[] {
    const ql = q.toLowerCase()
    return objs
      .filter(obj => {
        const keywords: string[] = obj.signal_keywords ?? []
        return keywords.some(kw => {
          const tokens = kw.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 4)
          if (tokens.length === 0) return ql.includes(kw.toLowerCase())
          return tokens.every((t: string) => ql.includes(t))
        })
      })
      .map(obj => obj.id)
  }

  const matchedObjectiveIds = syncMatchObjectives(question, objectiveContext)

  // 7. Classify intent
  const resolvedIntent: AskIntent = intentHint ?? await classifyAskIntent(question)

  // 8. Extra credit check: internal queries cost 2 credits in overflow mode
  if (resolvedIntent === 'internal' && useAskCredit && askCredits < 2) {
    return NextResponse.json(
      { error: 'Goal questions cost 2 credits. Add more ask credits in Settings.', limit_reached: true },
      { status: 402 }
    )
  }

  // 9. Execute the appropriate engine
  let responseText: string
  let conciergeResponse: ConciergeResponse | null = null
  let webSearchUsed = false

  if (resolvedIntent === 'internal') {
    // Internal: Concierge engine (Sonnet + objective state)
    const context = await buildConciergeContext(supabase, user.id)
    const prompt = buildConciergePrompt(question, context)

    try {
      const message = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = message.content[0].type === 'text' ? message.content[0].text : '{}'
      try {
        conciergeResponse = JSON.parse(raw.replace(/```json|```/g, '').trim()) as ConciergeResponse
      } catch {
        conciergeResponse = {
          answer_prose: raw,
          ranked_actions: [],
          log_offer: false,
          signals_to_watch: [],
          needs_sweep: false,
          needs_sweep_reason: null,
        }
      }
      responseText = JSON.stringify(conciergeResponse)
    } catch (aiError) {
      console.error('[ask:internal] Anthropic API error:', aiError)
      return NextResponse.json(
        { error: 'Meridian is temporarily unavailable. Please try again in a moment.' },
        { status: 502 }
      )
    }
  } else {
    // External: Brave Search + Sonnet
    const searchSnippet = await executeBraveSearch(question)
    webSearchUsed = searchSnippet.length > 0

    const objectivesSummary =
      objectiveContext.length > 0
        ? objectiveContext
            .map(o => {
              const deadline = o.target_date ? ` · deadline ${o.target_date}` : ''
              const type = o.objective_type ? ` [${o.objective_type}]` : ''
              return `- ${o.title}${type}${deadline}`
            })
            .join('\n')
        : 'No active objectives on file.'

    const systemPrompt = `You are Meridian Arc, an objective intelligence platform built by Solvega Labs.
Your job is to give the user a specific, grounded, actionable answer to their question.

Guidelines:
- Draw on current web data (provided below when available) and the user's personal objective context.
- Be direct. If you have a clear recommendation, state it plainly. Avoid hedging into vagueness.
- Connect your answer to the user's real objectives where relevant — this is what makes Meridian different from a generic search.
- Keep the response concise and readable. Prose is preferred over bullet-point soup.
- Do not hallucinate sources. If web data wasn't provided, say your answer is based on training knowledge through your cutoff.`

    const contextBlock = [
      webSearchUsed
        ? `## Current web search results\n${searchSnippet}`
        : '## Web search\nNot available for this query — answering from training knowledge.',
      `## User's active objectives\n${objectivesSummary}`,
      `## Question\n${question}`,
    ].join('\n\n---\n\n')

    try {
      const message = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ] satisfies TextBlockParam[],
        messages: [{ role: 'user', content: contextBlock }],
      })
      responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    } catch (aiError) {
      console.error('[ask] Anthropic API error:', aiError)
      return NextResponse.json(
        { error: 'Meridian is temporarily unavailable. Please try again in a moment.' },
        { status: 502 }
      )
    }
  }

  // 10. Log to ask_queries
  const { data: insertedQuery, error: insertError } = await supabase
    .from('ask_queries')
    .insert({
      user_id: user.id,
      question,
      response: responseText,
      objective_context: objectiveContext,
      web_search_used: webSearchUsed,
      credits_used: resolvedIntent === 'internal' ? 2 : 1,
      extraction_status: resolvedIntent === 'internal' ? 'no_match' : 'pending',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[ask] Failed to log query:', insertError.message)
  }

  // 11. Phase A+B extraction — external queries only
  if (resolvedIntent === 'external' && insertedQuery?.id) {
    const queryId = insertedQuery.id
    waitUntil(
      (async () => {
        try {
          const { signals, matchedObjectiveIds: matched } = await extractAskSignals(supabase, {
            userId: user.id,
            askQueryId: queryId,
            question,
            objectiveContext,
          })

          if (signals.length > 0) {
            const { error: signalError } = await supabase.from('signals').insert(signals)
            if (signalError) console.error('[ask:extract-a] signal insert failed:', signalError.message)
          }

          if (matched.length > 0) {
            await extractResponseSignals(supabase, {
              userId: user.id,
              askQueryId: queryId,
              question,
              response: responseText,
              objectiveIds: matched,
            })
          } else {
            await supabase
              .from('ask_queries')
              .update({
                extraction_status: 'no_match',
                extracted_signals: { signals_found: 0, matched_objectives: [] },
              })
              .eq('id', queryId)
          }
        } catch (err) {
          console.error('[ask:extract] extraction failed:', err)
          await supabase
            .from('ask_queries')
            .update({ extraction_status: 'failed' })
            .eq('id', queryId)
        }
      })()
    )
  }

  // 12. Deduct credits
  const creditsToDeduct = resolvedIntent === 'internal' ? 2 : 1
  if (!insertError) {
    if (useAskCredit) {
      const { error: askCreditError } = await supabase
        .from('profiles')
        .update({ ask_credits: Math.max(0, askCredits - creditsToDeduct) })
        .eq('id', user.id)
      if (askCreditError) console.error('[ask] Failed to deduct ask credit:', askCreditError.message)
    } else if (useCredit) {
      const { error: sweepCreditError } = await supabase
        .from('profiles')
        .update({ sweep_credits: Math.max(0, (profile.sweep_credits ?? 1) - 1) })
        .eq('id', user.id)
      if (sweepCreditError) console.error('[ask] Failed to deduct sweep credit:', sweepCreditError.message)
    }
  }

  // 13. Return response
  const askCreditsRemaining = useAskCredit ? Math.max(0, askCredits - creditsToDeduct) : askCredits

  return NextResponse.json({
    response: conciergeResponse ?? responseText,
    intent: resolvedIntent,
    web_search_used: webSearchUsed,
    ask_query_id: insertedQuery?.id ?? null,
    suggested_actions: resolvedIntent === 'external' ? extractActionCandidates(responseText) : [],
    matched_objective_ids: resolvedIntent === 'external' ? matchedObjectiveIds : [],
    usage: {
      used: used + 1,
      limit: baseLimit,
      tier: effectiveTier,
      credits_remaining: askCreditsRemaining,
      ask_credits_remaining: askCreditsRemaining,
    },
  })
}
