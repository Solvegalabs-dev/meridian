// lib/sweep/subAgent/sources/duckduckgo.ts
// FF-064 Search Router — DuckDuckGo Instant Answer API. Free, no key, no rate limit.
// Best for named entity lookups and factual instant answers, not full SERP.

export async function fetchDuckDuckGo(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)

  try {
    const resp = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!resp.ok) return ''

    const data = await resp.json()
    if (data.Abstract) return data.Abstract as string

    const topics: string[] = ((data.RelatedTopics ?? []) as Array<{ Text?: string }>)
      .slice(0, 3)
      .map(t => t.Text ?? '')
      .filter(Boolean)

    return topics.join(' ')
  } catch {
    clearTimeout(timer)
    return ''
  }
}
