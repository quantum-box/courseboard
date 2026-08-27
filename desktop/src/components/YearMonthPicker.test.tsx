/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../i18n'
import { YearMonthPicker } from './YearMonthPicker'

afterEach(cleanup)

function picker(props: Partial<Parameters<typeof YearMonthPicker>[0]> = {}) {
  return (
    <I18nextProvider i18n={i18next}>
      <YearMonthPicker
        label="対象の月"
        value="2026-02"
        error={null}
        onChange={vi.fn()}
        {...props}
      />
    </I18nextProvider>
  )
}

describe('YearMonthPicker', () => {
  it('shows the month as one label rather than a pair of boxes', () => {
    render(picker())

    expect(screen.getByText('2026年2月')).toBeTruthy()
    // The dropdowns are behind the label now, so they are not in the document
    // until somebody asks for them.
    expect(document.querySelectorAll('select')).toHaveLength(0)
  })

  it('steps a month with the arrows, which is what the desk reaches for', () => {
    const onChange = vi.fn()
    render(picker({ onChange }))

    fireEvent.click(screen.getByLabelText('前の月'))
    expect(onChange).toHaveBeenCalledWith('2026-01')

    onChange.mockClear()
    fireEvent.click(screen.getByLabelText('次の月'))
    expect(onChange).toHaveBeenCalledWith('2026-03')
  })

  it('crosses a year boundary without landing on month zero', () => {
    const onChange = vi.fn()
    render(picker({ value: '2026-01', onChange }))

    fireEvent.click(screen.getByLabelText('前の月'))

    expect(onChange).toHaveBeenCalledWith('2025-12')
  })

  it('opens the year and month dropdowns from the label', () => {
    render(picker())

    fireEvent.click(screen.getByLabelText('対象の月・月を選ぶ'))

    // Two: a year and a month. The jump nobody wants to click twelve times.
    expect(document.querySelectorAll('select')).toHaveLength(2)
  })

  it('never falls back to a free-form month input', () => {
    // `type="month"` renders as a locale-dependent native control that some
    // browsers make a text box, which is what these selects replaced.
    const markup = renderToStaticMarkup(picker())

    expect(markup).not.toContain('type="month"')
  })

  it('shows Japanese operator copy beside the picker for an invalid candidate', () => {
    const markup = renderToStaticMarkup(picker({ error: 'invalid' }))

    expect(markup).toContain('年と月を正しく選んでください。')
    expect(markup).not.toContain('yearMonth')
  })

  it('drops the field label for a screen whose panel already names the month', () => {
    const withLabel = renderToStaticMarkup(picker())
    const without = renderToStaticMarkup(picker({ hideLabel: true }))

    expect(withLabel).toContain('対象の月')
    // The group keeps the name for screen readers even when it is not drawn.
    expect(without).toContain('aria-label="対象の月"')
    expect(without.match(/対象の月/g)).toHaveLength(2)
  })
})
