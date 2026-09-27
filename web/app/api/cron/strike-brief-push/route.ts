import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generateStrikeBrief } from '@/lib/strikeBrief/strikeBriefGenerator';

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Resolve active Strike objectives from objective_profiles.
  // User_id comes from objective_profiles (correct); the objectives table row had
  // a stale founder user_id that caused briefs to be written under the wrong account.
  const { data: profiles } = await supabase
    .from('objective_profiles')
    .select('objective_id, user_id')
    .eq('org_source', 'strike')
    .eq('status', 'active')
    .not('objective_id', 'is', null);

  if (!profiles || profiles.length === 0) {
    console.log('[StrikeBriefPush] No active Strike objective_profiles found');
    return NextResponse.json({ generated: 0 });
  }

  const results: { objectiveId: string; result: 'generated' | 'error'; error?: string }[] = [];

  for (const p of profiles) {
    const objectiveId = p.objective_id as string;
    const userId = p.user_id as string;
    try {
      await generateStrikeBrief(objectiveId, userId);
      results.push({ objectiveId, result: 'generated' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[StrikeBriefPush] Failed for ${objectiveId}:`, msg);
      results.push({ objectiveId, result: 'error', error: msg });
    }
  }

  const generated = results.filter(r => r.result === 'generated').length;
  const errors = results.filter(r => r.result === 'error').length;

  console.log(`[StrikeBriefPush] ${results.length} objectives processed · ${generated} generated · ${errors} errors`);

  return NextResponse.json({ processed: results.length, generated, errors, results });
}
