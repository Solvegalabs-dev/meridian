// lib/sweep/buildCoherencePackage.ts
// Signal Coherence Layer — assembles per-objective watch source context and
// formats it for injection into Engine 1 (keyword targeting) and Engine 3
// (Sonnet synthesis) sweep prompts.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface WatchSourceEntry {
  url_resolved: string
  url_provided: string
  watch_type: string
  target_signal: string | null
}

export interface Layer7ExternalSignals {
  available: boolean
  domain: string
  keyFindings: string[]
  patternObservation: string
  confidenceTier: string
  rawSummary: string
  queriesRun: number
  executedAt: string
}

export interface Layer8PatternDeviation {
  available: boolean
  topMatchYear: number | null
  topMatchScore: number | null
  patternLabel: string | null
  patternSummary: string
  historicalOutcome: string | null
  outcomeConfidence: number
}

export interface CoherencePackage {
  objectiveId: string
  title: string
  outcome: string | null
  success_condition: string | null
  current_confidence: number | null
  category: string | null
  watchSources: WatchSourceEntry[]
  openActions: string[]
  completedActions: { description: string; actionDate: string }[]
  predictions: { statement: string; confidencePct: number; horizonDate: string | null; status: string }[]
  episodes: { episodeNumber: number; narrative: string | null; createdAt: string }[]
  layer7ExternalSignals: Layer7ExternalSignals
  layer8PatternDeviation: Layer8PatternDeviation
}

export async function buildCoherencePackage(
  supabase: SupabaseClient,
  objectiveId: string,
  signalBrief?: { domain: string; keyFindings: string[]; patternObservation: string; confidenceTier: string; rawSummary: string; queriesRun: number; executedAt: string } | null,
  patternResult?: { topMatch: { year: number; score: number; patternLabel: string; historicalOutcome: string | null; outcomeConfidence: number } | null; patternSummary: string } | null
): Promise<CoherencePackage | null> {
  // Fetch objective + watch sources in parallel
  const [objResult, watchResult] = await Promise.all([
    supabase
      .from('objectives')
      .select('title, outcome, success_condition, confidence, category')
      .eq('id', objectiveId)
      .single(),
    supabase
      .from('watch_sources')
      .select('url_resolved, url_provided, watch_type, target_signal')
      .eq('objective_id', objectiveId)
      .eq('is_active', true)
      .not('url_resolved', 'is', null),
  ])

  const watchSources: WatchSourceEntry[] = (watchResult.data ?? []) as WatchSourceEntry[]

  console.log(`[coherence] objective=${objectiveId} watch_sources_count=${watchSources.length} error=${watchResult.error?.message ?? 'none'}`)

  const obj = objResult.data
  if (!obj) return null

  // Fetch actions, predictions, episodes in parallel
  const [openActionsResult, doneActionsResult, predictionsResult, episodesResult] = await Promise.all([
    supabase
      .from('objective_actions')
      .select('description')
      .eq('objective_id', objectiveId)
      .eq('status', 'open')
      .limit(5),
    supabase
      .from('objective_actions')
      .select('description, action_date')
      .eq('objective_id', objectiveId)
      .eq('status', 'done')
      .order('action_date', { ascending: false })
      .limit(5),
    supabase
      .from('predictions')
      .select('statement, confidence_pct, horizon_date, status')
      .eq('objective_id', objectiveId)
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('objective_episodes')
      .select('episode_number, narrative, created_at')
      .eq('objective_id', objectiveId)
      .order('episode_number', { ascending: false })
      .limit(3),
  ])

  return {
    objectiveId,
    title: (obj.title as string) ?? '',
    outcome: (obj.outcome as string | null) ?? null,
    success_condition: (obj.success_condition as string | null) ?? null,
    current_confidence: (obj.confidence as number | null) ?? null,
    category: (obj.category as string | null) ?? null,
    watchSources,
    openActions: (openActionsResult.data ?? []).map(a => a.description as string).filter(Boolean),
    completedActions: (doneActionsResult.data ?? []).map(a => ({
      description: a.description as string,
      actionDate: a.action_date as string,
    })),
    predictions: (predictionsResult.data ?? []).map(p => ({
      statement: p.statement as string,
      confidencePct: p.confidence_pct as number,
      horizonDate: (p.horizon_date as string | null) ?? null,
      status: p.status as string,
    })),
    episodes: (episodesResult.data ?? []).map(e => ({
      episodeNumber: e.episode_number as number,
      narrative: (e.narrative as string | null) ?? null,
      createdAt: e.created_at as string,
    })),
    layer7ExternalSignals: signalBrief ? {
      available: true,
      domain: signalBrief.domain,
      keyFindings: signalBrief.keyFindings,
      patternObservation: signalBrief.patternObservation,
      confidenceTier: signalBrief.confidenceTier,
      rawSummary: signalBrief.rawSummary,
      queriesRun: signalBrief.queriesRun,
      executedAt: signalBrief.executedAt,
    } : {
      available: false,
      domain: 'none',
      keyFindings: [],
      patternObservation: '',
      confidenceTier: 'T4',
      rawSummary: '',
      queriesRun: 0,
      executedAt: '',
    },
    layer8PatternDeviation: patternResult ? {
      available: true,
      topMatchYear: patternResult.topMatch?.year ?? null,
      topMatchScore: patternResult.topMatch?.score ?? null,
      patternLabel: patternResult.topMatch?.patternLabel ?? null,
      patternSummary: patternResult.patternSummary,
      historicalOutcome: patternResult.topMatch?.historicalOutcome ?? null,
      outcomeConfidence: patternResult.topMatch?.outcomeConfidence ?? 0,
    } : {
      available: false,
      topMatchYear: null,
      topMatchScore: null,
      patternLabel: null,
      patternSummary: '',
      historicalOutcome: null,
      outcomeConfidence: 0,
    },
  }
}

export function formatCoherencePackageForPrompt(pkg: CoherencePackage): string {
  const lines: string[] = []

  lines.push('=== SIGNAL COHERENCE PACKAGE ===')
  lines.push(`OBJECTIVE: ${pkg.title}`)
  if (pkg.success_condition) lines.push(`SUCCESS CONDITION: ${pkg.success_condition}`)
  if (pkg.current_confidence !== null) lines.push(`CURRENT CONFIDENCE: ${pkg.current_confidence}%`)
  if (pkg.outcome) lines.push(`TARGET SIGNAL: ${pkg.outcome}`)
  lines.push('')

  if (pkg.watchSources.length > 0) {
    lines.push('WATCH SOURCES (primary targeting — check these first):')
    for (const ws of pkg.watchSources) {
      lines.push(`  - [${ws.watch_type}] ${ws.url_provided}: ${ws.url_resolved}`)
      if (ws.target_signal) lines.push(`    Looking for: ${ws.target_signal}`)
    }
    lines.push('')
  }

  if (pkg.predictions.length > 0) {
    lines.push('PREDICTION TRAJECTORY:')
    for (const p of pkg.predictions) {
      const horizon = p.horizonDate ? ` | Horizon: ${p.horizonDate}` : ''
      lines.push(`  - ${p.statement} | Confidence: ${p.confidencePct}%${horizon} | Status: ${p.status}`)
    }
    lines.push('')
  }

  if (pkg.openActions.length > 0) {
    lines.push('OPEN ACTIONS:')
    for (const a of pkg.openActions) lines.push(`  - ${a}`)
    lines.push('')
  }

  if (pkg.completedActions.length > 0) {
    lines.push('COMPLETED ACTIONS (recent):')
    for (const a of pkg.completedActions) {
      lines.push(`  - ${a.description} (completed ${a.actionDate})`)
    }
    lines.push('')
  }

  if (pkg.episodes.length > 0) {
    lines.push('EPISODE HISTORY (recent):')
    for (const e of pkg.episodes) {
      const summary = e.narrative ? e.narrative.slice(0, 300) : 'No narrative'
      lines.push(`  Episode ${e.episodeNumber} (${e.createdAt.split('T')[0]}): ${summary}`)
    }
    lines.push('')
  }

  const l7 = pkg.layer7ExternalSignals
  if (l7?.available) {
    lines.push('=== LAYER 7: EXTERNAL SIGNAL BRIEF ===')
    lines.push(`Domain: ${l7.domain}`)
    lines.push(`Queries executed: ${l7.queriesRun}`)
    lines.push(`Confidence tier: ${l7.confidenceTier}`)
    lines.push('')
    lines.push('Key findings from external world:')
    l7.keyFindings.forEach((f, i) => lines.push(`${i + 1}. ${f}`))
    lines.push('')
    lines.push(`Pattern observation: ${l7.patternObservation}`)
    lines.push('')
    lines.push(`Full external signal summary: ${l7.rawSummary}`)
    lines.push('')
    lines.push('INTELLIGENCE INTEGRITY STANDARD:')
    lines.push('- T1 findings (government/agency structured data) → state as confirmed fact with source')
    lines.push('- T2 findings (verified field observation) → state with high confidence, cite source')
    lines.push('- T3 findings (reported/anecdotal) → flag as unverified lead')
    lines.push('- T4 findings (modeled/inferred) → state as pattern inference, field verification required')
    lines.push('- NEVER state a location as confirmed without T1 or T2 source')
    lines.push('=== END LAYER 7 ===')
    lines.push('')
  } else {
    lines.push('=== LAYER 7: EXTERNAL SIGNAL BRIEF ===')
    lines.push('No external signals available for this objective domain.')
    lines.push('=== END LAYER 7 ===')
    lines.push('')
  }

  const l8 = pkg.layer8PatternDeviation
  if (l8?.available) {
    lines.push('=== LAYER 8: HISTORICAL PATTERN MATCH ===')
    lines.push(`Top historical match: ${l8.topMatchYear} (${l8.topMatchScore}% similarity)`)
    lines.push(`Pattern label: ${l8.patternLabel}`)
    lines.push(`Pattern summary: ${l8.patternSummary}`)
    lines.push(`Historical outcome: ${l8.historicalOutcome || 'No outcome data available'}`)
    lines.push(`Outcome confidence: ${l8.outcomeConfidence}%`)
    lines.push('')
    lines.push('INTELLIGENCE DIRECTIVE: When Layer 8 shows a strong match (≥60%) with a known historical outcome, lead the synthesis with the pattern match and its implications. State explicitly: "Current conditions match [YEAR] at [SCORE]% similarity. In [YEAR], [outcome]." This is the highest-value intelligence signal available.')
    lines.push('=== END LAYER 8 ===')
    lines.push('')
  } else {
    lines.push('=== LAYER 8: HISTORICAL PATTERN MATCH ===')
    lines.push('No historical pattern data available for this domain.')
    lines.push('=== END LAYER 8 ===')
    lines.push('')
  }

  lines.push('=== END COHERENCE PACKAGE ===')
  return lines.join('\n')
}
