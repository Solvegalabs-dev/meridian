// FF-096b: fishing spots. Heading, button, helper text, the row, the gauge line, the regulations note.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SpotsPanel, {
  FISHING_REGS_NOTE,
  FISHING_SPOTS_HELP,
  HUNT_RULES_NOTE,
  SpotForm,
  SpotsNote,
  SpotsView,
  addButtonLabel,
  gaugeLine,
  headerText,
  spotPlaceLine,
  type SpotView,
} from './SpotsPanel'

const pin = (id: string, name: string, over: Partial<SpotView> = {}): SpotView => ({
  id, name, lat: 40.917, lon: -111.397, is_active: false, county: 'Summit', state: 'UT',
  hunt_unit_id: 'UT-HU-5', inside_boundary: false, ...over,
})

const classAttrs = (html: string) => Array.from(html.matchAll(/class="([^"]*)"/g)).map(m => m[1])
const state = (spots: SpotView[], limit: number | null = 3) => ({ spots, limit, active_spot_id: null })

describe('fishing spots', () => {
  it('the heading reads "Fishing spots, n of 3", and hunting keeps "Hunt spots"', () => {
    expect(headerText(2, 3, true)).toBe('Fishing spots, 2 of 3')
    expect(headerText(2, null, true)).toBe('Fishing spots, 2')
    expect(headerText(2, 3)).toBe('Hunt spots, 2 of 3')

    const fish = renderToStaticMarkup(<SpotsView state={state([pin('a', 'Pool')])} fishing />)
    expect(fish).toContain('Fishing spots, 1 of 3')
    expect(fish).not.toContain('Hunt spots')

    const hunt = renderToStaticMarkup(<SpotsView state={state([pin('a', 'North')])} />)
    expect(hunt).toContain('Hunt spots, 1 of 3')
    expect(hunt).not.toContain('Fishing spots')
  })

  it('the add button says "Add a fishing spot"; hunting keeps "+ Add a spot"', () => {
    expect(addButtonLabel(true)).toBe('Add a fishing spot')
    const fish = renderToStaticMarkup(<SpotsView state={state([])} fishing onAdd={() => {}} />)
    expect(fish).toContain('Add a fishing spot')
    expect(fish).not.toContain('+ Add a spot')

    const hunt = renderToStaticMarkup(<SpotsView state={state([])} onAdd={() => {}} />)
    expect(hunt).toContain('+ Add a spot')
    expect(hunt).not.toContain('Add a fishing spot')
  })

  it('shows the helper text for fishing only', () => {
    expect(FISHING_SPOTS_HELP).toBe('Drop a pin on the water you plan to fish. Each pin can use its own nearest gauge and weather.')
    expect(renderToStaticMarkup(<SpotsView state={state([])} fishing />)).toContain(FISHING_SPOTS_HELP)
    expect(renderToStaticMarkup(<SpotsView state={state([])} />)).not.toContain(FISHING_SPOTS_HELP)
  })

  it('the row shows the county, else the water name, and never a hunt unit', () => {
    expect(spotPlaceLine(pin('a', 'Pool'), true)).toBe('Summit')
    expect(spotPlaceLine(pin('a', 'Pool', { county: null }), true, 'Green River')).toBe('Green River')
    expect(spotPlaceLine(pin('a', 'Pool', { county: null }), true, '  ')).toBeNull()

    const html = renderToStaticMarkup(<SpotsView state={state([pin('a', 'Pool')])} fishing />)
    expect(html).toContain('Summit')
    expect(html).not.toContain('UT-HU-5')

    // Hunting is unchanged: county and hunt unit.
    expect(spotPlaceLine(pin('a', 'North'), false)).toBe('Summit · UT-HU-5')
    expect(renderToStaticMarkup(<SpotsView state={state([pin('a', 'North')])} />)).toContain('Summit · UT-HU-5')
  })

  it('falls back to the objective water name on the row when the pin has no county', () => {
    const html = renderToStaticMarkup(<SpotsView state={state([pin('a', 'Pool', { county: null })])} fishing waterBody="Green River" />)
    expect(html).toContain('Green River')
  })

  it('shows no boundary warning for fishing, even for a pin flagged outside a boundary', () => {
    const fish = renderToStaticMarkup(<SpotsView state={state([pin('a', 'Pool')])} fishing huntCode="EA2004" />)
    expect(fish).not.toContain('boundary')
    // The same flagged pin on a hunting objective still warns.
    const hunt = renderToStaticMarkup(<SpotsView state={state([pin('a', 'North')])} huntCode="EA2004" />)
    expect(hunt).toContain('outside the EA2004 boundary')
  })

  it('shows "Nearest gauge: {site name}, {distance} mi" on a fishing row, when the pin has one', () => {
    const withGauge = pin('a', 'Pool', { nearest_gauge: { name: 'Green River Near Greendale, UT', distance_mi: 12.3 } })
    expect(gaugeLine(withGauge)).toBe('Nearest gauge: Green River Near Greendale, UT, 12.3 mi')
    expect(renderToStaticMarkup(<SpotsView state={state([withGauge])} fishing />)).toContain('Nearest gauge: Green River Near Greendale, UT, 12.3 mi')
    expect(gaugeLine({ nearest_gauge: { name: 'Provo River', distance_mi: 4 } })).toBe('Nearest gauge: Provo River, 4 mi')
  })

  it('shows no gauge line when there is none, and none on a hunting row', () => {
    expect(gaugeLine(pin('a', 'Pool'))).toBeNull()
    expect(gaugeLine(pin('a', 'Pool', { nearest_gauge: null }))).toBeNull()
    expect(gaugeLine({ nearest_gauge: { name: '', distance_mi: 3 } })).toBeNull()
    expect(renderToStaticMarkup(<SpotsView state={state([pin('a', 'Pool')])} fishing />)).not.toContain('Nearest gauge')

    const withGauge = pin('a', 'North', { nearest_gauge: { name: 'Provo River', distance_mi: 4 } })
    expect(renderToStaticMarkup(<SpotsView state={state([withGauge])} />)).not.toContain('Nearest gauge')
  })
})

describe('the regulations and rules note', () => {
  it('fishing: fixed copy, always visible', () => {
    expect(FISHING_REGS_NOTE).toBe(
      "Check current regulations for this water before you fish: artificial-only or bait rules, bag and size limits, and closures. Strike doesn't track regulations.",
    )
    expect(renderToStaticMarkup(<SpotsNote fishing />)).toContain('Check current regulations for this water before you fish')
  })

  it('hunting: the one-line equivalent', () => {
    expect(HUNT_RULES_NOTE).toBe('Confirm your unit boundary and current rules before you hunt.')
    const html = renderToStaticMarkup(<SpotsNote fishing={false} />)
    expect(html).toContain(HUNT_RULES_NOTE)
    expect(html).not.toContain('regulations')
  })

  it('is on screen while the spots are still loading, for both kinds', () => {
    // The first render, before the fetch returns, is the loading state.
    const fish = renderToStaticMarkup(<SpotsPanel objectiveId="o1" fishing />)
    expect(fish).toContain('Loading fishing spots')
    expect(fish).toContain('data-testid="spots-note"')
    expect(fish).toContain('Check current regulations for this water before you fish')

    const hunt = renderToStaticMarkup(<SpotsPanel objectiveId="o1" />)
    expect(hunt).toContain('Loading hunt spots')
    expect(hunt).toContain(HUNT_RULES_NOTE)
    expect(hunt).not.toContain('regulations')
  })

  it('is 14 px (text-sm) or larger and uses no alpha or opacity', () => {
    for (const fishing of [true, false]) {
      const html = renderToStaticMarkup(<SpotsNote fishing={fishing} />)
      expect(html).toMatch(/class="[^"]*\btext-sm\b/)
      for (const cls of classAttrs(html)) {
        expect(cls).not.toMatch(/\/\d+/)
        expect(cls).not.toMatch(/\bopacity-/)
      }
    }
  })
})

describe('fishing spots: style rules', () => {
  it('body text is 14 px or more, buttons are 44 px or taller, no alpha or opacity', () => {
    const html = renderToStaticMarkup(
      <SpotsView
        state={state([pin('a', 'Pool', { nearest_gauge: { name: 'Provo River', distance_mi: 4 } })])}
        fishing
        onAdd={() => {}}
        onMakeActive={() => {}}
      />,
    )
    for (const cls of classAttrs(html)) {
      expect(cls).not.toMatch(/\/\d+/)
      expect(cls).not.toMatch(/\bopacity-/)
      expect(cls).not.toMatch(/text-\[(\d|1[01])px\]/)
    }
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toMatch(/min-h-\[44px\]/)
    expect(html).toMatch(/<p class="text-sm[^"]*">Drop a pin/)
  })

  it('the add form tip says "the water" for fishing and "the spot" for hunting (FF-097)', () => {
    const noop = async () => null
    const fish = renderToStaticMarkup(<SpotForm initial={{ name: '', lat: '', lon: '' }} submitLabel="Save spot" fishing onSubmit={noop} onCancel={() => {}} />)
    expect(fish).toContain('long-press the water on Google Maps')
    expect(fish).not.toContain('onX')

    const hunt = renderToStaticMarkup(<SpotForm initial={{ name: '', lat: '', lon: '' }} submitLabel="Save spot" onSubmit={noop} onCancel={() => {}} />)
    expect(hunt).toContain('Tip: long-press the spot on Google Maps to copy its coordinates.')
    expect(hunt).not.toContain('onX')
  })
})
