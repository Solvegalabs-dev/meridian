// POST /api/strike/join — FF-105. Single-use Strike invite code → new account.
// Friends who have never had a Meridian account join Strike directly: code, then
// email+password, landing on the new-objective form. No onboarding, no Arc tiers.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeInviteEmail } from '@/lib/auth/inviteGate'

export const dynamic = 'force-dynamic'

const INVALID_CODE_MESSAGE = "That invite code isn't valid or has already been used."
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type JoinBody = {
  code?: string
  displayName?: string
  email?: string
  password?: string
  website?: string
}

type ServiceClient = ReturnType<typeof createServiceClient>

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '23505' || (error.message ?? '').toLowerCase().includes('duplicate key')
}

// Atomically claims a strike code: the second update's `eq('status', 'unused')`
// is what actually prevents a double-redemption race — the first select is only
// there to pre-validate cohort/expiry and read the current use_count.
async function claimStrikeCode(service: ServiceClient, code: string): Promise<{ id: string; useCount: number } | null> {
  const { data: invite } = await service
    .from('invite_codes')
    .select('id, status, cohort, expires_at, use_count')
    .eq('code', code)
    .maybeSingle()

  if (!invite) return null
  if (invite.cohort !== 'strike') return null
  if (invite.status !== 'unused') return null
  if (invite.expires_at && new Date(invite.expires_at as string).getTime() <= Date.now()) return null

  const useCount = (invite.use_count as number) ?? 0
  const { data: claimed, error } = await service
    .from('invite_codes')
    .update({ status: 'redeemed', redeemed_at: new Date().toISOString(), use_count: useCount + 1 })
    .eq('id', invite.id as string)
    .eq('status', 'unused')
    .select('id')
    .maybeSingle()

  if (error || !claimed) return null
  return { id: invite.id as string, useCount }
}

async function releaseStrikeCode(service: ServiceClient, codeId: string, originalUseCount: number): Promise<void> {
  const { error } = await service
    .from('invite_codes')
    .update({ status: 'unused', redeemed_at: null, use_count: originalUseCount })
    .eq('id', codeId)
  if (error) console.error('[strike/join] failed to release code', codeId, error.message)
}

export async function POST(request: NextRequest) {
  let body: JoinBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  // Honeypot — bots fill hidden fields, humans don't. Quiet success, no side effects.
  if (body.website) return NextResponse.json({ success: true })

  const code = (body.code ?? '').trim().toUpperCase()
  const displayName = (body.displayName ?? '').trim()
  const email = normalizeInviteEmail(body.email ?? '')
  const password = body.password ?? ''

  if (!code) {
    return NextResponse.json({ error: 'invalid_code', message: INVALID_CODE_MESSAGE }, { status: 400 })
  }
  if (!displayName || displayName.length > 60) {
    return NextResponse.json({ error: 'invalid_display_name' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 400 })
  }

  const service = createServiceClient()

  const claim = await claimStrikeCode(service, code)
  if (!claim) {
    return NextResponse.json({ error: 'invalid_code', message: INVALID_CODE_MESSAGE }, { status: 400 })
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: { signup_source: 'strike' },
  })

  if (createError || !created?.user) {
    await releaseStrikeCode(service, claim.id, claim.useCount)

    const isDuplicate = (createError?.message ?? '').toLowerCase().includes('already registered')
      || (createError?.message ?? '').toLowerCase().includes('already been registered')
      || (createError as { code?: string } | null)?.code === 'email_exists'

    if (isDuplicate) {
      return NextResponse.json(
        { error: 'account_exists', message: 'That email already has an account. Sign in instead.' },
        { status: 409 },
      )
    }

    console.error('[strike/join] createUser failed:', createError?.message)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }

  const userId = created.user.id

  const { error: allowedEmailError } = await service
    .from('allowed_emails')
    .insert({ email, invited_by: `code:${code}` })

  if (allowedEmailError && !isDuplicateKeyError(allowedEmailError)) {
    // The account exists but can't get past the Strike invite gate. The code is
    // already spent — leaving it claimed would mean a silently broken invite.
    console.error('[strike/join] allowed_emails insert failed after user create:', allowedEmailError.message, { userId })
    return NextResponse.json(
      { error: 'access_pending', message: 'Your account was created, but access setup needs a moment — the founder has been notified.' },
      { status: 500 },
    )
  }

  const { error: redeemedByError } = await service
    .from('invite_codes')
    .update({ redeemed_by: userId })
    .eq('id', claim.id)
  if (redeemedByError) {
    console.error('[strike/join] failed to set redeemed_by:', redeemedByError.message)
  }

  return NextResponse.json({ success: true })
}
