import { getAnthropicClient } from '@/lib/anthropic/client'
import type { PredictionArc } from './assemblePredictionArc'

export interface ClosureNarrative {
  outcome_verdict: 'TRUE' | 'FALSE' | 'PARTIAL' | 'SUPERSEDED'
  confidence_calibration: 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT'
  horizon_accuracy: 'ON_TIME' | 'EARLY' | 'LATE' | 'NOT_REACHED'
  key_signal: string
  arc_summary: string
  engine_learning: string
  resolved_at_note: string | null
}

const FALLBACK: ClosureNarrative = {
  outcome_verdict: 'FALSE',
  arc_summary: 'Closure synthesis failed — manual review required',
  key_signal: '',
  engine_learning: '',
  confidence_calibration: 'WELL_CALIBRATED',
  horizon_accuracy: 'ON_TIME',
  resolved_at_note: null,
}

const SYSTEM_PROMPT = `You are the Meridian Arc Prediction Closure Engine. Your job is to write a structured closure narrative for a prediction that has just resolved. You have access to the full prediction arc. Return ONLY a valid JSON object matching the schema. No preamble, no markdown fences, no explanation outside the JSON.

Schema (return exactly these 7 fields):
{
  "outcome_verdict": "TRUE" | "FALSE" | "PARTIAL" | "SUPERSEDED",
  "confidence_calibration": "WELL_CALIBRATED" | "OVERCONFIDENT" | "UNDERCONFIDENT",
  "horizon_accuracy": "ON_TIME" | "EARLY" | "LATE" | "NOT_REACHED",
  "key_signal": "<string — the single most decisive signal in the arc>",
  "arc_summary": "<string — 1-2 sentence plain-English narrative of how this prediction played out>",
  "engine_learning": "<string — what the sweep engine should weight differently next time>",
  "resolved_at_note": "<ISO timestamp string or null>"
}`

function buildUserPrompt(arc: PredictionArc, accuracyScore?: number): string {
  const { prediction, confidence_trajectory, episodes, watch_alerts, outcome, reflections } = arc

  const trajectoryLines = confidence_trajectory
    .map(t => `Score: ${t.score} | Date: ${t.created_at.split('T')[0]}`)
    .join('\n') || 'No trajectory data'

  const episodeLines = episodes
    .map(ep => `Ep ${ep.episode_number}: conf ${ep.confidence_start}→${ep.confidence_end} | ${ep.narrative}`)
    .join('\n') || 'No episodes recorded'

  const alertLines = watch_alerts.length
    ? watch_alerts.map(a =>
        `Level: ${a.alert_level} | Conf: ${a.confidence} | ${a.signal_summary} | Actioned: ${a.user_actioned_at ? 'yes' : 'no'}`
      ).join('\n')
    : 'None'

  const reflectionLines = reflections.length
    ? reflections.map(r =>
        `Week ${r.week_of}: [${r.confidence_flag ?? 'none'}] ${r.reflection ?? '—'}`
      ).join('\n')
    : 'None'

  const outcomeText = outcome
    ? `${outcome.outcome_type} | Recorded: ${outcome.actual_completed_at ?? 'unknown'}`
    : 'No outcome recorded'

  const outcomeNote = outcome?.outcome_note ?? 'None'

  return `PREDICTION: ${prediction.statement}
Filed: ${prediction.created_at.split('T')[0]} | Confidence at filing: ${prediction.confidence_pct}% | Horizon: ${prediction.horizon_date}

CONFIDENCE TRAJECTORY (oldest → newest):
${trajectoryLines}

EPISODE HISTORY (last ${episodes.length} sweeps):
${episodeLines}

WATCH ALERTS (if any):
${alertLines}

OUTCOME: ${outcomeText}
User note: ${outcomeNote}

USER REFLECTIONS (most recent first):
${reflectionLines}
${accuracyScore !== undefined ? `\nAccuracy score already computed: ${accuracyScore}` : ''}
Write the closure narrative for this prediction.`
}

export async function synthesizeClosureNarrative(
  arc: PredictionArc,
  accuracyScore?: number
): Promise<ClosureNarrative> {
  try {
    const client = getAnthropicClient()
    const userPrompt = buildUserPrompt(arc, accuracyScore)

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : ''

    // Strip markdown fences if present
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[engine4:step11] synthesizeClosureNarrative: no JSON found in response', raw.slice(0, 200))
      return FALLBACK
    }

    const parsed = JSON.parse(jsonMatch[0]) as ClosureNarrative
    console.log(`[engine4:step11] synthesizeClosureNarrative verdict=${parsed.outcome_verdict} calibration=${parsed.confidence_calibration}`)
    return parsed
  } catch (err) {
    console.error('[engine4:step11] synthesizeClosureNarrative failed:', err)
    return FALLBACK
  }
}
