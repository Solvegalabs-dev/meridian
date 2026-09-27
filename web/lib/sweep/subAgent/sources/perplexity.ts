// lib/sweep/subAgent/sources/perplexity.ts
// FF-064 Search Router — Perplexity Sonar Small integration for current-conditions synthesis.

export async function fetchPerplexity(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    console.warn('[perplexity] PERPLEXITY_API_KEY not set — skipping')
    return ''
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const resp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar-small-online',
        messages: [
          {
            role: 'system',
            content:
              'You are a domain intelligence analyst. Return a concise 2-3 sentence current-state summary with source citations. Focus on factual, verifiable conditions. Do not speculate.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)
    if (!resp.ok) return ''
    const data = await resp.json()
    return (data.choices?.[0]?.message?.content as string) ?? ''
  } catch {
    clearTimeout(timer)
    return ''
  }
}
