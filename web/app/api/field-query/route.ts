import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { answerFieldQuery } from '@/lib/strikeBrief/fieldQueryEngine';

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as { question?: string; objectiveId?: string; voiceInput?: boolean };
  const { question, objectiveId, voiceInput = false } = body;

  if (!question || !objectiveId) {
    return NextResponse.json({ error: 'question and objectiveId required' }, { status: 400 });
  }

  // Verify ownership
  const { data: obj } = await supabase
    .from('objectives')
    .select('id')
    .eq('id', objectiveId)
    .eq('user_id', user.id)
    .single();

  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Rate limit: 10 field queries per day per user
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('field_queries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', today);

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Daily field query limit reached (10/day)' }, { status: 429 });
  }

  try {
    const result = await answerFieldQuery(question, objectiveId, user.id, voiceInput);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
