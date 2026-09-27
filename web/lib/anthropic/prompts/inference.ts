import type { InferenceBlock, ObjectiveResult } from './output'

export const INFERENCE_SYSTEM_PROMPT = `You are an intelligence analyst generating a structured inference assessment for a single objective. You receive the objective definition, recent signals found during a sweep, and the sweep synthesis for this objective. Your output is a JSON inference_block only — no commentary, no preamble, no explanation outside the JSON structure.

INFERENCE DISCIPLINE RULES:
R-1 — Reason beyond the question. Surface implications the user did not ask for.
R-2 — Specific or silent. Every inference must name a specific thing — a named company, a specific date, a dollar amount, a named risk. Vague observations are not inferences.
R-3 — Synthesis vs. inference separation. Synthesis = what signals say. Inference = what they imply. Never conflate them.
R-4 — Cross-objective flags: if no cross-dependency with another objective exists, return an empty array — do not fabricate.
R-5 — Absence of signal is evidence. Consecutive sweeps with no signal on a topic are themselves a signal. Treat absence data as signal data.
R-6 — The blind spot must be earned. user_blind_spot is the highest-value output. If no genuine blind spot exists, say so explicitly. Fabricated blind spots destroy trust.
R-7 — Focus on this objective only. Cross-objective relationships are surfaced via cross_objective_flags only — do not attempt broader portfolio inference.
R-8 — Condition-gated objectives require gate-monitoring blind spots. If objective notes contain "condition-gated", "gate conditions", or "gated on", do NOT generate blind spots about commitment avoidance or date urgency. Instead generate user_blind_spot about: (1) whether monitoring signals are sufficient to detect when gate conditions are met, (2) whether gate thresholds are specific enough to trigger action, (3) what early indicators could compress or extend the gate timeline.

OUTPUT FORMAT:
Return only valid JSON matching the exact schema below. No markdown. No code fences. Raw JSON only.

{
  "unstated_implications": ["string — 2–5 specific implications signals suggest that were not asked about"],
  "decision_gate": {
    "exists": true,
    "description": "string | null — specific decision + consequence of delay",
    "deadline_days": 14
  },
  "absence_signal": {
    "is_meaningful": false,
    "description": "string | null — what is conspicuously missing and why it matters"
  },
  "confidence_pivot": {
    "upside_trigger": "string — specific named event that would move confidence up",
    "downside_trigger": "string — specific named event that would move confidence down",
    "upside_delta": 8,
    "downside_delta": -12
  },
  "cross_objective_flags": [
    {
      "related_objective": "string — obj_id of the related objective (e.g. OBJ-02)",
      "flag_type": "conflict|dependency|sequence|opportunity",
      "description": "string — why this matters right now"
    }
  ],
  "user_blind_spot": "string — single highest-value insight the user is not thinking about",
  "inference_confidence": "high|medium|low",
  "inference_confidence_rationale": "string — why this confidence level"
}`

interface InferenceObjectiveInput {
  obj_id: string
  title: string
  target_date?: string | null
  context?: Record<string, unknown> | null
  notes?: string | null
}

interface FACSignal {
  signal_category: string
  signal_summary: string
  forward_signal_type: string
  confidence_implication: number | null
}

export function buildInferenceInput(
  objective: InferenceObjectiveInput,
  sweepResult: ObjectiveResult,
  recentChange?: { changed_field: string; changed_at: string } | null,
  facSignals?: FACSignal[]
): string {
  const notesTrunc = objective.notes
    ? objective.notes.length > 1000
      ? objective.notes.slice(0, 1000) + ' [notes truncated]'
      : objective.notes
    : null

  const parts: string[] = [
    `OBJECTIVE: ${objective.title}`,
    `Objective ID: ${objective.obj_id}`,
    `Target: ${objective.target_date ?? 'none'}`,
  ]

  if (objective.context && Object.keys(objective.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(objective.context)}`)
  }
  if (notesTrunc) {
    parts.push(`Notes: ${notesTrunc}`)
  }
  if (recentChange) {
    const daysAgo = Math.round(
      (Date.now() - new Date(recentChange.changed_at).getTime()) / (1000 * 60 * 60 * 24)
    )
    const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
    parts.push(`Recent change: ${recentChange.changed_field} was modified ${when}`)
  }

  parts.push(
    '',
    'SWEEP FINDINGS:',
    `Confidence: ${sweepResult.confidence}%`,
    `Signal quality: ${sweepResult.signal_quality}`,
    `Signal gap: ${sweepResult.signal_gap}`,
    `Rationale: ${sweepResult.confidence_reasoning}`,
    `Recommended actions: ${(sweepResult.actions ?? []).join('; ')}`,
  )

  if ((sweepResult.risks ?? []).length > 0) {
    parts.push(`Risks: ${sweepResult.risks.join('; ')}`)
  }
  if ((sweepResult.opportunities ?? []).length > 0) {
    parts.push(`Opportunities: ${sweepResult.opportunities.join('; ')}`)
  }
  if (sweepResult.changed_since_last_sweep) {
    parts.push(`Changed since last sweep: ${sweepResult.changed_since_last_sweep}`)
  }

  // FF-056: inject FAC forward signals if present
  if (facSignals && facSignals.length > 0) {
    parts.push(
      '',
      '[FORWARD SIGNALS — FAC ENGINE]',
      ...facSignals.map(r =>
        `Signal: ${r.signal_summary}\nType: ${r.forward_signal_type.toUpperCase()} | Confidence implication: ${r.confidence_implication !== null ? (r.confidence_implication > 0 ? '+' : '') + String(r.confidence_implication) + '%' : 'unknown'}`
      )
    )
  }

  parts.push('', 'Generate the inference_block JSON for this objective only.')
  return parts.join('\n')
}

// Re-export InferenceBlock so callers can import from one place
export type { InferenceBlock }
