import { NextResponse } from 'next/server';
import { acquireLease, releaseLease, cooldownRemainingMs } from '@/lib/swarm/agents/outdoor/collar/lease';
import { refreshCatalog } from '@/lib/swarm/agents/outdoor/collar/catalog';

// FF-093 Phase 2 batch 1 — weekly study-catalog refresh. NOT added to
// vercel.json in this batch; Jason triggers it by hand on the preview.
// Bearer CRON_SECRET, same pattern as the other cron routes.
export const maxDuration = 300;

const HOLDER_ID = 'movebank-catalog-cron';
const LEASE_TTL_SECONDS = 280;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cooldownMs = await cooldownRemainingMs();
  if (cooldownMs > 0) {
    return NextResponse.json({ skipped: true, reason: 'cooldown active', cooldown_remaining_ms: cooldownMs });
  }

  const acquired = await acquireLease(HOLDER_ID, LEASE_TTL_SECONDS);
  if (!acquired) {
    return NextResponse.json({ skipped: true, reason: 'lease held by another worker' });
  }

  try {
    const result = await refreshCatalog();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Error messages from movebankCollarFetch.ts never include credentials.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown error' }, { status: 502 });
  } finally {
    await releaseLease(HOLDER_ID);
  }
}
