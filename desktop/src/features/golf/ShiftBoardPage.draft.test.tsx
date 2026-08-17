/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { ShiftBoardPage } from './ShiftBoardPage'
import type { ConfirmedShift } from './shiftBoard'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const CADDIE = 'caddie-a'
const MONTH = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
}).format(new Date()).slice(0, 7)
const FIRST_DAY = `${MONTH}-01`

/** The one confirmed day the board starts with: the caddie is off. */
const confirmed: ConfirmedShift = {
  caddieProfileId: CADDIE,
  date: FIRST_DAY,
  golfCourseId: null,
  isWorking: false,
  span: 'full_day',
  roundsCapacity: 0,
  origin: 'generated',
  note: null,
}

/** What the run proposes for that day instead: working, on the east course. */
const proposed: ConfirmedShift = {
  ...confirmed,
  golfCourseId: 'course-east',
  isWorking: true,
  roundsCapacity: 1,
}

const calls: Array<{ path: string; method: string }> = []

beforeEach(() => {
  clearResourceCache()
  calls.length = 0
  api.json.mockReset()
  api.json.mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? 'GET' })
    if (path === '/v1/course/caddie-profiles') {
      return { items: [{ id: CADDIE, displayName: '高田 卓哉', employmentStatus: 'active' }] }
    }
    if (path.startsWith('/v1/course/caddie-availabilities?')) return { items: [] }
    if (path.startsWith('/v1/course/caddie-assignments?')) return { items: [] }
    if (path.startsWith('/v1/course/caddie-shifts?')) return { items: [confirmed] }
    if (path.startsWith('/v1/course/caddie-availability-deadlines/')) return null
    if (path.startsWith('/v1/course/caddie-availability-submissions/')) return { items: [] }
    if (path === '/v1/course/courses') {
      return { items: [{ id: 'course-east', name: '東コース', shortName: '東' }] }
    }
    if (path === '/v1/course/caddie-shift-rules') {
      return {
        avoidedRestWeekdays: [],
        maxConsecutiveWorkDays: 6,
        maxRoundsPerDay: 2,
        minRestDaysPerMonth: 0,
        unfiledRequest: 'working',
        statutoryMaxConsecutiveWorkDays: 6,
        maxRoundsCeiling: 2,
      }
    }
    if (path.endsWith('/preview') && init?.method === 'POST') {
      return {
        summary: {
          yearMonth: MONTH,
          daysWritten: 1,
          pinnedKept: 0,
          unplaced: [],
          statutoryRestDays: 0,
          overworked: [],
          deadlineWarning: null,
        },
        shifts: [proposed],
      }
    }
    if (path.startsWith('/v1/course/caddie-shift-plans/') && init?.method === 'POST') {
      return {
        yearMonth: MONTH,
        daysWritten: 1,
        pinnedKept: 0,
        unplaced: [],
        statutoryRestDays: 0,
        overworked: [],
        deadlineWarning: null,
      }
    }
    throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
  })
})

afterEach(cleanup)

function renderBoard() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ShiftBoardPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

function firstDayCell() {
  return screen.getByLabelText(new RegExp(`${FIRST_DAY}`)).closest('td') as HTMLTableCellElement
}

describe('planning a month before confirming it', () => {
  it('draws the plan without writing anything, and writes it only when asked', async () => {
    renderBoard()
    await waitFor(() => expect(firstDayCell().dataset.kind).toBe('off'))

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.action') }))

    // The board now shows the proposed day, marked as one the plan changes,
    // and nothing has been confirmed.
    await waitFor(() => expect(firstDayCell().dataset.kind).toBe('available'))
    expect(firstDayCell().dataset.draftChange).toBe('true')
    expect(calls.filter(call => call.method === 'POST')).toEqual([
      { path: `/v1/course/caddie-shift-plans/${MONTH}/preview`, method: 'POST' },
    ])

    // A day cannot be edited while the month it belongs to is only proposed.
    const dayButton = screen.getByLabelText(new RegExp(FIRST_DAY)) as HTMLButtonElement
    expect(dayButton.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.apply') }))

    await waitFor(() => {
      expect(calls.some(call =>
        call.method === 'POST' && call.path === `/v1/course/caddie-shift-plans/${MONTH}`)).toBe(true)
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: i18next.t('shifts:draft.apply') })).toBeNull())
  })

  it('throws the plan away and leaves the confirmed month as it was', async () => {
    renderBoard()
    await waitFor(() => expect(firstDayCell().dataset.kind).toBe('off'))

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.action') }))
    await waitFor(() => expect(firstDayCell().dataset.kind).toBe('available'))

    fireEvent.click(screen.getByRole('button', { name: i18next.t('shifts:draft.discard') }))

    await waitFor(() => expect(firstDayCell().dataset.kind).toBe('off'))
    expect(firstDayCell().dataset.draftChange).toBeUndefined()
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
  })
})
