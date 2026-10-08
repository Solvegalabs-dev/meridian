// Whether a Strike objective belongs to a campaign unit (FF-096). A campaign unit cannot be removed on its own
// yet, so the remove action is hidden for it and the archive route refuses it.
// A campaign unit points at the arc objective id (and, defensively, the profile id).
import type { SupabaseClient } from '@supabase/supabase-js'

export async function isCampaignUnit(db: SupabaseClient, profile: { id: string; objective_id: string | null }): Promise<boolean> {
  const ids = [profile.id, profile.objective_id].filter((v): v is string => !!v)
  const { data, error } = await db.from('campaign_units').select('id').in('objective_id', ids).limit(1)
  if (error) throw new Error('campaign_units lookup failed')
  return (data ?? []).length > 0
}
