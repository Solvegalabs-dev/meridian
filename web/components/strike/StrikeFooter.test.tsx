import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RefreshButton, RefreshStatus } from './StrikeFooter'
import type { BriefRefreshResult } from '@/lib/strike/briefRefresh'

const GENERATED = '2026-10-03T06:15:00.000Z'

// renderToStaticMarkup escapes apostrophes in text content.
const escaped = (s: string) => s.replace(/'/g, '&#x27;')

describe('StrikeFooter refresh status', () => {
  it.each<[string, BriefRefreshResult, string]>([
    ['offline', 'offline', "You're offline. Showing the saved brief."],
    ['same', 'same', 'No newer brief. The latest is from '],
    ['new', 'new', 'New brief loaded.'],
    ['error', 'error', "Couldn't check right now. Try again in a minute."],
  ])('renders the %s outcome message in a status region', (_name, result, text) => {
    const html = renderToStaticMarkup(<RefreshStatus result={result} generatedAt={GENERATED} />)
    expect(html).toContain('role="status"')
    expect(html).toContain(escaped(text))
    expect(html).toContain('text-sm')
    expect(html).toContain('text-slate-100')
  })

  it('shows the "same" note with the time of the latest brief', () => {
    const html = renderToStaticMarkup(<RefreshStatus result="same" generatedAt={GENERATED} />)
    expect(html).toContain('Briefs update with each scheduled sweep.')
  })

  it('renders an empty status region before any check', () => {
    const html = renderToStaticMarkup(<RefreshStatus result={null} generatedAt={GENERATED} />)
    expect(html).toContain('role="status"')
    expect(html).not.toContain('No newer brief')
    expect(html).not.toContain('offline')
  })
})

describe('StrikeFooter refresh button', () => {
  it('is labelled "Check for newer brief" and enabled when idle', () => {
    const html = renderToStaticMarkup(<RefreshButton checking={false} onClick={() => {}} />)
    expect(html).toContain('Check for newer brief')
    expect(html).not.toContain('disabled=""')
  })

  it('is disabled and reads "Checking…" while the request runs', () => {
    const html = renderToStaticMarkup(<RefreshButton checking onClick={() => {}} />)
    expect(html).toContain('Checking…')
    expect(html).toContain('disabled=""')
  })
})
