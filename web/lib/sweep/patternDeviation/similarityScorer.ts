// lib/sweep/patternDeviation/similarityScorer.ts
// FF-067 — Compares two condition fingerprints and produces a 0-100 similarity score.
// Unknown dimensions are skipped — missing data does not penalize the score.

import { ConditionFingerprint } from './currentConditionsExtractor'

export interface SimilarityResult {
  score: number
  matchingDimensions: string[]
  deviatingDimensions: string[]
  patternLabel: string
}

const DIMENSION_WEIGHTS: Record<string, number> = {
  droughtLevel: 30,
  populationStatus: 25,
  permitPressure: 20,
  weatherPattern: 15,
  accessConditions: 5,
  economicPressure: 5,
}

export function scoreSimilarity(
  current: ConditionFingerprint,
  historical: ConditionFingerprint
): SimilarityResult {
  let totalWeight = 0
  let matchedWeight = 0
  const matchingDimensions: string[] = []
  const deviatingDimensions: string[] = []

  for (const [dimension, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const currentVal = current[dimension as keyof ConditionFingerprint]
    const historicalVal = historical[dimension as keyof ConditionFingerprint]

    if (currentVal === 'unknown' || historicalVal === 'unknown') continue

    totalWeight += weight

    if (currentVal === historicalVal) {
      matchedWeight += weight
      matchingDimensions.push(`${dimension}: ${currentVal}`)
    } else {
      deviatingDimensions.push(`${dimension}: current=${currentVal}, historical=${historicalVal}`)
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0

  const patternLabel = score >= 80 ? 'strong_match'
    : score >= 60 ? 'moderate_match'
    : score >= 40 ? 'weak_match'
    : 'deviation'

  return { score, matchingDimensions, deviatingDimensions, patternLabel }
}
