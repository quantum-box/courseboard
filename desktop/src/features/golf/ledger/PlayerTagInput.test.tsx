import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { PlayerTagInput } from './PlayerTagInput'

describe('PlayerTagInput', () => {
  it('shows configured choices followed by free entry', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18next}>
        <PlayerTagInput value="共通" options={['共通', '優待']} onChange={vi.fn()} />
      </I18nextProvider>,
    )
    expect(markup).toContain('<option value="共通" selected="">共通</option>')
    expect(markup).toContain('優待')
    expect(markup).toContain('その他（自由入力）')
  })

  it('opens free entry for a historical value outside the current choices', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18next}>
        <PlayerTagInput value="旧区分" options={['共通']} onChange={vi.fn()} />
      </I18nextProvider>,
    )
    expect(markup).toContain('value="旧区分"')
    expect(markup).toContain('その他（自由入力）')
  })
})
