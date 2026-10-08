// FF-096 UI: the remove menu, the Objective details card, the removed list and the removed page.
// There is no DOM test library here, so these render the initial markup and check what the owner sees,
// the wording, and the touch-target and text-size rules.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ObjectiveMenu, { MenuPanel, RemoveConfirm, REMOVE_CONFIRM_TEXT } from './ObjectiveMenu'
import ObjectiveDetailsCard, { DETAILS_LOCKED_NOTE } from './ObjectiveDetailsCard'
import RemovedObjectives from './RemovedObjectives'
import RemovedObjectiveNotice from './RemovedObjectiveNotice'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const classAttrs = (html: string) => Array.from(html.matchAll(/class="([^"]*)"/g)).map(m => m[1])
const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? []

function expectStyleRules(html: string) {
  for (const cls of classAttrs(html)) {
    expect(cls).not.toMatch(/\/\d+/)                 // no alpha backgrounds or borders
    expect(cls).not.toMatch(/\bopacity-/)
    expect(cls).not.toMatch(/text-\[(\d|1[01])px\]/) // nothing under 12 px
  }
  for (const b of buttons(html)) expect(b).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/) // every button is 44 px or taller
}

describe('ObjectiveMenu', () => {
  it('renders nothing for a campaign unit (it cannot be removed here)', () => {
    expect(renderToStaticMarkup(<ObjectiveMenu objectiveId="p1" title="Elk" canRemove={false} />)).toBe('')
  })

  it('shows a 44 px "..." button, with the menu closed', () => {
    const html = renderToStaticMarkup(<ObjectiveMenu objectiveId="p1" title="Elk" canRemove />)
    expect(html).toContain('aria-label="Objective options"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Remove objective')
    expect(html).toMatch(/<button[^>]*min-h-\[44px\][^>]*min-w-\[44px\]/)
  })

  it('the menu offers Remove objective', () => {
    const html = renderToStaticMarkup(<MenuPanel onRemove={() => {}} />)
    expect(html).toContain('Remove objective')
    expectStyleRules(html)
  })

  it('the confirm step uses the agreed wording, with the title', () => {
    const html = renderToStaticMarkup(<RemoveConfirm title="Rainbow trout, fly fishing (Utah)" busy={false} message={null} onCancel={() => {}} onRemove={() => {}} />)
    expect(REMOVE_CONFIRM_TEXT('X')).toBe('Remove X? It disappears from your list. You can restore it from Removed objectives.')
    expect(html).toContain('Remove Rainbow trout, fly fishing (Utah)? It disappears from your list. You can restore it from Removed objectives.')
    expect(html).toContain('>Cancel<')
    expect(html).toContain('>Remove<')
    expect(html).toContain('role="alertdialog"')
    expectStyleRules(html)
  })

  it('the confirm step shows a server message, and a busy state', () => {
    const html = renderToStaticMarkup(<RemoveConfirm title="X" busy message="Could not remove the objective. Try again." onCancel={() => {}} onRemove={() => {}} />)
    expect(html).toContain('Could not remove the objective. Try again.')
    expect(html).toContain('Removing…')
    expect(html).toMatch(/<button[^>]*disabled/)
  })
})

describe('ObjectiveDetailsCard', () => {
  const render = (over: Partial<Parameters<typeof ObjectiveDetailsCard>[0]> = {}) =>
    renderToStaticMarkup(<ObjectiveDetailsCard objectiveId="p1" title="Green River opener" tripStart="2026-10-01" tripEnd="2026-10-31" note="bring waders" {...over} />)

  it('shows the title, both dates and the note, from what is saved', () => {
    const html = render()
    expect(html).toContain('Objective details')
    expect(html).toContain('value="Green River opener"')
    expect(html).toContain('value="2026-10-01"')
    expect(html).toContain('value="2026-10-31"')
    expect(html).toContain('bring waders')
  })

  it('limits the title to 120 and the note to 1000 characters', () => {
    const html = render()
    expect(html).toContain('maxLength="120"')
    expect(html).toContain('maxLength="1000"')
  })

  it('says the species and state cannot be changed here, and how to change them', () => {
    expect(render()).toContain('To change the species or state, remove this objective and create a new one.')
    expect(DETAILS_LOCKED_NOTE).toBe('To change the species or state, remove this objective and create a new one.')
  })

  it('has no species, state or hunt number field', () => {
    const html = render()
    expect(html).not.toMatch(/name="(taxonomy|state|hunt)/i)
    expect(html).not.toMatch(/Species|Hunt number/)
  })

  it('date inputs use the dark colour scheme, and Save starts disabled until something changes', () => {
    const html = render()
    expect(html.match(/type="date"[^>]*\[color-scheme:dark\]|\[color-scheme:dark\][^>]*type="date"/g)).toHaveLength(2)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Save details/)
  })

  it('empty dates and note render empty, not "null"', () => {
    const html = render({ tripStart: null, tripEnd: null, note: null })
    expect(html).not.toContain('null')
    expect(html).toContain('type="date"')
  })

  it('follows the style rules: no alpha, no tiny text, 44 px controls', () => {
    const html = render()
    expectStyleRules(html)
    for (const input of html.match(/<(input|textarea)[^>]*>/g) ?? []) expect(input).toMatch(/min-h-\[(4[4-9]|[5-9]\d|88)px\]/)
  })
})

describe('RemovedObjectives', () => {
  it('renders nothing when there are none', () => {
    expect(renderToStaticMarkup(<RemovedObjectives items={[]} />)).toBe('')
  })

  it('is collapsed, with a count, and a Restore button for each', () => {
    const html = renderToStaticMarkup(<RemovedObjectives items={[{ id: 'a', title: 'Sockeye salmon' }, { id: 'b', title: 'Kansas turkey' }]} />)
    expect(html).toContain('<details')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).toContain('Removed objectives (2)')
    expect(html).toContain('Sockeye salmon')
    expect(html).toContain('Kansas turkey')
    expect((html.match(/>Restore</g) ?? []).length).toBe(2)
    expectStyleRules(html)
  })

  it('the summary and rows are at least 44 px tall', () => {
    const html = renderToStaticMarkup(<RemovedObjectives items={[{ id: 'a', title: 'T' }]} />)
    expect(html).toMatch(/<summary[^>]*min-h-\[44px\]/)
    expect(html).toMatch(/min-h-\[56px\]/)
  })
})

describe('RemovedObjectiveNotice', () => {
  it('says the objective was removed, shows its title, and offers Restore instead of the brief', () => {
    const html = renderToStaticMarkup(<RemovedObjectiveNotice objectiveId="p1" title="Rainbow trout, fly fishing (Utah)" />)
    expect(html).toContain('This objective was removed')
    expect(html).toContain('Rainbow trout, fly fishing (Utah)')
    expect(html).toContain('>Restore<')
    expect(html).toMatch(/<a[^>]*href="\/strike"/)
    expect(html).not.toMatch(/GO|Time windows|Strike Brief/)
    expectStyleRules(html)
  })
})
