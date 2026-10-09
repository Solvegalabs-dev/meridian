// FF-098 Part 2: a brief is never written from no evidence as if it had some, and the prompt carries labeled values
// with units, the typical-versus-confirmed rule and the no-invented-places rule.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, type FakeSupabase } from '@/lib/testing/fakeSupabase'

const h = vi.hoisted(() => ({ db: null as unknown, create: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.db }))
vi.mock('@/lib/anthropic/client', () => ({ getAnthropicClient: () => ({ messages: { create: h.create } }) }))
vi.mock('./movementPrediction', () => ({ generateMovementWindows: vi.fn(async () => []) }))
vi.mock('./terrainIntelligence', () => ({ getTerrainIntel: vi.fn(async () => ({ intel: null, source: null })) }))

import { generateStrikeBrief, buildStrikeBriefPrompt, type StrikeBriefContext } from './strikeBriefGenerator'
import { ZERO_EVIDENCE_BANNER } from './evidence'

const NOW = new Date('2026-10-08T15:00:00Z')

const PROFILE = {
  objective_id: 'obj-1', lat: 40.12, lon: -111.02, nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130,
  domain: 'fishing', state: 'UT', county: 'Wasatch', geo: { water_body: 'Strawberry River', state: 'UT' }, elevation_ft: 7600,
}

const FLOW = { agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE', observed_value: 2490, source: 'observed', recorded_at: '2026-10-07T12:00:00Z' }
// Spot-level evidence. The state-level flow and the reference-gauge temperature are labeled for the model but are not
// counted as evidence (FF-099), so tests that need the evidence path include this.
const MOON = { agent_key: 'OUTDOOR_MOON_PHASE', observed_value: 9, source: 'observed', recorded_at: '2026-10-08T06:00:00Z' }
const TEMP = { agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 7.5, source: 'observed', recorded_at: '2026-10-08T06:00:00Z' }

function reply(fields: Record<string, unknown> = {}) {
  return { content: [{ type: 'text', text: JSON.stringify({
    synthesis: 'Typical for this time of year, not confirmed: fish feed on mild afternoons.',
    lead_signal: 'Flow is steady', go_no_go: 'GO', condition_delta: 'Up since yesterday', confidence_tier: 'T1', ...fields,
  }) }] }
}

function setup(opts: {
  readings?: unknown[]
  signals?: unknown[]
  existingBrief?: Record<string, unknown> | null
  spotName?: string | null
} = {}) {
  const db: FakeSupabase = fakeSupabase((call) => {
    switch (call.table) {
      case 'objective_profiles':
        return { data: PROFILE }
      case 'objectives':
        return { data: { id: 'obj-1', title: 'Strawberry trout' } }
      case 'agent_signal_history':
        return { data: opts.readings ?? [] }
      case 'signals':
        return { data: opts.signals ?? [] }
      case 'objective_spots':
        return { data: opts.spotName ? { name: opts.spotName } : null }
      case 'agent_objective_context':
        return { data: [{ agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE' }] }
      case 'agent_run_log':
        return { data: [{ agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE' }, { agent_key: 'OUTDOOR_MOON_PHASE' }] }
      case 'strike_briefs':
        if (call.op === 'upsert' || call.op === 'insert') return { data: { id: 'brief-1', ...(call.payload as object) } }
        return { data: opts.existingBrief ?? null }
      default:
        return { data: call.single ? null : [] }
    }
  })
  h.db = db
  h.create.mockReset()
  h.create.mockResolvedValue(reply())
  return db
}

const write = (db: FakeSupabase) =>
  db.calls.find(c => c.table === 'strike_briefs' && (c.op === 'upsert' || c.op === 'insert'))?.payload as Record<string, unknown> | undefined
const promptSent = () => (h.create.mock.calls[0]?.[0] as { messages: Array<{ content: string }> }).messages[0].content
const modelSent = () => (h.create.mock.calls[0]?.[0] as { model: string }).model

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('a brief with no evidence', () => {
  it('starts with the fixed banner line', async () => {
    const db = setup()
    await generateStrikeBrief('obj-1', 'u1')
    const synthesis = write(db)?.synthesis as string
    expect(synthesis.startsWith(ZERO_EVIDENCE_BANNER)).toBe(true)
    expect(synthesis).toContain('Typical for this time of year, not confirmed')
  })

  it('is MONITOR at the lowest tier, whatever the model returned', async () => {
    const db = setup()
    h.create.mockResolvedValue(reply({ go_no_go: 'GO', confidence_tier: 'T1' }))
    await generateStrikeBrief('obj-1', 'u1')
    expect(write(db)).toMatchObject({ go_no_go: 'MONITOR', confidence_tier: 'T4' })
  })

  it('emits no chips: no agent hits, no lead signal, no condition delta', async () => {
    const db = setup()
    await generateStrikeBrief('obj-1', 'u1')
    expect(write(db)).toMatchObject({ agent_hits: [], lead_signal: null, condition_delta: null })
  })

  it('uses the cheap model', async () => {
    setup()
    await generateStrikeBrief('obj-1', 'u1')
    expect(modelSent()).toBe('claude-haiku-4-5-20251001')
  })

  it('the prompt says there is nothing to confirm and carries the no-named-places rule strictly', async () => {
    setup()
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('EVIDENCE (last 14 days): NONE')
    expect(prompt).toContain('There is nothing to confirm')
    expect(prompt).toMatch(/never name a river, creek, road, trailhead, closure, forest, land agency, drainage, corridor or region/)
  })

  it('an estimated zero reading is not evidence, so it is still a no-evidence brief', async () => {
    const db = setup({ readings: [{ agent_key: 'OUTDOOR_USGS_WATER_TEMP', observed_value: 0, source: 'estimated', recorded_at: '2026-10-08T06:00:00Z' }] })
    await generateStrikeBrief('obj-1', 'u1')
    expect(write(db)?.go_no_go).toBe('MONITOR')
    expect((write(db)?.synthesis as string).startsWith(ZERO_EVIDENCE_BANNER)).toBe(true)
    // 0 would format as "32 F (0 C)"; the placeholder must never reach the model.
    expect(promptSent()).not.toContain('32 F (0 C)')
    expect(promptSent()).not.toContain('USGS estimated')
  })

  it('readings older than 14 days do not turn it into an evidence brief', async () => {
    const db = setup({ readings: [{ ...FLOW, recorded_at: '2026-09-20T12:00:00Z' }] })
    await generateStrikeBrief('obj-1', 'u1')
    expect((write(db)?.synthesis as string).startsWith(ZERO_EVIDENCE_BANNER)).toBe(true)
  })
})

describe('a brief with evidence', () => {
  it('uses the stronger model and keeps the verdict, tier and chips the model gave', async () => {
    const db = setup({ readings: [FLOW, TEMP, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    expect(modelSent()).toBe('claude-sonnet-4-6')
    expect(write(db)).toMatchObject({ go_no_go: 'GO', confidence_tier: 'T1', lead_signal: 'Flow is steady' })
    expect((write(db)?.agent_hits as string[]).length).toBeGreaterThan(0)
    expect(write(db)?.synthesis as string).not.toContain(ZERO_EVIDENCE_BANNER)
  })

  it('the prompt carries labeled values with units', async () => {
    setup({ readings: [FLOW, TEMP, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('State-level streamflow (not this water): 2,490 cfs, USGS observed')
    expect(prompt).toContain('Water temperature (reference gauge, not this water): 45.5 F (7.5 C), USGS observed')
  })

  it('the prompt carries the typical-versus-confirmed rule', async () => {
    setup({ readings: [FLOW, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('CONFIRMED: only what the EVIDENCE block shows')
    expect(prompt).toContain('"Typical for this time of year, not confirmed:"')
    expect(prompt).toContain('never word it as a fact about today')
  })

  it('the prompt carries the units rule and says a missing category is named in one clause', async () => {
    setup({ readings: [FLOW, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('never give a number without its unit')
    expect(prompt).toContain('MISSING DATA: no water temperature reading for this water yet; no streamflow reading for this water yet.')
    expect(prompt).toContain('say so in one clause')
  })

  it('a state-level streamflow reading is labeled as not this water, and the rule forbids calling it the flow of this spot', async () => {
    setup({ readings: [FLOW, TEMP, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('State-level streamflow (not this water): 2,490 cfs, USGS observed')
    expect(prompt).not.toMatch(/- Streamflow: /)
    expect(prompt).toContain('5. A reference-gauge or state-level reading must never be described as the condition at this spot.')
  })

  it('with a state-level streamflow reading and a water temperature, it still says there is no streamflow reading for this water', async () => {
    setup({ readings: [FLOW, TEMP, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    // The evidence block's own line (rule 4 below it also has an example sentence, so match from the line start).
    const line = promptSent().match(/^MISSING DATA: .*$/m)?.[0]
    // The reference-gauge temperature does not satisfy the water temperature clause either.
    expect(line).toBe('MISSING DATA: no water temperature reading for this water yet; no streamflow reading for this water yet.')
  })

  it('a reference-gauge water temperature is labeled as such and cannot be described as this water', async () => {
    setup({ readings: [TEMP, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('Water temperature (reference gauge, not this water): 45.5 F (7.5 C)')
    expect(prompt).toContain('must never be described as the condition at this spot')
    expect(prompt).toContain('no water temperature reading for this water')
  })

  it('only reference-gauge and state-level readings: no evidence, so the banner path and the cheap model', async () => {
    const hatch = { agent_key: 'OUTDOOR_HATCH_WINDOW', observed_value: 0.33, source: 'observed', recorded_at: '2026-10-08T06:00:00Z' }
    const db = setup({ readings: [FLOW, TEMP, hatch] })
    await generateStrikeBrief('obj-1', 'u1')
    expect(write(db)?.go_no_go).toBe('MONITOR')
    expect((write(db)?.synthesis as string).startsWith(ZERO_EVIDENCE_BANNER)).toBe(true)
    expect(modelSent()).toBe('claude-haiku-4-5-20251001')
    expect(promptSent()).toContain('EVIDENCE (last 14 days): NONE')
  })

  it('the prompt lists only the objective\'s own names as usable place names', async () => {
    setup({ readings: [FLOW, MOON], spotName: 'Lower pool' })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).toContain('Strawberry trout')
    expect(prompt).toContain('Strawberry River')
    expect(prompt).toContain('Wasatch')
    expect(prompt).toContain('Lower pool')
    expect(prompt).toMatch(/Do not infer a watershed, drainage or "corridor"/)
  })

  it('no longer asks the model to place water "by drainage position relative to these coordinates", and sends no coordinates', async () => {
    setup({ readings: [FLOW, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    const prompt = promptSent()
    expect(prompt).not.toContain('drainage position')
    expect(prompt).not.toContain('Name specific terrain features')
    expect(prompt).not.toContain('Coordinates:')
    expect(prompt).not.toContain('40.12')
    expect(prompt).not.toContain('111.02')
  })

  it('background material is labeled as not evidence', async () => {
    setup({ readings: [FLOW, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    expect(promptSent()).toContain('BACKGROUND, NOT EVIDENCE')
  })
})

describe('buildStrikeBriefPrompt', () => {
  const base = (over: Partial<StrikeBriefContext> = {}): StrikeBriefContext => ({
    objectiveId: 'o', objectiveTitle: 'Trout', domain: 'fishing', signalBrief: 'general profile', domainEvents: 'none',
    rawMacroEvents: [], patternMatchYear: null, patternMatchScore: null, confidenceTier: 'T4', agentHits: [],
    geoProfile: null, domainProfile: null, locationProfile: null, terrainCache: null, ...over,
  })

  it('always carries the four evidence rules, with or without a count', () => {
    for (const evidence of [undefined, { count: 0, lines: [], missing: [] }, { count: 1, lines: ['State-level streamflow (not this water): 2,490 cfs, USGS observed'], missing: [] }]) {
      const prompt = buildStrikeBriefPrompt(base({ evidence }), '0600')
      expect(prompt).toContain('EVIDENCE RULES')
      expect(prompt).toContain('PLACE NAMES')
      expect(prompt).toContain('UNITS')
      expect(prompt).toContain('MISSING DATA')
    }
  })

  it('with no place names it tells the model to say "your spot"', () => {
    expect(buildStrikeBriefPrompt(base({ placeNames: [] }), '0600')).toContain('say "your spot"')
  })
})

describe('a no-evidence brief is replaced once evidence exists', () => {
  const staleZero = { id: 'old', synthesis: `${ZERO_EVIDENCE_BANNER}\n\nTypical for this time of year.`, go_no_go: 'MONITOR', confidence_tier: 'T4' }

  it('regenerates when the stored brief carries the banner and a sweep has since produced readings', async () => {
    const db = setup({ existingBrief: staleZero, readings: [FLOW, MOON] })
    await generateStrikeBrief('obj-1', 'u1')
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(write(db)?.synthesis as string).not.toContain(ZERO_EVIDENCE_BANNER)
  })

  it('keeps the stored no-evidence brief while there is still no evidence (no second model call)', async () => {
    setup({ existingBrief: staleZero, readings: [] })
    const brief = await generateStrikeBrief('obj-1', 'u1')
    expect(h.create).not.toHaveBeenCalled()
    expect((brief as unknown as { id: string }).id).toBe('old')
  })

  it('keeps an ordinary stored brief as before, without even looking for evidence', async () => {
    setup({ existingBrief: { id: 'normal', synthesis: 'A normal brief.', go_no_go: 'GO' }, readings: [FLOW, MOON] })
    const brief = await generateStrikeBrief('obj-1', 'u1')
    expect(h.create).not.toHaveBeenCalled()
    expect((brief as unknown as { id: string }).id).toBe('normal')
  })
})
