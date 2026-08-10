import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CaddieLink } from './CaddieLink'

describe('CaddieLink', () => {
  it('shows the name with its first character as a badge', () => {
    const markup = renderToStaticMarkup(
      <CaddieLink caddieId="caddie_aya" displayName="佐藤 彩" />,
    )
    expect(markup).toContain('佐藤 彩')
    expect(markup).toContain('>佐<')
    expect(markup).toContain('<button')
  })

  it('stays plain text when there is nobody to open', () => {
    // A row with no profile behind it must still read as a name rather than
    // offering a button that goes nowhere.
    const markup = renderToStaticMarkup(<CaddieLink displayName="佐藤 彩" />)
    expect(markup).toContain('佐藤 彩')
    expect(markup).not.toContain('<button')
  })

  it('falls back to the id when the roster has no name', () => {
    const markup = renderToStaticMarkup(<CaddieLink caddieId="caddie_aya" />)
    expect(markup).toContain('caddie_aya')
  })

  it('takes the caller’s wording when neither is known', () => {
    const markup = renderToStaticMarkup(<CaddieLink fallback="担当なし" />)
    expect(markup).toContain('担当なし')
  })
})
