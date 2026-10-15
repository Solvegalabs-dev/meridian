// FF-096 Part 1 remove menu; FF-106 Stage 2 Part B adds the "Plan again for next year" action.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ObjectiveMenu, { MenuPanel } from './ObjectiveMenu'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

function render(props: Partial<Parameters<typeof ObjectiveMenu>[0]>) {
  return renderToStaticMarkup(
    <ObjectiveMenu objectiveId="prof-1" title="Unit 5A elk" canRemove={false} {...props} />
  )
}

describe('ObjectiveMenu', () => {
  it('renders nothing when neither remove nor plan-again is available', () => {
    expect(render({ canRemove: false, canPlanAgain: false })).toBe('')
  })

  it('renders the "···" trigger when remove is available', () => {
    const html = render({ canRemove: true })
    expect(html).toContain('Objective options')
  })

  it('renders the trigger when only plan-again is available (a finished campaign unit, say)', () => {
    const html = render({ canRemove: false, canPlanAgain: true })
    expect(html).toContain('Objective options')
  })
})

describe('MenuPanel', () => {
  it('shows Remove objective when onRemove is given, and not otherwise', () => {
    const withRemove = renderToStaticMarkup(<MenuPanel objectiveId="prof-1" onRemove={() => {}} />)
    expect(withRemove).toContain('Remove objective')

    const without = renderToStaticMarkup(<MenuPanel objectiveId="prof-1" />)
    expect(without).not.toContain('Remove objective')
  })

  it('shows Plan again for next year only when showPlanAgain is true', () => {
    const withPlanAgain = renderToStaticMarkup(<MenuPanel objectiveId="prof-1" showPlanAgain />)
    expect(withPlanAgain).toContain('Plan again for next year')

    const without = renderToStaticMarkup(<MenuPanel objectiveId="prof-1" showPlanAgain={false} />)
    expect(without).not.toContain('Plan again for next year')
  })

  it('shows both actions together', () => {
    const html = renderToStaticMarkup(<MenuPanel objectiveId="prof-1" onRemove={() => {}} showPlanAgain />)
    expect(html).toContain('Remove objective')
    expect(html).toContain('Plan again for next year')
  })
})
