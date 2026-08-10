import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CoursesPage } from './CoursesPage'

function renderPage() {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CoursesPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CoursesPage', () => {
  afterEach(async () => {
    await i18next.changeLanguage('ja')
    vi.unstubAllGlobals()
  })

  it.each([
    ['ja', 'コースを追加'],
    ['ja-plain', 'コースを登録する'],
    ['en', 'Add a course'],
  ])('starts with the %s course list and a localized sheet trigger', async (locale, addLabel) => {
    vi.stubGlobal('React', React)
    vi.stubGlobal('navigator', { userAgent: 'Chrome' })
    await i18next.changeLanguage(locale)

    const markup = renderPage()

    expect(markup).toContain(`${addLabel}</button>`)
    expect(markup).toContain('course-add-button')
    expect(markup).not.toContain('<form')
  })
})
