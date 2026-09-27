import type { ConciergeContext } from './buildConciergeContext'

export interface ConciergeResponse {
  answer_prose: string
  ranked_actions: { action: string; rationale: string; priority: number }[]
  log_offer: boolean
  signals_to_watch: string[]
  needs_sweep: boolean
  needs_sweep_reason: string | null
}

export function buildConciergePrompt(question: string, context: ConciergeContext): string {
  return `You are Meridian, an Outcome Intelligence system. You are answering a question from the user about their goals and predictions.
You have access to their current objective state, recent actions, predictions, and intelligence signals.
You do NOT have access to the internet. You reason only from what is provided below.
If the answer requires a live sweep, say so and suggest the user run a sweep.

USER QUESTION: ${question}

CURRENT STATE:
${JSON.stringify(context, null, 2)}

Return ONLY valid JSON, no preamble or markdown fences:
{
  "answer_prose": "2-4 sentence direct answer in plain language",
  "ranked_actions": [
    { "action": "specific action to take", "rationale": "why this helps", "priority": 1 }
  ],
  "log_offer": true,
  "signals_to_watch": ["signal or watch source to monitor"],
  "needs_sweep": false,
  "needs_sweep_reason": null
}`
}
