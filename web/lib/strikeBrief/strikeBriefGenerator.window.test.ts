import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, type FakeSupabase } from '@/lib/testing/fakeSupabase'

// The DB and the model are the only things mocked. The generator and the window
// evaluator run for real.
const h = vi.hoisted(() => ({
  db: null as unknown,
  create: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.db }))
vi.mock('@/lib/anthropic/client', () => ({
  getAnthropicClient: () => ({ messages: { create: h.create } }),
}))
vi.mock('./movementPrediction', () => ({ generateMovementWindows: vi.fn(async () => []) }))
vi.mock('./terrainIntelligence', () => ({ getTerrainIntel: vi.fn(async () => ({ intel: null, source: null })) }))

import { generateStrikeBrief, LocationNotSetError } from './strikeBriefGenerator'

const NOW = new Date('2026-10-03T15:00:00Z') // 09:00 MDT Oct 3

// FF-091: a generated brief needs a location. Used by tests that are about model output, not location.
const PROFILE_LOCATED = {
  objective_id: 'obj-x',
  lat: 40.7,
  lon: -111.9,
  nws_grid_office: 'SLC',
  nws_grid_x: 90,
  nws_grid_y: 130,
  domain: 'elk_hunt',
};

const PROFILE_TRIP_ENDED = {
  id: 'prof-17',
  objective_id: 'obj-17',
  user_id: 'user-1',
  status: 'active',
  timing: { trip_start: '2026-09-12', trip_end: '2026-09-30' },
  taxonomy_key: 'elk.bull.archery',
  state: 'UT',
  lat: 40.7,
  lon: -111.9,
  nws_grid_office: 'SLC',
  nws_grid_x: 90,
  nws_grid_y: 130,
  hunt_unit_id: null,
  domain: 'elk_hunt',
  ended_at: null,
  ended_reason: null,
}

const SEASON_ARCHERY_BULL = {
  id: 'season-archery',
  state: 'UT',
  species: 'elk',
  hunt_type: 'archery',
  sex_class: 'bull',
  hunt_unit_id: null,
  hunt_code: null,
  season_year: 2026,
  season_start: '2026-08-15',
  season_end: '2026-09-16',
  source_url: 'https://example.invalid/proclamation',
  source_checked_at: '2026-10-02',
  notes: null,
}

const SEASON_NOT_OPEN = {
  ...SEASON_ARCHERY_BULL,
  id: 'season-late',
  hunt_type: 'archery',
  season_start: '2026-10-15',
  season_end: '2026-11-30',
}

// One reading a day old: enough evidence that the brief is written the normal way.
const RECENT_READING = {
  agent_key: 'OUTDOOR_USGS_STREAMFLOW_STATE',
  observed_value: 2490,
  source: 'observed',
  recorded_at: '2026-10-02T12:00:00Z',
}

function modelReply(fields: Record<string, unknown>) {
  return { content: [{ type: 'text', text: JSON.stringify({ synthesis: 'Hunt the north face.', lead_signal: 'Wind', condition_delta: null, confidence_tier: 'T2', ...fields }) }] }
}

function setup(opts: {
  profile: Record<string, unknown> | null
  seasons?: unknown[]
  modelFields?: Record<string, unknown>
  // FF-098: by default the objective has a recent reading, so these tests exercise the evidence path.
  // Pass [] to exercise a brief with no evidence.
  readings?: unknown[]
}) {
  const db: FakeSupabase = fakeSupabase((call) => {
    switch (call.table) {
      case 'objective_profiles':
        return { data: opts.profile }
      case 'hunt_seasons':
        return { data: opts.seasons ?? [] }
      case 'agent_signal_history':
        return { data: opts.readings ?? [RECENT_READING] }
      case 'strike_briefs':
        if (call.op === 'upsert' || call.op === 'insert') return { data: { id: 'brief-1', ...(call.payload as object) } }
        return { data: null }
      default:
        return { data: call.single ? null : [] }
    }
  })
  h.db = db
  h.create.mockReset()
  h.create.mockResolvedValue(modelReply(opts.modelFields ?? { go_no_go: 'GO' }))
  return db
}

function briefWrite(db: FakeSupabase) {
  const write = db.calls.find(c => c.table === 'strike_briefs' && (c.op === 'upsert' || c.op === 'insert'))
  return write?.payload as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('closed hunts: the code decides, the model is never called', () => {
  it('a season-closed hunt gets a CLOSED brief with no model call', async () => {
    const db = setup({ profile: PROFILE_TRIP_ENDED, seasons: [SEASON_ARCHERY_BULL] })

    const brief = await generateStrikeBrief('obj-17', 'user-1')

    expect(h.create).not.toHaveBeenCalled()
    expect(brief.go_no_go).toBe('CLOSED')
    const payload = briefWrite(db)
    expect(payload).toMatchObject({
      go_no_go: 'CLOSED',
      time_window: '0600',
      confidence_tier: null,
      movement_windows: [],
      objective_id: 'obj-17',
      brief_date: '2026-10-03',
    })
    expect(payload?.synthesis).toBe(
      'Season closed on Sep 16. This hunt is over; Meridian has paused daily briefs for it. Reactivate or start a new objective whenever you are ready.'
    )
  })

  it('the model returns GO for a closed hunt: the stored row is still CLOSED and the model is never called', async () => {
    const db = setup({ profile: PROFILE_TRIP_ENDED, seasons: [SEASON_ARCHERY_BULL], modelFields: { go_no_go: 'GO' } })

    await generateStrikeBrief('obj-17', 'user-1')

    expect(h.create).not.toHaveBeenCalled()
    expect(briefWrite(db)?.go_no_go).toBe('CLOSED')
  })

  it('a trip that ended with no season row gets the trip-window message', async () => {
    const db = setup({ profile: PROFILE_TRIP_ENDED, seasons: [] })

    await generateStrikeBrief('obj-17', 'user-1')

    expect(h.create).not.toHaveBeenCalled()
    expect(briefWrite(db)?.synthesis).toMatch(/^Your trip window ended on Sep 30\./)
  })

  it('an existing CLOSED row for today is returned without a second insert', async () => {
    const db = fakeSupabase((call) => {
      if (call.table === 'objective_profiles') return { data: PROFILE_TRIP_ENDED }
      if (call.table === 'hunt_seasons') return { data: [SEASON_ARCHERY_BULL] }
      if (call.table === 'strike_briefs' && call.op === 'select') return { data: { id: 'existing', go_no_go: 'CLOSED' } }
      return { data: call.single ? null : [] }
    })
    h.db = db
    h.create.mockReset()

    const brief = await generateStrikeBrief('obj-17', 'user-1')

    expect(brief).toMatchObject({ id: 'existing', go_no_go: 'CLOSED' })
    expect(db.writes().filter(c => c.table === 'strike_briefs')).toHaveLength(0)
  })
})

describe('season not open: GO is capped and the date is stated', () => {
  const PROFILE_OPENS_LATER = {
    ...PROFILE_TRIP_ENDED,
    timing: { trip_start: '2026-09-20', trip_end: '2026-10-31' },
  }

  it('caps GO at MONITOR and prepends the open date', async () => {
    const db = setup({ profile: PROFILE_OPENS_LATER, seasons: [SEASON_NOT_OPEN], modelFields: { go_no_go: 'GO' } })

    await generateStrikeBrief('obj-17', 'user-1')

    expect(h.create).toHaveBeenCalledTimes(1)
    const payload = briefWrite(db)
    expect(payload?.go_no_go).toBe('MONITOR')
    expect(payload?.synthesis).toMatch(/^Season opens Oct 15\. Hunt the north face\./)
  })

  it('tells the model the date as a hard fact', async () => {
    setup({ profile: PROFILE_OPENS_LATER, seasons: [SEASON_NOT_OPEN] })

    await generateStrikeBrief('obj-17', 'user-1')

    const prompt = (h.create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).toContain('HUNT WINDOW (hard fact, overrides any inference): the season opens Oct 15')
  })

  it('a trip that has not started (no season row) caps GO too', async () => {
    const db = setup({
      profile: { ...PROFILE_TRIP_ENDED, timing: { trip_start: '2026-10-10', trip_end: '2026-10-20' } },
      seasons: [],
      modelFields: { go_no_go: 'CONDITIONAL' },
    })

    await generateStrikeBrief('obj-17', 'user-1')

    const payload = briefWrite(db)
    expect(payload?.go_no_go).toBe('MONITOR')
    expect(payload?.synthesis).toMatch(/^Trip opens Oct 10\./)
  })
})

describe('active and no-date objectives', () => {
  it('an active hunt keeps the model verdict and text unchanged', async () => {
    // No season row: season unknown, so the trip window alone decides. Today (Oct 3) is inside it.
    const db = setup({
      profile: { ...PROFILE_TRIP_ENDED, timing: { trip_start: '2026-09-01', trip_end: '2026-10-31' } },
      seasons: [],
      modelFields: { go_no_go: 'GO' },
    })

    await generateStrikeBrief('obj-17', 'user-1')

    expect(briefWrite(db)).toMatchObject({ go_no_go: 'GO', synthesis: 'Hunt the north face.' })
  })

  it('no hunt dates: adds the deterministic note and does not cap GO', async () => {
    const db = setup({ profile: { ...PROFILE_TRIP_ENDED, timing: {} }, seasons: [], modelFields: { go_no_go: 'GO' } })

    await generateStrikeBrief('obj-17', 'user-1')

    expect(briefWrite(db)).toMatchObject({
      go_no_go: 'GO',
      synthesis: 'No hunt dates set; briefs assume you are hunting now. Hunt the north face.',
    })
  })

  it('an objective with no location gets no brief: no model call, no write', async () => {
    const db = setup({ profile: null, modelFields: { go_no_go: 'GO' } })

    await expect(generateStrikeBrief('obj-x', 'user-1')).rejects.toThrow(LocationNotSetError)
    expect(h.create).not.toHaveBeenCalled()
    expect(briefWrite(db)).toBeUndefined()
  })
})

describe('model output is normalised before the CHECK constraint', () => {
  it('a hyphenated NO-GO becomes NO_GO', async () => {
    const db = setup({ profile: PROFILE_LOCATED, modelFields: { go_no_go: 'NO-GO' } })
    await generateStrikeBrief('obj-x', 'user-1')
    expect(briefWrite(db)?.go_no_go).toBe('NO_GO')
  })

  it('an unrecognised value becomes MONITOR, never GO', async () => {
    const db = setup({ profile: PROFILE_LOCATED, modelFields: { go_no_go: 'WAIT' } })
    await generateStrikeBrief('obj-x', 'user-1')
    expect(briefWrite(db)?.go_no_go).toBe('MONITOR')
  })

  it('the model cannot write CLOSED itself', async () => {
    const db = setup({ profile: PROFILE_LOCATED, modelFields: { go_no_go: 'CLOSED' } })
    await generateStrikeBrief('obj-x', 'user-1')
    expect(briefWrite(db)?.go_no_go).toBe('MONITOR')
  })
})
