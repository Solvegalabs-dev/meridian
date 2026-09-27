import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PredictionsClient from './PredictionsClient'
import { getUserTrackRecord } from '@/lib/predictions/trackRecord'

export const dynamic = 'force-dynamic'

export default async function PredictionsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: predictions }, { data: objectives }, trackRecord] = await Promise.all([
    supabase
      .from('predictions')
      .select('*, objectives(obj_id, title), prediction_scores(accuracy_score, actual_outcome, scored_at)')
      .eq('user_id', user.id)
      .order('horizon_date', { ascending: true }),
    supabase
      .from('objectives')
      .select('id, obj_id, title')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('sort_order'),
    getUserTrackRecord(user.id),
  ])

  return (
    <PredictionsClient
      initialPredictions={predictions ?? []}
      objectives={objectives ?? []}
      trackRecord={trackRecord}
    />
  )
}
