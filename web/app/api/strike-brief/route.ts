import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateStrikeBrief } from '@/lib/strikeBrief/strikeBriefGenerator';

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const objectiveId = searchParams.get('objectiveId');
  if (!objectiveId) return NextResponse.json({ error: 'objectiveId required' }, { status: 400 });

  // Verify the objective belongs to this user
  const { data: obj } = await supabase
    .from('objectives')
    .select('id')
    .eq('id', objectiveId)
    .eq('user_id', user.id)
    .single();

  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const brief = await generateStrikeBrief(objectiveId, user.id);
    return NextResponse.json(brief);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
