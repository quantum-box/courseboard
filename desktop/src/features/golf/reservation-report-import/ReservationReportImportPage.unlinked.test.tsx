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

const facility = {
  sourceCourseKey: 'source-facility-a',
  sourceCourseName: '未登録施設A',
}

const row = {
  ...facility,
  date: '2026-07-10',
  dayPart: 'morning' as const,
  groupCount: 4,
  caddieAttachedGroupCount: 1,
}

const preview = {
  sourceSystem: 'test-report',
  sourceFileSha256: 'test-sha',
  normalizedFingerprint: 'test-fingerprint',
  facilities: [facility],
  rows: [row],
  totals: { facilityCount: 1, rowCount: 1, groupCount: 4, caddieAttachedGroupCount: 1 },
  review: [],
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ReservationReportImportPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('ReservationReportImportPage unlinked facilities', () => {
  let imported = false

  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/golf/reservation-report-import')
    imported = false
    api.json.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/courses' && !init?.method) return { items: [] }
      if (path.startsWith('/v1/course/reservation-report-entries')) {
        return {
          items: imported ? [{
            ...row,
            id: 'report-entry-a',
            golfCourseId: null,
            sourceFileSha256: 'test-sha',
            updatedAt: '2026-07-10T00:00:00Z',
          }] : [],
        }
      }
      if (path === '/v1/course/reservation-report-imports/preview') return preview
      if (path === '/v1/course/reservation-report-imports') {
        const body = init?.body as FormData
        expect(JSON.parse(String(body.get('courseMappings')))).toEqual({})
        imported = true
        return {
          createdCount: 1,
          updatedCount: 0,
          unchangedCount: 0,
          totals: preview.totals,
        }
      }
      throw new Error(`unexpected call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(cleanup)

  it('saves without a course, keeps the facility visible, and only links to registration', async () => {
    renderPage()
    const input = await screen.findByLabelText(/Excel・CSV・PDF/)
    fireEvent.change(input, {
      target: {
        files: [new File(['test'], 'report.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /内容を確認する/ }))

    const continueButton = await screen.findByRole('button', { name: /月間表へ進む/ })
    expect(screen.getByText('未紐づけ')).toBeTruthy()
    fireEvent.click(continueButton)

    const saveButton = await screen.findByRole('button', { name: /この内容を保存する/ })
    expect(screen.getByText('コースに紐づけない施設があります')).toBeTruthy()
    fireEvent.click(saveButton)

    await waitFor(() => expect(screen.getByText('未紐づけの施設も保存しました')).toBeTruthy())
    expect(screen.getAllByText(facility.sourceCourseName).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getAllByText('未紐づけ').length).toBeGreaterThan(0))
    expect(api.json.mock.calls.some(([path, init]) => (
      path === '/v1/course/courses' && init?.method === 'POST'
    ))).toBe(false)

    fireEvent.click(screen.getAllByRole('button', { name: /この名前でコースを登録/ })[0]!)
    expect(window.location.pathname).toBe('/golf/courses')
    expect(new URLSearchParams(window.location.search).get('courseName')).toBe(facility.sourceCourseName)
  }, 15_000)
})
