import { notFound as nextNotFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getMipBriefPayload } from '@/lib/mip/briefPayload'
import StrikeBriefView from '@/components/strike/mip/StrikeBriefView'

export const dynamic = 'force-dynamic'

export default async function ObjectiveStrikePage({ params }: { params: { id: string } }) {
  const supabase = createServiceClient()

  // params.id may be an objective_profiles PK or an arc objective_id — resolve both ways
  const { data: profileRow } = await supabase
    .from('objective_profiles')
    .select('objective_id, taxonomy_key')
    .eq('id', params.id)
    .maybeSingle()

  const arcObjectiveId = (profileRow?.objective_id as string | null) ?? params.id

  const { data: obj } = await supabase
    .from('objectives')
    .select('title')
    .eq('id', arcObjectiveId)
    .maybeSingle()

  const objectiveTitle = (obj?.title as string | null)
    ?? (profileRow?.taxonomy_key as string | null)?.replace(/\./g, ' · ')
    ?? 'Objective'

  const { payload, notFound: briefNotFound } = await getMipBriefPayload(supabase, params.id)
  if (briefNotFound) nextNotFound()

  return (
    <StrikeBriefView
      objectiveId={params.id}
      objectiveTitle={objectiveTitle}
      initialBrief={payload}
    />
  )
}
