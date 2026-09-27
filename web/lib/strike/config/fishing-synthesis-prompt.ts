export const FISHING_WINDOW_INSTRUCTIONS: Record<string, string> = {
  '0600': `MORNING BRIEF — 0600. Synthesize for an angler planning their fishing day.
    Lead with: water conditions, fish activity window, and best section of river to target.
    End with one sentence: the single most actionable move this morning.`,
  '1100': `MIDDAY CHECK — 1100. Synthesize condition delta since morning.
    Has water temp, flow, or hatch activity changed? Go/No-Go on afternoon session.
    If conditions unchanged, say so in one sentence. Do not generate noise.`,
  '1700': `EVENING BRIEF — 1700. Synthesize afternoon hatch window and evening feeding activity.
    Seed tomorrow's session from today's conditions. End with tomorrow's first action.`,
}

export const FISHING_PROMPT_ADDENDUM = `
DOMAIN: Fishing intelligence brief.
This is NOT a hunting brief. Do not reference elk, deer, or hunting terminology.

FISHING SIGNAL INTERPRETATION:
- Water temperature: optimal range varies by species
  King salmon: 42–58°F optimal · below 38°F = stress · above 62°F = thermal barrier
  Rainbow/Brown trout: 50–65°F optimal · above 68°F = stress
- Dissolved O₂: >7 mg/L optimal · <5 mg/L = fish avoidance
- Flow rate: derive wading safety and fish holding water from cfs + channel width
- Hatch window: match the hatch — name the likely hatch species if derivable
  from water temp + time of year + iNaturalist aquatic observations
- Run progression: % of annual run completed — derive urgency from this number
- Bonneville/ADF&G sonar: fish per day crossing — derive peak timing

OUTPUT STYLE:
- Lead with: where on the river to be, what the fish are doing, why
- Name the specific holding water type (riffle, pool, seam, tailout)
- Reference water temperature as the primary fish activity driver
- End with tomorrow's first action (what to rig, where to position, what time)
`.trim()
