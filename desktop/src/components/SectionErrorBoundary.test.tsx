import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SectionErrorBoundary } from './SectionErrorBoundary'

describe('SectionErrorBoundary', () => {
  it('falls back to operator copy for only the failed section', () => {
    const boundary = new SectionErrorBoundary({ children: <div>shift table</div> })
    boundary.state = { failed: true }

    const markup = renderToStaticMarkup(boundary.render())
    expect(markup).toContain('この部分を表示できません')
    expect(markup).toContain('ほかの部分は引き続き使えます')
    expect(markup).not.toContain('shift table')
  })
})
