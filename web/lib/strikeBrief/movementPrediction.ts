import { getAnthropicClient } from '@/lib/anthropic/client';

export type MovementWindow = {
  time: string;
  probability: number;
  reason: string;
  confidence_tier: 'T1' | 'T2' | 'T3' | 'T4';
};

const FISHING_MOVEMENT_PROMPT = (
  patternMatchYear: number | null,
  signalBrief: string,
  macroEvents: object[]
) => `You are Meridian's feed window prediction engine for the fishing domain.

Generate time-of-day fish feeding activity windows for today. Apply these rules:

FEED WINDOW LOGIC:
- Pre-dawn (0430): night-feeding fish transitioning to daytime holds; surface activity minimal
- First light (0600): surface hatches begin; trout and salmon most active near surface
- Morning (0800): primary hatch window; peak surface feeding for most freshwater species
- Midday (1100): solar warming peaks; dissolved oxygen loss at surface; fish retreat to depth
- Afternoon (1500): water cools slightly; subsurface and riffle feeding resumes
- Evening (1700): evening hatch peak; second major feeding window of day
- Last light (1900): final surface push before dark; fish active in riffles and seams

WATER TEMPERATURE ADJUSTMENT:
- Cold water (<45°F): compress activity to midday warmth window; fish sluggish pre-dawn
- Optimal range (50-68°F): full distribution applies
- Warm water (>72°F): reduce midday probability sharply (<15%); push to early morning and evening only

BAROMETRIC PRESSURE ADJUSTMENT:
- Falling pressure: reduce all feeding probabilities by 10-20%; fish sense pressure drops
- Rising pressure: increase morning and evening windows; fish feed aggressively
- Stable pressure: normal distribution applies

FLOW RATE ADJUSTMENT:
- High flow: fish holding in slower water; feeding windows compress to eddy and seam locations
- Normal flow: full distribution applies

PATTERN MATCH ADJUSTMENT:
${patternMatchYear ? `- Conditions match ${patternMatchYear}. Use that year's run timing and feeding patterns as baseline.` : '- No pattern match — use standard feed window model.'}

SIGNAL BRIEF (current conditions):
${signalBrief}

MACRO EVENTS (recent domain events):
${JSON.stringify(macroEvents.slice(0, 5), null, 2)}

CONFIDENCE TIERS:
- T1: Only when signal brief contains confirmed water temperature and flow data
- T2: When pattern match year provides confirmed feeding activity data
- T3: When feed window model applied without current water confirmation
- T4: When insufficient data — modeled estimate only

Output a JSON array of exactly 7 feed windows. Use bracket extraction — no markdown fencing.
[
  {"time": "0430", "probability": 0.30, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "0600", "probability": 0.82, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "0800", "probability": 0.90, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1100", "probability": 0.25, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1500", "probability": 0.55, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1700", "probability": 0.88, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1900", "probability": 0.72, "reason": "one sentence", "confidence_tier": "T3"}
]`;

const MOVEMENT_PROMPT = (
  domain: string,
  patternMatchYear: number | null,
  signalBrief: string,
  macroEvents: object[]
) => `You are Meridian's movement prediction engine for the ${domain} domain.

Generate time-of-day movement probability windows for today. Apply these rules:

THERMAL LOGIC:
- Pre-dawn (0430): thermals are stable — elk move to water/feed before first light
- First light (0600): peak thermal inversion — highest movement probability of day
- Morning (0800): thermals begin rising — elk transitioning to bedding terrain
- Midday (1100): thermals fully reversed — elk bedded, minimal movement
- Afternoon (1500): thermals begin to fall — elk staging for evening feed
- Evening (1700): thermals dropping to inversion — second peak movement window
- Last light (1900): return to water or bedding — moderate movement

DROUGHT ADJUSTMENT:
- Look for drought indicators in signal brief and macro events
- D2-D3 drought: compress movement to water-source corridors; increase water-adjacent window probabilities by 15-25%
- D0-D1: normal distribution applies

TEMPERATURE ADJUSTMENT:
- High temp signals (>85°F): push movement to first/last light only; depress midday windows to <15%
- Moderate temp: normal distribution

PATTERN MATCH ADJUSTMENT:
${patternMatchYear ? `- Current conditions match ${patternMatchYear}. Use that year's known movement patterns as baseline if applicable.` : '- No pattern match — use standard thermal model.'}

SIGNAL BRIEF (current conditions):
${signalBrief}

MACRO EVENTS (recent domain events):
${JSON.stringify(macroEvents.slice(0, 5), null, 2)}

CONFIDENCE TIERS:
- T1: Only when signal brief contains confirmed weather station data (temp, precip, wind)
- T2: When pattern match year provides confirmed movement data
- T3: When thermal model applied without current weather confirmation
- T4: When insufficient data — modeled estimate only

Output a JSON array of exactly 7 movement windows. Use bracket extraction — no markdown fencing.
[
  {"time": "0430", "probability": 0.82, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "0600", "probability": 0.95, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "0800", "probability": 0.61, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1100", "probability": 0.21, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1500", "probability": 0.28, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1700", "probability": 0.88, "reason": "one sentence", "confidence_tier": "T3"},
  {"time": "1900", "probability": 0.74, "reason": "one sentence", "confidence_tier": "T3"}
]`;

export async function generateMovementWindows(
  domain: string,
  patternMatchYear: number | null,
  signalBrief: string,
  macroEvents: object[]
): Promise<MovementWindow[]> {
  const anthropic = getAnthropicClient();
  console.log('[ff088] domain:', domain, 'using fishing windows:', domain === 'fishing')
  const prompt = domain === 'fishing'
    ? FISHING_MOVEMENT_PROMPT(patternMatchYear, signalBrief, macroEvents)
    : MOVEMENT_PROMPT(domain, patternMatchYear, signalBrief, macroEvents);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: prompt,
    }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) {
    console.error('[MovementPrediction] Failed to extract JSON array from response');
    return [];
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as MovementWindow[];
    return parsed.map(w => ({
      time: String(w.time),
      probability: Math.min(1, Math.max(0, Number(w.probability))),
      reason: String(w.reason),
      confidence_tier: (['T1', 'T2', 'T3', 'T4'].includes(w.confidence_tier) ? w.confidence_tier : 'T4') as MovementWindow['confidence_tier'],
    }));
  } catch {
    console.error('[MovementPrediction] JSON parse failed');
    return [];
  }
}
