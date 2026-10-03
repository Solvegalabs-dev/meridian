import { notFound as nextNotFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getMipBriefPayload } from '@/lib/mip/briefPayload'
import StrikeBriefView from '@/components/strike/mip/StrikeBriefView'
import { strikeDetailHref } from '@/lib/strike/strikeLinks'

export const dynamic = 'force-dynamic'

export default async function ObjectiveStrikePage({ params }: { params: { id: string } }) {
  const supabase = createServiceClient()

  // params.id may be an objective_profiles PK or an arc objective_id — resolve both ways
  // Profile PK first, then arc objective_id, matching /strike/[id].
  let { data: profileRow } = await supabase
    .from('objective_profiles')
    .select('id, objective_id, taxonomy_key')
    .eq('id', params.id)
    .maybeSingle()
  if (!profileRow) {
    const { data: byArcId } = await supabase
      .from('objective_profiles')
      .select('id, objective_id, taxonomy_key')
      .eq('objective_id', params.id)
      .maybeSingle()
    profileRow = byArcId
  }

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
      fullStrikeHref={strikeDetailHref({ profileId: (profileRow?.id as string | undefined) ?? null, objectiveId: arcObjectiveId })}
    />
  )
}
