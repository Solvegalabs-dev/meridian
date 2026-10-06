// Partner API key door (FF-092 Part 3). A partner sends "Authorization: Bearer <key>".
// The key decides the partner. Nothing in the body or the query string can change that.
// Keys are stored as SHA-256 hex. The raw key and its hash are never logged or returned.
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

export type PartnerContext = {
  partnerId: string
  slug: string
  ownerUserId: string | null
  rateLimitPerMin: number
}

const MIN_KEY_LENGTH = 32
const MAX_KEY_LENGTH = 256

export function hashPartnerKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

// True when the request carries an Authorization header. Such a request takes the partner path
// and must authenticate there, even if a session cookie is also present.
export function isPartnerRequest(request: Request): boolean {
  return request.headers.get('authorization') !== null
}

// Returns the partner for a valid, non-revoked key whose partner is active. Otherwise null.
export async function authenticatePartner(request: Request): Promise<PartnerContext | null> {
  const header = (request.headers.get('authorization') ?? '').trim()
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) return null

  const key = match[1]
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return null

  const db = createServiceClient()
  const { data: keyRow } = await db
    .from('partner_api_keys')
    .select('id, partner_id, revoked_at')
    .eq('key_hash', hashPartnerKey(key))
    .maybeSingle()
  if (!keyRow || keyRow.revoked_at) return null

  const { data: partner } = await db
    .from('partners')
    .select('id, slug, status, owner_user_id, rate_limit_per_min')
    .eq('id', keyRow.partner_id)
    .maybeSingle()
  if (!partner || partner.status !== 'active') return null

  touchKey(db, keyRow.id as string)

  return {
    partnerId: partner.id as string,
    slug: partner.slug as string,
    ownerUserId: (partner.owner_user_id as string | null) ?? null,
    rateLimitPerMin: (partner.rate_limit_per_min as number) ?? 60,
  }
}

// Fire and forget. A failed timestamp must never fail a request.
function touchKey(db: ReturnType<typeof createServiceClient>, keyId: string): void {
  try {
    db.from('partner_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId)
      .then(undefined, () => {})
  } catch {
    // ignored by design
  }
}
