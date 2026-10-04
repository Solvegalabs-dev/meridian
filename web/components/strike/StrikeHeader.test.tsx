import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikeHeader from './StrikeHeader'
import type { WindowEvaluation } from '@/lib/objectives/windowState'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const ev = (state: WindowEvaluation['state']): WindowEvaluation => ({ state, detail: { code: 'X', trip_end: '2026-09-30' } })

function render(props: Partial<Parameters<typeof StrikeHeader>[0]>) {
  return renderToStaticMarkup(
    <StrikeHeader
      title="Unit 5A elk"
      taxonomyKey="elk.bull.archery"
      evaluation={null}
      hasBrief={false}
      brief={null}
      isOnline
      {...props}
    />
  )
}

describe('StrikeHeader', () => {
  it('shows the objective title, with the taxonomy key as a subtitle', () => {
    const html = render({})
    expect(html).toContain('Unit 5A elk')
    expect(html).toContain('elk · bull · archery')
  })

  it('shows no tier chip and no verdict when there is no brief row', () => {
    // The placeholder brief from the server has T4 and NO-GO. Neither may reach the header.
    const html = render({ hasBrief: false, brief: { confidence_tier: 'T4', go_no_go: 'NO-GO' } })
    expect(html).not.toContain('T4')
    expect(html).not.toContain('NO GO')
  })

  it('shows the verdict as the largest element and the tier beside it for a live brief', () => {
    const html = render({
      hasBrief: true,
      evaluation: ev('active'),
      brief: { confidence_tier: 'T1', go_no_go: 'GO' },
    })
    expect(html).toContain('text-2xl')
    expect(html).toContain('>GO<')
    expect(html).toContain('>T1<')
    expect(html).toContain('>Active<')
  })

  it('shows no tier chip and no verdict for a closed hunt, even with a stored tier', () => {
    const html = render({
      hasBrief: true,
      evaluation: ev('trip_ended'),
      brief: { confidence_tier: 'T1', go_no_go: 'GO' },
    })
    expect(html).not.toContain('>T1<')
    expect(html).not.toContain('>GO<')
    expect(html).toContain('>Trip ended<')
  })

  it('shows no tier chip when the brief is CLOSED', () => {
    const html = render({ hasBrief: true, evaluation: ev('active'), brief: { confidence_tier: null, go_no_go: 'CLOSED' } })
    expect(html).not.toContain('text-2xl')
  })

  it('upcoming hunt with a GO brief shows the pre-season caption under the verdict', () => {
    const html = render({ hasBrief: true, evaluation: ev('upcoming'), brief: { confidence_tier: 'T1', go_no_go: 'GO' } })
    expect(html).toContain('>GO<')
    expect(html).toContain('Pre-season outlook, not a hunt-day call')
  })

  it('season not open with a GO brief shows the pre-season caption', () => {
    const html = render({ hasBrief: true, evaluation: ev('season_not_open'), brief: { confidence_tier: 'T1', go_no_go: 'GO' } })
    expect(html).toContain('Pre-season outlook, not a hunt-day call')
  })

  it('active hunt with a GO brief has no pre-season caption', () => {
    const html = render({ hasBrief: true, evaluation: ev('active'), brief: { confidence_tier: 'T1', go_no_go: 'GO' } })
    expect(html).toContain('>GO<')
    expect(html).not.toContain('Pre-season outlook')
  })

  it('ended hunt renders no verdict and no caption', () => {
    const html = render({ hasBrief: true, evaluation: ev('season_closed'), brief: { confidence_tier: 'T1', go_no_go: 'GO' } })
    expect(html).not.toContain('>GO<')
    expect(html).not.toContain('Pre-season outlook')
  })
})
