// lib/sweep/subAgent/domainDetector.ts
// FF-064 — Sub-Agent Dispatch Layer: domain detection for objective routing.

export type ObjectiveDomain =
  | 'elk_hunt'
  | 'fishing'
  | 'unknown'

export function detectDomain(objective: {
  title: string
  category: string
  notes?: string
  domain?: string  // explicit domain from objective_profiles; wins over keyword detection
}): ObjectiveDomain {
  // If objective_profiles.domain is set, use it directly (FF-088)
  if (objective.domain === 'fishing') return 'fishing'
  if (objective.domain === 'elk_hunt' || objective.domain === 'hunting') return 'elk_hunt'

  const text = `${objective.title} ${objective.category} ${objective.notes || ''}`.toLowerCase()

  const fishingKeywords = ['salmon', 'trout', 'fly fishing', 'fly fish', 'fishing', 'angling']
  if (fishingKeywords.some(kw => text.includes(kw))) return 'fishing'

  const elkKeywords = [
    'elk', 'hunt', 'archery', 'rifle hunt', 'bull', 'unit 10',
    'diamond mountain', 'mule deer', 'deer hunt', 'big game',
  ]
  if (elkKeywords.some(kw => text.includes(kw))) return 'elk_hunt'

  return 'unknown'
}
