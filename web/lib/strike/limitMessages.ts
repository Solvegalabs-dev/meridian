// Plain-language messages for the Strike-friend objective limit (FF-106 Stage 1), shared between
// the new-objective page's upfront summary and its submit-time refusal message, so both say the
// same thing. Pure, client-safe.
import type { SlotCount } from '@/lib/strike/limits'

export type LimitCategory = 'hunt' | 'fish' | 'total'

// "Hunting 1 of 3 · Fishing 0 of 3", shown above the form while there is still room.
export function slotsSummaryLine(hunt: SlotCount, fish: SlotCount): string {
  return `Hunting ${hunt.used} of ${hunt.max} · Fishing ${fish.used} of ${fish.max}`
}

// Replaces the form entirely once the user is at the total cap.
export function totalLimitMessage(max: number): string {
  return `You're at your limit of ${max} active objectives. Remove or finish one to add another.`
}

// Shown when a create attempt is refused: by category first, then by the shared total.
export function limitReachedMessage(category: LimitCategory, max: number): string {
  if (category === 'hunt') return `You already have ${max} active hunting objectives. Remove or finish one to add another.`
  if (category === 'fish') return `You already have ${max} active fishing objectives. Remove or finish one to add another.`
  return totalLimitMessage(max)
}
