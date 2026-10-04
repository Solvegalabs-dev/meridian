import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LastHuntBrief from './LastHuntBrief'

describe('LastHuntBrief', () => {
  it('shows the heading and the history styling', () => {
    const html = renderToStaticMarkup(<LastHuntBrief heading="Last hunt brief, Oct 1 · GO" synthesis="Hold the north side." />)
    expect(html).toContain('Last hunt brief, Oct 1 · GO')
    expect(html).toContain('bg-slate-800')
    expect(html).not.toContain('CLOSED')
  })

  it('short synthesis: no clamp and no toggle', () => {
    const html = renderToStaticMarkup(<LastHuntBrief heading="h" synthesis="Short note." />)
    expect(html).not.toContain('line-clamp-3')
    expect(html).not.toContain('Show more')
  })

  it('long synthesis: clamped to three lines with a Show more toggle', () => {
    const html = renderToStaticMarkup(<LastHuntBrief heading="h" synthesis={'word '.repeat(60)} />)
    expect(html).toContain('line-clamp-3')
    expect(html).toContain('Show more')
    expect(html).toContain('aria-expanded="false"')
  })

  it('no synthesis: heading only', () => {
    const html = renderToStaticMarkup(<LastHuntBrief heading="h" synthesis={null} />)
    expect(html).toContain('>h<')
    expect(html).not.toContain('<p')
  })
})
