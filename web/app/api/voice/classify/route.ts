import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { VoiceRoute } from '@/lib/voice/commandRouter'

export const dynamic = 'force-dynamic'

const VALID_ROUTES: VoiceRoute[] = [
  'brief', 'action_runner', 'score', 'concierge', 'driving_mode',
  'scores', 'new_goal', 'help', 'stop', 'unknown',
]

export async function POST(request: NextRequest) {
  const { transcript } = await request.json() as { transcript: string }
  if (!transcript?.trim()) {
    return NextResponse.json({ route: 'unknown' })
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Classify this voice command into one of these routes: brief, action_runner, score, concierge, driving_mode, scores, new_goal, help, stop, unknown. Command: "${transcript.trim()}" Return ONLY JSON: { "route": "..." }`,
      }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { route: VoiceRoute }
    const route = VALID_ROUTES.includes(parsed.route) ? parsed.route : 'unknown'
    return NextResponse.json({ route })
  } catch {
    return NextResponse.json({ route: 'unknown' })
  }
}
