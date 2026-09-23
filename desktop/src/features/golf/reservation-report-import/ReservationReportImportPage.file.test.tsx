/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../../../i18n'
import { PageReloadProvider } from '../../../lib/pageReload'
import { ReservationReportImportPage } from './ReservationReportImportPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

const EMPTY = 'まだ選んでいません。'
const MUST_CHOOSE = '表ファイルを選んでください。'

function renderPage() {
  render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ReservationReportImportPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

async function chooseFile(name = 'report.xlsx') {
  const input = await screen.findByLabelText(/Excel・CSV・PDF/)
  const file = new File(['x'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ReservationReportImportPage file selection', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    api.json.mockReset()
    api.json.mockImplementation(async (path: string) => {
      if (path === '/v1/course/courses') return { items: [] }
      if (path.startsWith('/v1/course/reservation-report-entries')) return { items: [] }
      throw new Error(`unexpected path ${path}`)
    })
  })

  afterEach(cleanup)

  it('reads as a different state once a file is chosen', async () => {
    renderPage()
    expect(await screen.findByText(EMPTY)).toBeTruthy()
    expect(screen.getByRole('button', { name: /表ファイルを選ぶ/ })).toBeTruthy()

    await chooseFile('日別予約状況.xlsx')

    // The name stands on its own instead of being folded into the same muted
    // sentence the empty state uses.
    expect(screen.getByText('日別予約状況.xlsx')).toBeTruthy()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.getByRole('button', { name: /別のファイルを選ぶ/ })).toBeTruthy()
  })

  it('clears back to the untouched state rather than to the error', async () => {
    renderPage()
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: /選択を取り消す/ }))

    expect(screen.getByText(EMPTY)).toBeTruthy()
    // Clearing is deliberate, so the "choose a file" sentence stays a
    // placeholder and never doubles as a validation error here.
    expect(screen.queryByText(MUST_CHOOSE)).toBeNull()
  })

  it('still refuses to preview an empty form', async () => {
    renderPage()
    const preview = await screen.findByRole('button', { name: /内容を確認する/ })
    fireEvent.click(preview)

    expect(screen.getByText(MUST_CHOOSE)).toBeTruthy()
  })
})
