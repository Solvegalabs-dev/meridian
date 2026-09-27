import { getAnthropicClient } from '@/lib/anthropic/client'

export type AskIntent = 'external' | 'internal'

const INTERNAL_SIGNALS = [
  'my goal', 'my objective', 'my confidence', 'my prediction', 'my score',
  'what should i do', 'what do i need to do', 'what is blocking', 'how do i get to',
  'what happened with my', 'which goal', 'my week', 'my actions', 'my signals',
  'my progress', 'my results',
]

const EXTERNAL_SIGNALS = [
  'what is happening', 'market', 'news', 'industry', 'rates', 'hiring',
  'latest', 'current', 'today', 'prices', 'economy', 'regulations',
  'what are companies', 'what is the outlook', 'trends',
]

export async function classifyAskIntent(question: string): Promise<AskIntent> {
  const lower = question.toLowerCase()

  if (INTERNAL_SIGNALS.some(s => lower.includes(s))) return 'internal'
  if (EXTERNAL_SIGNALS.some(s => lower.includes(s))) return 'external'

  try {
    const message = await getAnthropicClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Classify this question as internal (about the user's own goals, progress, scores, predictions, or actions in Meridian) or external (about the world, markets, news, industry conditions, or current events). Question: "${question}" Return ONLY one word: internal or external`,
      }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim().toLowerCase() : ''
    if (text === 'external') return 'external'
    return 'internal'
  } catch {
    return 'internal'
  }
}
