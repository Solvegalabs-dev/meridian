import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EnterprisePortalClient from './EnterprisePortalClient'
import { getVerticalConfig } from '@/lib/vertical/getVerticalConfig'

export const metadata = { title: 'Enterprise Portal — Meridian Arc' }

export default async function EnterprisePage({
  searchParams,
}: {
  searchParams?: { iid?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const paramIid = searchParams?.iid as string | undefined

  // Fetch all memberships once — used for both switcher list and fallback resolution
  const { data: allMembers } = await supabase
    .from('enterprise_members')
    .select('institution_id')
    .eq('user_id', user.id)
    .order('invited_at', { ascending: true })

  const memberIds = (allMembers ?? []).map(m => m.institution_id as string)

  let institutionId: string | null = null

  if (paramIid && memberIds.includes(paramIid)) {
    institutionId = paramIid
  }

  if (!institutionId) {
    institutionId = memberIds[0] ?? null
  }

  const resolvedInstitutionId = institutionId ?? 'a1b2c3d4-0000-0000-0000-000000000001'

  // Ensure the URL always has an explicit iid so the switcher label and server
  // data always agree (switcher sorts alphabetically; server sorts by invited_at)
  if (!paramIid) {
    redirect(`/enterprise?iid=${resolvedInstitutionId}`)
  }

  // Fetch all institution rows for the switcher (and current name/logo)
  let institutions: Array<{ id: string; name: string }> = []
  let institutionName = 'Unknown Institution'
  let logoUrl: string | null = null

  if (memberIds.length > 0) {
    const { data: instRows } = await supabase
      .from('enterprise_institutions')
      .select('id, name, logo_url')
      .in('id', memberIds)
      .order('name', { ascending: true })

    institutions = (instRows ?? []).map(r => ({ id: r.id as string, name: r.name as string }))

    const current = (instRows ?? []).find(r => r.id === resolvedInstitutionId)
    institutionName = (current?.name as string) ?? 'Unknown Institution'
    logoUrl = (current?.logo_url as string | null) ?? null
  }

  const verticalConfig = await getVerticalConfig(resolvedInstitutionId)
  const verticalType = verticalConfig?.vertical_type ?? 'auto_finance'

  return (
    <Suspense>
      <EnterprisePortalClient
        institutionId={resolvedInstitutionId}
        institutionName={institutionName}
        logoUrl={logoUrl}
        institutions={institutions}
        verticalType={verticalType}
      />
    </Suspense>
  )
}
