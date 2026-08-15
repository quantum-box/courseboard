/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { PageReloadProvider } from '../../../lib/pageReload'
import { LedgerPage } from './LedgerPage'
import type { TeeLedgerResponse } from './models'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

const ledgerBody: TeeLedgerResponse = {
  date: '2026-07-20',
  timezone: 'Asia/Tokyo',
  columns: [
    {
      golfCourseId: 'course-east',
      courseName: '東コース',
      gridSource: 'inventory',
      groupCount: 0,
      playerCount: 0,
      selfGroupCount: 0,
      caddieGroupCount: 0,
      openSlotCount: 1,
      slots: [
        {
          teeTime: '07:00',
          capacity: 2,
          availableGroups: 2,
          bookedGroups: 0,
          playerCount: 0,
          isActive: true,
          isSellable: true,
          items: [],
        },
      ],
    },
  ],
  unavailable: [],
}

/** Held open so the page can be inspected while the day is still on the way. */
let releaseLedger: (() => void) | null = null

beforeEach(() => {
  clearResourceCache()
  releaseLedger = null
  api.json.mockImplementation((path: string) => {
    if (path.startsWith('/v1/course/tee-ledger')) {
      return new Promise(resolve => {
        releaseLedger = () => resolve(ledgerBody)
      })
    }
    if (path.startsWith('/v1/course/courses')) {
      return Promise.resolve({ items: [{ id: 'course-east', name: '東コース' }] })
    }
    if (path.startsWith('/v1/course/course-order')) {
      return Promise.resolve({ golfCourseIds: ['course-east'] })
    }
    if (path.startsWith('/v1/course/reservation-products')) return Promise.resolve({ items: [] })
    if (path.startsWith('/v1/course/extension-status')) return Promise.resolve(null)
    throw new Error(`unexpected request: ${path}`)
  })
})

afterEach(() => {
  cleanup()
  api.json.mockReset()
})

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <PageReloadProvider>
          <LedgerPage />
        </PageReloadProvider>
      </TooltipProvider>
    </I18nextProvider>,
  )
}

describe('LedgerPage while the day is still loading', () => {
  it('keeps the date controls usable instead of blanking the page', async () => {
    // The board is one Field round trip per course plus the whole booking list.
    // Replacing the page with a spinner took the date away from the desk for as
    // long as that took, so a mistyped day could not be corrected until the
    // wrong one had finished loading.
    renderPage()

    expect(
      screen.getByLabelText(i18next.t('timeline:toolbar.prevDay')),
    ).toBeTruthy()
    expect(screen.getByText(i18next.t('ledger:courses.all'))).toBeTruthy()
  })

  it('stands in for the board and swaps it for the real rows', async () => {
    renderPage()

    const pending = screen.getByRole('status', { name: i18next.t('ledger:loading') })
    expect(pending).toBeTruthy()

    releaseLedger?.()

    await waitFor(() => {
      expect(
        screen.queryByRole('status', { name: i18next.t('ledger:loading') }),
      ).toBeNull()
    })
    expect(screen.getByRole('region', { name: '東コース' })).toBeTruthy()
    expect(screen.getByText('07:00')).toBeTruthy()
  })
})
