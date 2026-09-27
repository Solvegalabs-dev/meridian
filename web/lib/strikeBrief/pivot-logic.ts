interface ConfidenceSnapshot {
  date: string
  confidence_pct: number
  tier: string
  go_no_go: string
}

interface CampaignUnitWithBrief {
  id: string
  objective_id: string
  role: string
  rank: number
  status: string
  confidence_trajectory: ConfidenceSnapshot[]
  geo?: { unit?: string; state?: string }
}

interface PivotRecommendation {
  should_pivot: boolean
  from_objective_id: string
  to_objective_id: string
  reason: string
  confidence_delta: number
  trigger: 'declining_primary' | 'consecutive_no_go' | 'sharp_drop'
}

export function getLatestConfidence(trajectory: ConfidenceSnapshot[]): number {
  if (!trajectory?.length) return 50
  return trajectory[trajectory.length - 1].confidence_pct
}

export function getWeekAgoConfidence(trajectory: ConfidenceSnapshot[]): number {
  if (!trajectory?.length) return 50
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekAgoStr = weekAgo.toISOString().split('T')[0]
  const old = trajectory.filter(s => s.date <= weekAgoStr)
  return old.length ? old[old.length - 1].confidence_pct : trajectory[0].confidence_pct
}

export function getTrajectoryTrend(trajectory: ConfidenceSnapshot[]): number {
  // Returns pts/week change — negative = declining, positive = rising
  if (trajectory?.length < 2) return 0
  const latest = getLatestConfidence(trajectory)
  const weekAgo = getWeekAgoConfidence(trajectory)
  return latest - weekAgo
}

export function countConsecutiveNoGo(trajectory: ConfidenceSnapshot[]): number {
  if (!trajectory?.length) return 0
  let count = 0
  for (let i = trajectory.length - 1; i >= 0; i--) {
    if (trajectory[i].go_no_go === 'NO-GO') count++
    else break
  }
  return count
}

export function evaluatePivot(
  primary: CampaignUnitWithBrief,
  fallbacks: CampaignUnitWithBrief[]
): PivotRecommendation | null {
  if (!primary || !fallbacks.length) return null

  const primaryLatest = getLatestConfidence(primary.confidence_trajectory)
  const primaryTrend  = getTrajectoryTrend(primary.confidence_trajectory)
  const primaryNoGo   = countConsecutiveNoGo(primary.confidence_trajectory)
  const primaryDrop   = primaryLatest - getWeekAgoConfidence(primary.confidence_trajectory)

  // Sort fallbacks by latest confidence descending
  const ranked = [...fallbacks].sort(
    (a, b) => getLatestConfidence(b.confidence_trajectory) - getLatestConfidence(a.confidence_trajectory)
  )

  for (const fallback of ranked) {
    const fallbackLatest = getLatestConfidence(fallback.confidence_trajectory)
    const fallbackTrend  = getTrajectoryTrend(fallback.confidence_trajectory)

    const decliningPrimary = primaryTrend < -5 && fallbackLatest > primaryLatest + 10 && fallbackTrend >= 0
    const consecutiveNoGo  = primaryNoGo >= 3
    const sharpDrop        = primaryDrop < -20

    if (decliningPrimary || consecutiveNoGo || sharpDrop) {
      let trigger: PivotRecommendation['trigger'] = 'declining_primary'
      let reason = ''

      if (consecutiveNoGo) {
        trigger = 'consecutive_no_go'
        reason = `Primary unit has been NO-GO for ${primaryNoGo} consecutive days. ${fallback.geo?.unit || 'Fallback unit'} is showing stronger conditions at ${fallbackLatest}% confidence.`
      } else if (sharpDrop) {
        trigger = 'sharp_drop'
        reason = `Primary unit confidence dropped ${Math.abs(Math.round(primaryDrop))} points this week. Consider shifting primary focus to ${fallback.geo?.unit || 'fallback unit'}.`
      } else {
        reason = `Primary unit trending down (${Math.round(primaryTrend)} pts/week) while ${fallback.geo?.unit || 'fallback unit'} is trending up. Signal convergence favors the shift.`
      }

      return {
        should_pivot: true,
        from_objective_id: primary.objective_id,
        to_objective_id: fallback.objective_id,
        reason,
        confidence_delta: fallbackLatest - primaryLatest,
        trigger,
      }
    }
  }

  return null
}
