/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const PREVIEW_PATH = '/v1/course/reservation-report-imports/preview'

const previewPayload = {
  sourceSystem: 'tabular_analyze',
  sourceFileSha256: 'sha',
  normalizedFingerprint: 'fingerprint',
  facilities: [{ sourceCourseKey: '真駒内', sourceCourseName: '真駒内' }],
  rows: [
    {
      sourceCourseKey: '真駒内',
      sourceCourseName: '真駒内',
      date: '2026-07-18',
      dayPart: 'morning' as const,
      groupCount: 6,
      caddieAttachedGroupCount: 2,
    },
  ],
  totals: { facilityCount: 1, rowCount: 1, groupCount: 6, caddieAttachedGroupCount: 2 },
}

function renderPage() {
  render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ReservationReportImportPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

async function chooseFile(name: string, type: string) {
  const input = await screen.findByLabelText(/Excel・CSV・PDF/)
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type })] } })
}

function previewForm() {
  const call = api.json.mock.calls.find(([path]) => path === PREVIEW_PATH)
  return call?.[1].body as FormData
}

describe('ReservationReportImportPage PDF orientation', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    api.json.mockReset()
    api.json.mockImplementation(async (path: string) => {
      if (path === '/v1/course/courses') return { items: [] }
      if (path.startsWith('/v1/course/reservation-report-entries')) return { items: [] }
      if (path === PREVIEW_PATH) return previewPayload
      throw new Error(`unexpected path ${path}`)
    })
  })

  afterEach(cleanup)

  /** Turning the page only applies to a scan, so a workbook must not offer it. */
  it('offers the orientation only for a PDF', async () => {
    renderPage()
    await chooseFile('report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(screen.queryByLabelText(/PDFの向き/)).toBeNull()

    await chooseFile('report.pdf', 'application/pdf')
    expect(screen.getByLabelText(/PDFの向き/)).toBeTruthy()
  })

  it('sends the chosen orientation with the analysis', async () => {
    renderPage()
    await chooseFile('report.pdf', 'application/pdf')
    fireEvent.change(screen.getByLabelText(/PDFの向き/), { target: { value: '270' } })
    fireEvent.click(screen.getByRole('button', { name: /内容を確認する/ }))

    await waitFor(() => expect(previewForm()).toBeTruthy())
    expect(previewForm().get('rotation')).toBe('270')
  })

  /** Field rejects multipart fields it does not know, so a page that is not
   * turned must not name the field at all. */
  it('leaves the field off when the page is not turned', async () => {
    renderPage()
    await chooseFile('report.pdf', 'application/pdf')
    fireEvent.click(screen.getByRole('button', { name: /内容を確認する/ }))

    await waitFor(() => expect(previewForm()).toBeTruthy())
    expect(previewForm().has('rotation')).toBe(false)
  })

  /** A different file is a different scan; keeping the last turn would read it
   * sideways without saying so. */
  it('forgets the orientation when another file is chosen', async () => {
    renderPage()
    await chooseFile('report.pdf', 'application/pdf')
    fireEvent.change(screen.getByLabelText(/PDFの向き/), { target: { value: '180' } })
    await chooseFile('other.pdf', 'application/pdf')

    expect((screen.getByLabelText(/PDFの向き/) as HTMLSelectElement).value).toBe('0')
  })
})
