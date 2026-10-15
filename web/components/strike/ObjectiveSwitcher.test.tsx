// FF-106 Stage 2 Part C: the "Switch objective" control's static markup. Its fetch-on-open and
// hide-when-only-one behavior are exercised by driving the GET /api/strike/objectives route
// directly (app/api/strike/objectives/route.test.ts); this file just pins what the closed
// trigger renders.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ObjectiveSwitcher from './ObjectiveSwitcher'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('ObjectiveSwitcher', () => {
  it('renders a compact, 44px-tall trigger and nothing else until opened', () => {
    const html = renderToStaticMarkup(<ObjectiveSwitcher currentId="prof-1" />)
    expect(html).toContain('Switch objective')
    expect(html).toContain('min-h-[44px]')
    // Closed by default: no menu panel in the markup.
    expect(html).not.toContain('role="menu"')
  })
})
