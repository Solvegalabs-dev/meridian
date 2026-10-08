// Fishing or hunting (FF-096b). A fishing objective has no hunt number, no hunt unit and no boundary, so the
// header, the Prep tab and the spots panel all ask this one question.
import { isFishingTaxonomyKey } from '@/lib/strike/config/fishing-taxonomy'

export function isFishingObjective(o: { taxonomy_key?: unknown; domain?: unknown } | null | undefined): boolean {
  if (!o) return false
  return o.domain === 'fishing' || (typeof o.taxonomy_key === 'string' && isFishingTaxonomyKey(o.taxonomy_key))
}
