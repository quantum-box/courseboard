/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { today } from '../../../lib/clock'
import { PageReloadProvider } from '../../../lib/pageReload'
import { LedgerPage } from './LedgerPage'
import type { TeeLedgerResponse } from './models'

// The page defaults to today's date on the tenant's clock (no date is fixed
// via the URL in this test), so the expected query params follow suit rather
// than a hard-coded day.
const todayDate = today()

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

let ledgerBody: TeeLedgerResponse = {
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
let generatedThrough: string | null = null

beforeEach(async () => {
  await i18next.changeLanguage('ja')
  clearResourceCache()
  releaseLedger = null
  generatedThrough = null
  ledgerBody = {
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
    if (path.startsWith('/v1/course/booking-horizon')) {
      return Promise.resolve({
        bookableThrough: '2027-02-19',
        generatedThrough: { 'course-east': generatedThrough },
      })
    }
    if (path.startsWith('/v1/course/extension-status')) return Promise.resolve(null)
    if (path.startsWith('/v1/course/caddie-assignments')) return Promise.resolve({ items: [] })
    if (path.startsWith('/v1/course/caddie-shifts')) return Promise.resolve({ items: [] })
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

  it("requests the day's caddie assignments and confirmed shifts for a matching from/to range", async () => {
    // useResource swallows a thrown assertion into its own `error` state, so
    // asserting inside the mock (as this test used to) never fails the test
    // even if the fetch it is supposed to check is deleted entirely. The
    // check has to run against the mock's call log, outside the loader.
    renderPage()
    releaseLedger?.()

    await waitFor(() => {
      expect(
        api.json.mock.calls.some(
          call => typeof call[0] === 'string' && call[0].startsWith('/v1/course/caddie-assignments'),
        ),
      ).toBe(true)
      expect(
        api.json.mock.calls.some(
          call => typeof call[0] === 'string' && call[0].startsWith('/v1/course/caddie-shifts'),
        ),
      ).toBe(true)
    })

    const assignmentsPath = api.json.mock.calls
      .map(call => call[0])
      .find((path): path is string => typeof path === 'string' && path.startsWith('/v1/course/caddie-assignments'))
    const shiftsPath = api.json.mock.calls
      .map(call => call[0])
      .find((path): path is string => typeof path === 'string' && path.startsWith('/v1/course/caddie-shifts'))

    expect(assignmentsPath).toContain(`from=${todayDate}`)
    expect(assignmentsPath).toContain(`to=${todayDate}`)
    expect(shiftsPath).toContain(`from=${todayDate}`)
    expect(shiftsPath).toContain(`to=${todayDate}`)
  })

  it('warns when weekly hours exist but the course has no generated inventory', async () => {
    ledgerBody = {
      ...ledgerBody,
      columns: ledgerBody.columns.map(column => ({
        ...column,
        gridSource: 'schedule',
        openSlotCount: 0,
        slots: column.slots.map(slot => ({
          ...slot,
          capacity: null,
          availableGroups: null,
          isSellable: false,
        })),
      })),
    }
    renderPage()
    releaseLedger?.()

    expect(await screen.findByText(
      '東コースは2027年2月19日まで受ける設定ですが、スタート枠はまだ作られていません。',
    )).toBeTruthy()
  })

  it('warns when generated inventory stops before the configured edge', async () => {
    generatedThrough = '2027-02-01'
    renderPage()
    releaseLedger?.()

    expect(await screen.findByText(
      '東コースは2027年2月19日まで受ける設定ですが、スタート枠は2027年2月1日までしか作られていません。',
    )).toBeTruthy()
  })
})
