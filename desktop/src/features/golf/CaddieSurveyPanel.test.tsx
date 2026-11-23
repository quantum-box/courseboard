/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CaddieSurveyPanel, type CaddieSurvey } from './CaddieSurveyPanel'
import { isSurveyRating } from './CaddiesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

const READY: CaddieSurvey = {
  state: 'ready',
  caddieCount: 3,
  form: {
    id: 'form_1',
    publicId: 'pub_1',
    status: 'published',
    hasUnpublishedChanges: false,
    publicUrl: 'https://field.test/v1/public/forms/pub_1/frame',
    publishedCaddieCount: 2,
    caddiesChanged: true,
  },
}

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CaddieSurveyPanel />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CaddieSurveyPanel', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    api.json.mockReset()
  })

  afterEach(() => cleanup())

  it('says plainly when the tenant does not have Field forms', async () => {
    api.json.mockResolvedValue({ state: 'formsUnavailable', caddieCount: 0, form: null })
    renderPanel()
    expect(await screen.findByText('アンケートはまだ使えません')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /アンケートを作って公開する/ })).toBeNull()
  })

  it('creates and publishes the survey, then shows its QR code', async () => {
    let created = false
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/caddie-survey' && init?.method === 'POST') {
        created = true
        return { ...READY, form: { ...READY.form!, caddiesChanged: false } }
      }
      if (path === '/v1/course/caddie-survey') {
        return created
          ? { ...READY, form: { ...READY.form!, caddiesChanged: false } }
          : { state: 'notCreated', caddieCount: 3, form: null }
      }
      throw new Error(`unexpected ${path}`)
    })
    renderPanel()
    expect(await screen.findByText(/今の名簿から 3 人/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /アンケートを作って公開する/ }))

    expect(await screen.findByText(READY.form!.publicUrl)).toBeTruthy()
    expect(screen.getByTestId('caddie-survey-qr').querySelector('svg')).toBeTruthy()
    expect(screen.getByText('受付中')).toBeTruthy()
    expect(api.json).toHaveBeenCalledWith('/v1/course/caddie-survey', { method: 'POST' })
  })

  it('warns when the roster changed and republishes from it', async () => {
    let refreshed = false
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/caddie-survey/refresh' && init?.method === 'POST') {
        refreshed = true
        return READY
      }
      if (path === '/v1/course/caddie-survey') {
        return refreshed
          ? { ...READY, form: { ...READY.form!, publishedCaddieCount: 3, caddiesChanged: false } }
          : READY
      }
      throw new Error(`unexpected ${path}`)
    })
    renderPanel()
    expect(await screen.findByText('キャディの一覧が変わりました')).toBeTruthy()
    expect(screen.getByText(/選べるのは 2 人ですが、今の名簿では 3 人/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /名簿に合わせて公開し直す/ }))

    await waitFor(() => expect(screen.queryByText('キャディの一覧が変わりました')).toBeNull())
    expect(screen.getByText('今のアンケートでは 3 人から選べます。')).toBeTruthy()
  })
})

describe('isSurveyRating', () => {
  it('tells a survey answer from a rating taken with a booking', () => {
    expect(isSurveyRating({ customerId: 'field-form:9f2c' })).toBe(true)
    expect(isSurveyRating({ customerId: 'cus_01' })).toBe(false)
  })
})
