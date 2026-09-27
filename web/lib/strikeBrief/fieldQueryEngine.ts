import { createServiceClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/anthropic/client';

export type FieldQueryResponse = {
  answer: string;
  confidence_tier: 'T1' | 'T2' | 'T3' | 'T4';
  context_used: {
    domain_profile: boolean;
    pattern_matches: boolean;
    strike_brief: boolean;
    macro_events: boolean;
  };
};

export async function answerFieldQuery(
  question: string,
  objectiveId: string,
  userId: string,
  voiceInput = false
): Promise<FieldQueryResponse> {
  const supabase = createServiceClient();
  const today = new Date().toISOString().split('T')[0];

  // Assemble field context from 4 sources in parallel
  const [
    { data: profile },
    { data: patterns },
    { data: brief },
    { data: macroEvents },
  ] = await Promise.all([
    supabase
      .from('domain_profiles')
      .select('domain, signal_taxonomy, named_entities, geographic_scope')
      .eq('objective_id', objectiveId)
      .maybeSingle(),
    supabase
      .from('pattern_matches')
      .select('comparison_year, similarity_score, pattern_label, historical_outcome, outcome_confidence')
      .eq('objective_id', objectiveId)
      .order('similarity_score', { ascending: false })
      .limit(3),
    supabase
      .from('strike_briefs')
      .select('time_window, synthesis, lead_signal, go_no_go, condition_delta, confidence_tier')
      .eq('objective_id', objectiveId)
      .eq('brief_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('enterprise_macro_events')
      .select('event_date, event_name, description, direction, magnitude')
      .like('source_series_id', 'ELK_HUNT:%')
      .order('event_date', { ascending: false })
      .limit(5),
  ]);

  const contextUsed = {
    domain_profile: !!profile,
    pattern_matches: (patterns?.length ?? 0) > 0,
    strike_brief: !!brief,
    macro_events: (macroEvents?.length ?? 0) > 0,
  };

  const prompt = `You are Meridian's CyberScout — a field intelligence assistant locked to in-field domain context.
You answer one specific field question using only the intelligence assembled below.

FIELD QUESTION: ${question}

DOMAIN PROFILE:
${profile ? JSON.stringify({ domain: profile.domain, signal_taxonomy: profile.signal_taxonomy, named_entities: profile.named_entities, geographic_scope: profile.geographic_scope }, null, 2) : 'No domain profile available.'}

TOP PATTERN MATCHES:
${patterns && patterns.length > 0 ? JSON.stringify(patterns, null, 2) : 'No pattern matches on record.'}

TODAY'S STRIKE BRIEF:
${brief ? JSON.stringify(brief, null, 2) : 'No strike brief generated yet today.'}

RECENT DOMAIN EVENTS:
${macroEvents && macroEvents.length > 0 ? JSON.stringify(macroEvents, null, 2) : 'No recent domain events.'}

INTELLIGENCE INTEGRITY STANDARD:
- T1: Answer derived from confirmed government/agency data in the context above — state as fact
- T2: Answer derived from pattern match with confirmed historical outcome — state as reported
- T3: Answer derived from anecdotal/modeled data in context — qualify explicitly
- T4: Insufficient context to answer with confidence — state what you don't know

RULES:
- Answer the specific field question in one paragraph maximum
- Apply the integrity standard — every factual claim must be tiered
- If the answer requires information not present in the assembled context, say so explicitly — do not speculate
- End your answer with the confidence tier of the overall response (T1/T2/T3/T4)
- Voice input: ${voiceInput ? 'yes — keep answer under 60 words for TTS' : 'no — normal length'}

Output JSON only:
{
  "answer": "one paragraph answer ending with confidence tier",
  "confidence_tier": "T1|T2|T3|T4"
}`;

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  let answer = raw;
  let tier: FieldQueryResponse['confidence_tier'] = 'T4';

  if (start !== -1 && end !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as { answer?: string; confidence_tier?: string };
      answer = parsed.answer ?? raw;
      tier = (['T1', 'T2', 'T3', 'T4'].includes(parsed.confidence_tier ?? '') ? parsed.confidence_tier : 'T4') as FieldQueryResponse['confidence_tier'];
    } catch {
      // use raw text fallback
    }
  }

  // Write to field_queries log
  await supabase.from('field_queries').insert({
    objective_id: objectiveId,
    user_id: userId,
    question,
    answer,
    context_used: contextUsed,
    confidence_tier: tier,
    voice_input: voiceInput,
  });

  return { answer, confidence_tier: tier, context_used: contextUsed };
}
