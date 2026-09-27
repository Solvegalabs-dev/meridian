// lib/sweep/patternDeviation/patternDeviationEngine.ts
// FF-067 — Orchestrates historical pattern matching for a single objective.
// Scores each historical year against current conditions, persists to pattern_matches,
// and returns a PatternDeviationResult for injection into the coherence package.

import { extractCurrentConditions } from './currentConditionsExtractor'
import { fingerprintHistoricalYear } from './historicalYearFingerprinter'
import { scoreSimilarity, SimilarityResult } from './similarityScorer'
import { getHistoricalOutcome } from './historicalOutcomeLookup'
import { createServiceClient } from '@/lib/supabase/server'
import { SignalBrief } from '@/lib/sweep/subAgent/subAgentExecutor'

export interface PatternDeviationResult {
  domain: string
  currentYear: number
  topMatch: {
    year: number
    score: number
    patternLabel: string
    matchingDimensions: string[]
    deviatingDimensions: string[]
    historicalOutcome: string | null
    outcomeConfidence: number
  } | null
  allMatches: Array<{
    year: number
    score: number
    patternLabel: string
    historicalOutcome: string | null
  }>
  patternSummary: string
}

export async function runPatternDeviationEngine(
  objectiveId: string,
  userId: string,
  domain: string,
  signalBrief: SignalBrief | null,
  geographicScope: { states: string[]; counties: string[] },
  lookbackYears: number = 7
): Promise<PatternDeviationResult | null> {
  if (domain === 'unknown') return null

  console.log(`[FF-067] Running pattern deviation engine for ${domain} — objective ${objectiveId}`)

  const currentYear = new Date().getFullYear()
  const currentConditions = await extractCurrentConditions(domain, signalBrief)
  const supabase = createServiceClient()

  const matches: Array<{
    year: number
    score: number
    result: SimilarityResult
    historicalOutcome: ReturnType<typeof getHistoricalOutcome>
  }> = []

  for (let year = currentYear - lookbackYears; year < currentYear; year++) {
    const historical = await fingerprintHistoricalYear(domain, year)
    const similarity = scoreSimilarity(currentConditions, historical)
    const outcome = getHistoricalOutcome(domain, year)

    matches.push({ year, score: similarity.score, result: similarity, historicalOutcome: outcome })

    await supabase.from('pattern_matches').upsert({
      objective_id: objectiveId,
      user_id: userId,
      domain,
      comparison_year: year,
      similarity_score: similarity.score,
      matching_dimensions: similarity.matchingDimensions,
      deviating_dimensions: similarity.deviatingDimensions,
      historical_outcome: outcome?.summary || null,
      outcome_confidence: outcome?.confidence || 0,
      pattern_label: similarity.patternLabel,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'objective_id,comparison_year,domain' })
  }

  matches.sort((a, b) => b.score - a.score)
  const topMatch = matches[0]
  const topDeviation = matches[matches.length - 1]
  const strongMatches = matches.filter(m => m.score >= 60)

  let patternSummary = ''
  if (topMatch && topMatch.score >= 60) {
    patternSummary = `Current conditions most closely match ${topMatch.year} (${topMatch.score}% similarity). `
    if (topMatch.historicalOutcome) {
      patternSummary += `In ${topMatch.year}: ${topMatch.historicalOutcome.summary.slice(0, 200)}. `
    }
    if (strongMatches.length > 1) {
      patternSummary += `Also similar to: ${strongMatches.slice(1, 3).map(m => `${m.year} (${m.score}%)`).join(', ')}. `
    }
  } else if (topMatch) {
    patternSummary = `Current conditions show weak historical precedent — best match is ${topMatch.year} at only ${topMatch.score}% similarity, suggesting unusual conditions. `
  }

  if (topDeviation && topDeviation.score <= 20) {
    patternSummary += `Most different from ${topDeviation.year} (${topDeviation.score}% similarity) — that year's conditions were significantly more favorable.`
  }

  console.log(`[FF-067] Pattern analysis complete — top match: ${topMatch?.year} at ${topMatch?.score}%`)

  return {
    domain,
    currentYear,
    topMatch: topMatch ? {
      year: topMatch.year,
      score: topMatch.score,
      patternLabel: topMatch.result.patternLabel,
      matchingDimensions: topMatch.result.matchingDimensions,
      deviatingDimensions: topMatch.result.deviatingDimensions,
      historicalOutcome: topMatch.historicalOutcome?.summary || null,
      outcomeConfidence: topMatch.historicalOutcome?.confidence || 0,
    } : null,
    allMatches: matches.map(m => ({
      year: m.year,
      score: m.score,
      patternLabel: m.result.patternLabel,
      historicalOutcome: m.historicalOutcome?.summary || null,
    })),
    patternSummary,
  }
}
