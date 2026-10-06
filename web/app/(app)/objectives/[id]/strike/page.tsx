import { notFound as nextNotFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getMipBriefPayload } from '@/lib/mip/briefPayload'
import { requireObjectiveAccess, ObjectiveAccessError } from '@/lib/auth/ownership'
import StrikeBriefView from '@/components/strike/mip/StrikeBriefView'
import { strikeDetailHref } from '@/lib/strike/strikeLinks'

export const dynamic = 'force-dynamic'

export default async function ObjectiveStrikePage({ params }: { params: { id: string } }) {
  // The signed-in user must own the objective. Any other id is a 404, whatever the id is.
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) nextNotFound()

  const supabase = createServiceClient()
  let profileRow: Awaited<ReturnType<typeof requireObjectiveAccess>>
  try {
    profileRow = await requireObjectiveAccess(supabase, user.id, params.id, ['taxonomy_key'])
  } catch (err) {
    if (err instanceof ObjectiveAccessError) nextNotFound()
    throw err
  }

  const arcObjectiveId = (profileRow.objective_id as string | null) ?? params.id

  const { data: obj } = await supabase
    .from('objectives')
    .select('title')
    .eq('id', arcObjectiveId)
    .eq('user_id', user.id)
    .maybeSingle()

  const objectiveTitle = (obj?.title as string | null)
    ?? (profileRow.taxonomy_key as string | null)?.replace(/\./g, ' · ')
    ?? 'Objective'

  // Use the resolved profile PK, so the payload never reads a different row than the one checked above.
  const { payload, notFound: briefNotFound } = await getMipBriefPayload(supabase, profileRow.id)
  if (briefNotFound) nextNotFound()

  return (
    <StrikeBriefView
      objectiveId={params.id}
      objectiveTitle={objectiveTitle}
      initialBrief={payload}
      fullStrikeHref={strikeDetailHref({ profileId: profileRow.id, objectiveId: arcObjectiveId })}
    />
  )
}
