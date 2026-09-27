import Anthropic from '@anthropic-ai/sdk'
import nlp from 'compromise'
import * as chrono from 'chrono-node'
import type { VoiceIntent } from './actionRunnerTypes'

const FILLERS = ['um', 'uh', 'you know', 'like', 'basically', 'literally', 'actually', 'just', 'sort of', 'kind of']

export function cleanTranscript(text: string): string {
  // compromise import validates the text is parseable
  nlp(text)
  let cleaned = text.toLowerCase()
  FILLERS.forEach(f => {
    cleaned = cleaned.replace(new RegExp(`\\b${f}\\b`, 'gi'), '')
  })
  return cleaned.replace(/\s+/g, ' ').trim()
}

export function parseDate(text: string): string | null {
  const results = chrono.parse(text, new Date(), { forwardDate: true })
  if (results.length === 0) return null
  return results[0].start.date().toISOString().split('T')[0]
}

export async function parseVoiceIntent(
  cleanedText: string,
  resolvedDate: string | null,
  context: { tasker_type: string; objective_title: string; prediction_title?: string }
): Promise<VoiceIntent> {
  const client = new Anthropic()
  const prompt = `You are parsing a voice transcription from a Meridian user performing a ${context.tasker_type} on objective "${context.objective_title}".${context.prediction_title ? ` Prediction: "${context.prediction_title}".` : ''}
Cleaned transcript: "${cleanedText}"
Resolved date: ${resolvedDate ?? 'not mentioned'}
Return ONLY valid JSON, no preamble:
{
  "action_type": "task_completed|decision_made|contact|milestone|observation|hit|miss|null",
  "note": "cleaned note with filler removed",
  "date": "YYYY-MM-DD or null",
  "confidence": 0.0-1.0,
  "clarifying_question": "one short question if confidence < 0.8 on any field, else null"
}`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim()) as VoiceIntent
  } catch {
    return {
      action_type: null,
      note: cleanedText,
      date: resolvedDate,
      confidence: 0.5,
      clarifying_question: "Can you rephrase what happened?",
    }
  }
}
