export type VoiceRoute =
  | 'brief'
  | 'action_runner'
  | 'score'
  | 'concierge'
  | 'driving_mode'
  | 'scores'
  | 'new_goal'
  | 'help'
  | 'stop'
  | 'unknown'

const KEYWORD_RULES: Array<{ patterns: string[]; route: VoiceRoute }> = [
  { patterns: ['stop', 'cancel', 'exit', 'close'], route: 'stop' },
  { patterns: ['help', 'what can i say', 'commands'], route: 'help' },
  { patterns: ['driving', 'car mode', "i'm driving", 'drive mode'], route: 'driving_mode' },
  { patterns: ['summary', 'read my week', 'brief', 'weekly', "what's ahead", 'whats ahead'], route: 'brief' },
  { patterns: ['score prediction', 'score my prediction', 'hit', 'miss', 'prediction'], route: 'score' },
  { patterns: ['scores', 'how are my goals', 'read my scores', 'confidence', 'goal scores'], route: 'scores' },
  { patterns: ['new goal', 'create goal', 'add goal', 'create objective', 'new objective'], route: 'new_goal' },
  { patterns: ['ask meridian', 'what do i need', 'how do i', 'why is'], route: 'concierge' },
  { patterns: ['log', 'i did', 'i completed', 'action', 'update my goal', 'taskers', 'update goal'], route: 'action_runner' },
]

const CONCIERGE_PREFIXES = ['ask meridian', 'ask about', 'what do i need', 'how do i', 'why is']

export async function classifyVoiceCommand(
  transcript: string
): Promise<{ route: VoiceRoute; extractedQuery?: string }> {
  const lower = transcript.toLowerCase().trim()

  for (const { patterns, route } of KEYWORD_RULES) {
    if (patterns.some(p => lower.includes(p))) {
      let extractedQuery: string | undefined
      if (route === 'concierge') {
        for (const prefix of CONCIERGE_PREFIXES) {
          const idx = lower.indexOf(prefix)
          if (idx !== -1) {
            const after = transcript.slice(idx + prefix.length).trim()
            extractedQuery = after.length > 0 ? after : transcript
            break
          }
        }
        if (!extractedQuery) extractedQuery = transcript
      }
      return { route, extractedQuery }
    }
  }

  // Haiku fallback via server API route (keeps @anthropic-ai/sdk off the client bundle)
  try {
    const res = await fetch('/api/voice/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    })
    const data = await res.json() as { route: VoiceRoute }
    return { route: data.route ?? 'unknown' }
  } catch {
    return { route: 'unknown' }
  }
}
