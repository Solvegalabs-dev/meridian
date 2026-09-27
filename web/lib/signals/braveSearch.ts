// lib/signals/braveSearch.ts
// Shared Brave Search utility — extracted from app/api/ask/route.ts so the
// sub-agent executor can reuse it without duplicating the implementation.

export async function executeBraveSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) {
    console.warn('[braveSearch] BRAVE_SEARCH_API_KEY is not set — skipping search')
    return ''
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false`

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!resp.ok) return ''

    const data = await resp.json()
    const results: Array<{ title: string; url: string; description?: string }> =
      data.web?.results ?? []

    return results
      .slice(0, 5)
      .map(r => `[${r.title}](${r.url})\n${r.description ?? '(no snippet)'}`)
      .join('\n\n')
  } catch {
    return ''
  }
}
