import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { i18next } from '../i18n'
import { YearMonthPicker } from './YearMonthPicker'

describe('YearMonthPicker', () => {
  it('uses selects instead of a free-form month input', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18next}>
        <YearMonthPicker
          label="対象の月"
          value="2026-02"
          error={null}
          onChange={vi.fn()}
        />
      </I18nextProvider>,
    )

    expect(markup.match(/<select/g)).toHaveLength(2)
    expect(markup).not.toContain('type="month"')
    expect(markup).toContain('2026')
  })

  it('shows Japanese operator copy beside the picker for an invalid candidate', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18next}>
        <YearMonthPicker
          label="対象の月"
          value="2026-02"
          error="invalid"
          onChange={vi.fn()}
        />
      </I18nextProvider>,
    )

    expect(markup).toContain('年と月を正しく選んでください。')
    expect(markup).not.toContain('yearMonth')
  })
})
