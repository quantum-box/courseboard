/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { ReassignRoundSheet, type MovingAssignment } from './ReassignRoundSheet'
import type { MovableAssignment, MovableRoundRow } from './reassignRound'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const DATE = '2026-08-29'

const calls: Array<{ path: string; init?: RequestInit }> = []

const rounds: MovableRoundRow[] = [
  {
    id: 'rsv_1',
    reservationNumber: 'R-1',
    golfCourseId: 'course_out',
    courseName: 'OUT',
    teeTime: '2026-08-29T07:00:00+09:00',
    playType: 'caddie',
    partySize: 4,
    partyName: '佐藤様',
  },
  {
    id: 'rsv_2',
    reservationNumber: 'R-2',
    golfCourseId: 'course_out',
    courseName: 'OUT',
    teeTime: '2026-08-29T09:00:00+09:00',
    playType: 'caddie',
    partySize: 4,
    partyName: '鈴木様',
  },
]

const moving: MovingAssignment = {
  id: 'a_1',
  caddieProfileId: 'cp_1',
  reservationId: 'rsv_1',
  status: 'assigned',
  scheduledAt: '2026-08-29T07:00:00+09:00',
}

const caddieNames = new Map([
  ['cp_1', '佐藤 彩'],
  ['cp_2', '高橋 浩'],
])

function renderSheet({
  assignments = [moving as MovableAssignment],
  onMoveDone = vi.fn(),
}: { assignments?: MovableAssignment[]; onMoveDone?: () => void } = {}) {
  render(
    <I18nextProvider i18n={i18next}>
      <ReassignRoundSheet
        assignment={moving}
        date={DATE}
        rounds={rounds}
        assignments={assignments}
        caddieNames={caddieNames}
        onClose={vi.fn()}
        onMoveDone={onMoveDone}
      />
    </I18nextProvider>,
  )
  return { onMoveDone }
}

describe('ReassignRoundSheet', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    calls.length = 0
    api.json.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path.startsWith('/v1/course/caddie-recommendations')) {
        return { items: [{ caddieProfileId: 'cp_2', displayName: '高橋 浩' }] }
      }
      return {}
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.restoreAllMocks()
  })

  it('hands the group to another caddie without moving it', async () => {
    const { onMoveDone } = renderSheet()

    await waitFor(() => expect(screen.getByRole('option', { name: '高橋 浩' })).toBeTruthy())
    const [, caddiePicker] = screen.getAllByRole('combobox')
    fireEvent.change(caddiePicker!, { target: { value: 'cp_2' } })
    fireEvent.click(screen.getByRole('button', { name: '付け替える' }))

    await waitFor(() => expect(onMoveDone).toHaveBeenCalled())
    const moved = calls.find(call => call.init?.method === 'PUT')
    expect(moved?.path).toBe('/v1/course/caddie-assignments/a_1/reassignment')
    expect(JSON.parse(String(moved?.init?.body))).toEqual({
      date: DATE,
      caddieProfileId: 'cp_2',
      reservationId: 'rsv_1',
      scheduledAt: '2026-08-29T07:00:00+09:00',
    })
  })

  it('moves the same caddie to another group of the day', async () => {
    const { onMoveDone } = renderSheet()

    const [roundPicker] = screen.getAllByRole('combobox')
    fireEvent.change(roundPicker!, { target: { value: 'rsv_2' } })
    fireEvent.click(screen.getByRole('button', { name: '付け替える' }))

    await waitFor(() => expect(onMoveDone).toHaveBeenCalled())
    const moved = calls.find(call => call.init?.method === 'PUT')
    expect(JSON.parse(String(moved?.init?.body))).toMatchObject({
      caddieProfileId: 'cp_1',
      reservationId: 'rsv_2',
      scheduledAt: '2026-08-29T09:00:00+09:00',
    })
  })

  it('refuses a group another caddie is already on, and says why', async () => {
    renderSheet({
      assignments: [
        moving as MovableAssignment,
        { id: 'a_2', caddieProfileId: 'cp_2', reservationId: 'rsv_2', status: 'assigned' },
      ],
    })

    const [roundPicker] = screen.getAllByRole('combobox')
    fireEvent.change(roundPicker!, { target: { value: 'rsv_2' } })

    await waitFor(() =>
      expect(screen.getByText(/その組には別のキャディがいます/)).toBeTruthy())
    expect(screen.getByRole('button', { name: '付け替える' }).hasAttribute('disabled')).toBe(true)
    expect(calls.some(call => call.init?.method === 'PUT')).toBe(false)
  })

  it('keeps the save button off until something actually changes', async () => {
    renderSheet()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '付け替える' }).hasAttribute('disabled')).toBe(true))
  })
})
