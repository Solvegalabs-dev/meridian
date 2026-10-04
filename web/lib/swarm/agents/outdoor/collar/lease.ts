// FF-093 Phase 2 — Movebank lease (spec v2 section 5 + amendment A4).
// Movebank allows exactly one concurrent request per IP/account across the
// whole app. movebank_lease is a single-row global lock: whichever worker
// invocation holds it is the only one allowed to call movebankCollarFetch.ts
// functions. A4 adds cooldown_until — after an abort, timeout, 429, or 5xx,
// Movebank keeps the aborted request running server-side and answers the
// very next request with 429, so acquisition is blocked for a cooldown
// window independent of whether the lease itself is free.
import { createServiceClient } from '@/lib/supabase/server';

const LEASE_ROW_ID = 1;

// A4: 65s / 130s / 260s for the 1st/2nd/3rd consecutive 429 on this lease;
// once a 4th happens after the schedule is exhausted, tell the caller to
// requeue the job rather than retry again immediately.
export const BACKOFF_SCHEDULE_SECONDS = [65, 130, 260];

function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// Single atomic UPDATE ... WHERE ... RETURNING via PostgREST — the DB does
// the compare-and-swap, so there's no separate read-then-write race between
// concurrent callers (the lease itself is what that race would be racing
// over, so it can't rely on anything but the one statement). Succeeds only
// if the lease is free (or expired) AND no cooldown is active (or it's
// expired).
export async function acquireLease(holderId: string, ttlSeconds: number): Promise<boolean> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data } = await supabase
    .from('movebank_lease')
    .update({ locked_until: isoIn(ttlSeconds), holder: holderId })
    .eq('id', LEASE_ROW_ID)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .or(`cooldown_until.is.null,cooldown_until.lt.${now}`)
    .select()
    .maybeSingle();

  return !!data;
}

// Only releases a lease this holder actually owns — a worker whose TTL
// already expired (and was reclaimed by someone else) must not clobber the
// new holder's lease out from under them.
export async function releaseLease(holderId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('movebank_lease')
    .update({ locked_until: null, holder: null })
    .eq('id', LEASE_ROW_ID)
    .eq('holder', holderId);
}

// Never shortens an existing, still-active, LATER cooldown — reads the
// current value first so a fast 65s failure right after a 260s backoff
// doesn't accidentally undo it.
export async function setCooldown(seconds: number): Promise<void> {
  const supabase = createServiceClient();
  const { data: current } = await supabase
    .from('movebank_lease')
    .select('cooldown_until')
    .eq('id', LEASE_ROW_ID)
    .maybeSingle();

  const currentUntilMs = current?.cooldown_until ? new Date(current.cooldown_until as string).getTime() : 0;
  const newUntilMs = Date.now() + seconds * 1000;
  if (newUntilMs <= currentUntilMs) return;

  await supabase
    .from('movebank_lease')
    .update({ cooldown_until: new Date(newUntilMs).toISOString() })
    .eq('id', LEASE_ROW_ID);
}

export async function cooldownRemainingMs(): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('movebank_lease')
    .select('cooldown_until')
    .eq('id', LEASE_ROW_ID)
    .maybeSingle();

  if (!data?.cooldown_until) return 0;
  return Math.max(0, new Date(data.cooldown_until as string).getTime() - Date.now());
}

export type MovebankFailureKind = 'abort' | 'timeout' | '429' | '5xx';

// A4 — the one place that turns a Movebank failure into a cooldown. Flat
// 65s for abort/timeout/5xx (and a first 429). Repeated 429s on the SAME
// job escalate 65 -> 130 -> 260s; `consecutive429s` is the caller's own
// running count (0 for the first 429 it's seen for this job). Once that
// count reaches the end of the schedule, `requeue: true` tells the caller
// to stop retrying inline and put the job back in the queue instead.
export async function registerMovebankFailure(
  kind: MovebankFailureKind,
  consecutive429s = 0
): Promise<{ requeue: boolean; cooldownSeconds: number }> {
  if (kind !== '429') {
    const seconds = BACKOFF_SCHEDULE_SECONDS[0];
    await setCooldown(seconds);
    return { requeue: false, cooldownSeconds: seconds };
  }

  // consecutive429s counts prior 429s for this job: 0 -> 1st (65s), 1 -> 2nd
  // (130s), 2 -> 3rd (260s), 3+ -> schedule exhausted, requeue instead of
  // retrying inline again.
  const index = Math.min(consecutive429s, BACKOFF_SCHEDULE_SECONDS.length - 1);
  const seconds = BACKOFF_SCHEDULE_SECONDS[index];
  await setCooldown(seconds);
  return { requeue: consecutive429s >= BACKOFF_SCHEDULE_SECONDS.length, cooldownSeconds: seconds };
}
