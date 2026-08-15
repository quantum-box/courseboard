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

const courseId = 'golfcrs-makomanai'

/**
 * A month with one impossible half-day: 2 caddie-attached groups out of 1.
 * Everything else is consistent, so the screen has something to import and one
 * thing to point at.
 */
const previewPayload = {
  sourceSystem: 'daily-reservation-status',
  sourceFileSha256: 'sha',
  normalizedFingerprint: 'fingerprint',
  facilities: [{ sourceCourseKey: '真駒内', sourceCourseName: '真駒内' }],
  rows: [
    {
      sourceCourseKey: '真駒内',
      sourceCourseName: '真駒内',
      date: '2026-07-18',
      dayPart: 'morning' as const,
      groupCount: 1,
      caddieAttachedGroupCount: 2,
    },
    {
      sourceCourseKey: '真駒内',
      sourceCourseName: '真駒内',
      date: '2026-07-18',
      dayPart: 'afternoon' as const,
      groupCount: 6,
      caddieAttachedGroupCount: 2,
    },
  ],
  totals: { facilityCount: 1, rowCount: 2, groupCount: 7, caddieAttachedGroupCount: 4 },
  review: [
    {
      kind: 'caddieExceedsGroups',
      sourceCourseName: '真駒内',
      date: '2026-07-18',
      dayPart: 'morning' as const,
      groupCount: 1,
      caddieAttachedGroupCount: 2,
    },
  ],
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

async function reachConfirmStage() {
  renderPage()
  const input = await screen.findByLabelText(/Excel・CSV・PDF/)
  const file = new File(['x'], 'report.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: /内容を確認する/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /月間表へ進む/ })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /月間表へ進む/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /この内容を保存する/ })).toBeTruthy())
}

describe('ReservationReportImportPage review notice', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    api.json.mockReset()
    api.json.mockImplementation(async (path: string) => {
      if (path === '/v1/course/courses') {
        return { items: [{ id: courseId, name: '真駒内', isActive: true }] }
      }
      if (path.startsWith('/v1/course/reservation-report-entries')) return { items: [] }
      if (path === '/v1/course/reservation-report-imports/preview') return previewPayload
      if (path === '/v1/course/reservation-report-imports') {
        return {
          createdCount: 2,
          updatedCount: 0,
          unchangedCount: 0,
          totals: previewPayload.totals,
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
  })

  afterEach(cleanup)

  it('names the half-day the report contradicts itself on, without blocking the import', async () => {
    await reachConfirmStage()

    expect(screen.getByText('確認が必要な日があります')).toBeTruthy()
    expect(screen.getByText(/キャディ付き2組が全体の1組を超えています/)).toBeTruthy()
    // Flagged, not blocked: saving is still the primary action.
    const save = screen.getByRole('button', { name: /この内容を保存する/ }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it('keeps the flagged half-day visible after the import', async () => {
    await reachConfirmStage()
    fireEvent.click(screen.getByRole('button', { name: /この内容を保存する/ }))

    // The counts are in, and the half-day still has to be compared against the
    // original report — so the notice outlives the preview it came from.
    await waitFor(() => expect(screen.getAllByText('保存しました').length).toBeGreaterThan(0))
    expect(screen.getByText(/キャディ付き2組が全体の1組を超えています/)).toBeTruthy()
  })
})
