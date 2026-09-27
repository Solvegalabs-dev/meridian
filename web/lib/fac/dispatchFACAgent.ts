// lib/fac/dispatchFACAgent.ts

import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase/server';
import { mapSignalCategories, ObjectiveContext } from './signalCategoryMapper';

export interface FACReport {
  signal_category: string;
  signal_summary: string;
  forward_signal_type: 'risk' | 'opportunity' | 'condition_change';
  confidence_implication: number;
  source_url?: string;
}

export interface FACDispatchInput {
  objective_id?: string;
  enterprise_objective_id?: string;
  org_source: string;
  title: string;
  description?: string;
  current_confidence: number;
  success_condition?: string;
  vertical: 'arc' | 'auto_finance' | 'real_estate' | 'credit_union';
  open_predictions: Array<{
    statement: string;
    confidence: number;
    horizon: string;
  }>;
  sweep_run_id?: string;
  last_fac_dispatch_at?: string | null;
  last_user_action_at?: string | null;
}

function daysBetween(isoDate: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24))
}

export async function dispatchFACAgent(input: FACDispatchInput): Promise<FACReport[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Service client: fac_reports has no INSERT policy — only service role can write
  const supabase = createServiceClient();

  const nearestHorizon = input.open_predictions
    .map(p => new Date(p.horizon).getTime())
    .sort((a, b) => a - b)[0];
  const horizonDays = nearestHorizon
    ? Math.ceil((nearestHorizon - Date.now()) / (1000 * 60 * 60 * 24))
    : Infinity;

  if (horizonDays > 90) {
    return [];
  }

  const now = Date.now()

  // FF-061 Rule A — Activity gate: no user action in 5+ days → skip dispatch
  const daysSinceAction = input.last_user_action_at
    ? daysBetween(input.last_user_action_at, now)
    : 999
  if (daysSinceAction > 5) return []

  // FF-061 Rule B — Cadence gate: FAC ran within 3 days → return cached rows
  const daysSinceLastFAC = input.last_fac_dispatch_at
    ? daysBetween(input.last_fac_dispatch_at, now)
    : 999
  if (daysSinceLastFAC < 3 && input.objective_id) {
    const { data: cached } = await supabase
      .from('fac_reports')
      .select('signal_category, signal_summary, forward_signal_type, confidence_implication, source_url')
      .eq('objective_id', input.objective_id)
      .gte('created_at', new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10)
    return (cached ?? []).map(r => ({
      signal_category: r.signal_category as string,
      signal_summary: r.signal_summary as string,
      forward_signal_type: r.forward_signal_type as FACReport['forward_signal_type'],
      confidence_implication: r.confidence_implication as number,
      source_url: (r.source_url as string | null) ?? undefined,
    }))
  }

  const ctx: ObjectiveContext = {
    title: input.title,
    description: input.description,
    vertical: input.vertical,
  };
  const signalCategories = mapSignalCategories(ctx);

  if (signalCategories.length === 0) return [];

  const predictionsBlock = input.open_predictions.length > 0
    ? input.open_predictions.map(p =>
        `- "${p.statement}" — ${p.confidence}% confidence, horizon: ${p.horizon}`
      ).join('\n')
    : 'No open predictions.';

  const categoriesBlock = signalCategories.map(sc =>
    `Category: ${sc.category}\nSearch for: ${sc.searchTerms.join(', ')}\nWhy it matters: ${sc.rationale}`
  ).join('\n\n');

  const prompt = `You are a Forward Air Controller (FAC) signal agent for the Meridian Arc Outcome Intelligence platform. Your job is to gather forward-looking intelligence on an objective BEFORE the user knows to look for it. You are the "look around the corner" layer.

OBJECTIVE: ${input.title}
${input.description ? `DESCRIPTION: ${input.description}` : ''}
${input.success_condition ? `SUCCESS CONDITION: ${input.success_condition}` : ''}
CURRENT CONFIDENCE: ${input.current_confidence}%
DAYS UNTIL NEAREST PREDICTION HORIZON: ${horizonDays}

OPEN PREDICTIONS:
${predictionsBlock}

YOUR MISSION: Search for and report forward-looking signals in the following categories. For each category, find signals that could materially affect the outcome confidence within the next ${Math.min(horizonDays, 60)} days. Focus on signals the user would NOT have found through normal news consumption — leading indicators, early data, government reports, industry-specific sources.

SIGNAL CATEGORIES TO INVESTIGATE:
${categoriesBlock}

RESPONSE FORMAT — respond ONLY with a valid JSON array, no other text, no markdown fences:
[
  {
    "signal_category": "category_name_from_above",
    "signal_summary": "Plain English summary of the signal and why it matters for this objective. 2-3 sentences max. Be specific — name dates, percentages, sources.",
    "forward_signal_type": "risk",
    "confidence_implication": -15,
    "source_url": "https://... or null"
  }
]

Return only signals with material relevance (confidence_implication > 5 or < -5). If no material signals found for a category, omit it. Return an empty array [] if nothing material was found.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    let reports: FACReport[] = [];
    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      reports = JSON.parse(cleaned);
      if (!Array.isArray(reports)) reports = [];
    } catch {
      console.error('[FAC] Failed to parse Haiku response:', text);
      return [];
    }

    if (reports.length > 0) {
      const rows = reports.map(r => ({
        objective_id: input.objective_id ?? null,
        enterprise_objective_id: input.enterprise_objective_id ?? null,
        org_source: input.org_source,
        sweep_run_id: input.sweep_run_id ?? null,
        dispatch_reason: horizonDays <= 30 ? 'horizon_proximity' : 'confidence_shift',
        signal_category: r.signal_category,
        signal_summary: r.signal_summary,
        forward_signal_type: r.forward_signal_type,
        confidence_implication: r.confidence_implication ?? null,
        source_url: r.source_url ?? null,
      }));

      const { error } = await supabase.from('fac_reports').insert(rows);
      if (error) console.error('[FAC] Insert error:', error);
    }

    // FF-061: stamp dispatch time so the cadence gate works on the next sweep
    if (input.objective_id) {
      await supabase.from('objectives')
        .update({ last_fac_dispatch_at: new Date().toISOString() })
        .eq('id', input.objective_id)
    }

    return reports;
  } catch (err) {
    console.error('[FAC] Dispatch error:', err);
    return [];
  }
}
