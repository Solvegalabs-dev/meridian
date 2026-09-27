'use client'

import { useState, useEffect } from 'react'

const CACHE_KEY = (id: string) => `strike_cache_${id}`

type CachedBrief = {
  summary: string
  time_windows: unknown[]
  map_pins: unknown[]
  confidence_tier: string
  confidence_pct: number
  go_no_go: string
  brief_date: string
  cached_at: string
}

export function useStrikeCache(objectiveId: string) {
  const [cachedBrief, setCachedBrief] = useState<CachedBrief | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY(objectiveId))
      if (raw) setCachedBrief(JSON.parse(raw))
    } catch {}
  }, [objectiveId])

  const cacheBrief = (brief: Record<string, unknown>) => {
    try {
      const cached: CachedBrief = {
        summary:         brief.summary as string,
        time_windows:    (brief.time_windows as unknown[]) ?? [],
        map_pins:        (brief.map_pins as unknown[]) ?? [],
        confidence_tier: brief.confidence_tier as string,
        confidence_pct:  brief.confidence_pct as number,
        go_no_go:        brief.go_no_go as string,
        brief_date:      brief.brief_date as string,
        cached_at:       new Date().toISOString(),
      }
      localStorage.setItem(CACHE_KEY(objectiveId), JSON.stringify(cached))
      setCachedBrief(cached)
    } catch {}
  }

  return { cachedBrief, cacheBrief }
}
