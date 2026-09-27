// lib/sweep/patternDeviation/historicalOutcomeLookup.ts
// FF-067 — Seeded lookup of known historical outcomes per domain + year.
// As the prediction log accumulates scored outcomes, this is replaced by real data.

interface HistoricalOutcome {
  summary: string
  confidence: number
}

const ELK_HUNT_OUTCOMES: Record<number, HistoricalOutcome> = {
  2021: {
    summary: 'Severe drought year. Elk concentrated near active water sources. Harvest success approximately 41% below 10-year average. Hunters targeting water sources outperformed unit average significantly. DWR issued 450 emergency antlerless permits due to population management pressure.',
    confidence: 80,
  },
  2022: {
    summary: 'Continued drought conditions. Partial recovery late season. Below-average harvest outcomes. Elk movement compressed to riparian zones. Access to private water sources highly advantageous.',
    confidence: 65,
  },
  2023: {
    summary: 'Recovery year. Drought easing. Herd rebuilding. Below-average harvest but improving conditions. Broader elk distribution beginning to return.',
    confidence: 55,
  },
  2024: {
    summary: 'Recovery continues. Water restored in most units. Population rebuilding. Average to slightly below-average harvest. Elk distribution improving toward normal range.',
    confidence: 60,
  },
  2019: {
    summary: 'Strong water year following recovery. Good snowpack translated to broad herd distribution. Above-average harvest success. Elk distributed broadly across unit elevations.',
    confidence: 70,
  },
  2017: {
    summary: 'Excellent conditions. Record snowpack. Broad herd distribution. Strong rut activity. Harvest success significantly above average.',
    confidence: 75,
  },
}

export function getHistoricalOutcome(domain: string, year: number): HistoricalOutcome | null {
  if (domain === 'elk_hunt') {
    return ELK_HUNT_OUTCOMES[year] || null
  }
  return null
}
