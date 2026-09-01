/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { CaddieDutiesPanel } from './CaddieDutyBoard'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const DATE = '2026-08-29'

const calls: Array<{ path: string; init?: RequestInit }> = []

const profiles = [
  { id: 'cp_1', displayName: '佐藤 彩', employmentStatus: 'active' },
  { id: 'cp_2', displayName: '高橋 浩', employmentStatus: 'active' },
]

/** One caddie free all day, one out on a morning round. */
const assignments = [
  {
    caddieProfileId: 'cp_2',
    reservationId: 'rsv_1',
    status: 'assigned',
    scheduledAt: `${DATE}T07:00:00+09:00`,
  },
]

let filedDuties: Array<Record<string, unknown>> = []

function answer(path: string) {
  if (path.startsWith('/v1/course/caddie-duty-assignments')) return { items: filedDuties }
  if (path.startsWith('/v1/course/caddie-shifts')) {
    return {
      items: [
        { caddieProfileId: 'cp_1', date: DATE, isWorking: true },
        { caddieProfileId: 'cp_2', date: DATE, isWorking: true },
      ],
    }
  }
  if (path.startsWith('/v1/course/caddie-duties')) return { items: ['コース整備', '練習場'] }
  return { items: [] }
}

function renderPanel(onChanged = vi.fn(), onSummaryChange = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18next}>
      <CaddieDutiesPanel
        date={DATE}
        profiles={profiles}
        assignments={assignments}
        onChanged={onChanged}
        onSummaryChange={onSummaryChange}
      />
    </I18nextProvider>,
  )
}

async function openSheet() {
  await waitFor(() => expect(screen.getByRole('button', { name: '別業務にする' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '別業務にする' }))
  await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1))
}

describe('CaddieDutiesPanel', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    calls.length = 0
    filedDuties = []
    api.json.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return answer(path)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.restoreAllMocks()
  })

  it('counts the caddies who still have hours going spare', async () => {
    renderPanel()

    // Both are in: the morning round only takes half of one caddie's day.
    await waitFor(() =>
      expect(screen.getByText('手の空いている時間があるキャディ 2人')).toBeTruthy())
  })

  it('counts a caddie with two duties as one person in the day summary', async () => {
    filedDuties = [
      {
        id: 'duty_morning',
        caddieProfileId: 'cp_1',
        date: DATE,
        dutyLabel: 'コース整備',
        startTime: '08:00',
        endTime: '10:00',
        allDay: false,
      },
      {
        id: 'duty_afternoon',
        caddieProfileId: 'cp_1',
        date: DATE,
        dutyLabel: '練習場',
        startTime: '13:00',
        endTime: '15:00',
        allDay: false,
      },
    ]
    const onSummaryChange = vi.fn()
    renderPanel(vi.fn(), onSummaryChange)

    await waitFor(() => expect(onSummaryChange).toHaveBeenCalledWith({ dutyCount: 1, freeCount: 1 }))
  })

  it('files the whole day when the desk leaves the hours alone', async () => {
    const onChanged = vi.fn()
    renderPanel(onChanged)
    await openSheet()

    const [caddiePicker, dutyPicker] = screen.getAllByRole('combobox')
    fireEvent.change(caddiePicker!, { target: { value: 'cp_1' } })
    fireEvent.change(dutyPicker!, { target: { value: 'コース整備' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const filed = calls.find(call => call.init?.method === 'POST')
    expect(filed?.path).toBe('/v1/course/caddie-duty-assignments')
    expect(JSON.parse(String(filed?.init?.body))).toEqual({
      caddieProfileId: 'cp_1',
      date: DATE,
      dutyLabel: 'コース整備',
      note: null,
    })
  })

  it('files the named hours when the desk clears “終日”', async () => {
    const onChanged = vi.fn()
    renderPanel(onChanged)
    await openSheet()

    const [caddiePicker, dutyPicker] = screen.getAllByRole('combobox')
    fireEvent.change(caddiePicker!, { target: { value: 'cp_1' } })
    fireEvent.change(dutyPicker!, { target: { value: 'コース整備' } })
    fireEvent.click(screen.getByRole('checkbox'))

    const [from, to] = screen.getAllByDisplayValue(/^\d{2}:\d{2}$/)
    fireEvent.change(from!, { target: { value: '13:00' } })
    fireEvent.change(to!, { target: { value: '17:00' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const filed = calls.find(call => call.init?.method === 'POST')
    expect(JSON.parse(String(filed?.init?.body))).toMatchObject({
      caddieProfileId: 'cp_1',
      startTime: '13:00',
      endTime: '17:00',
    })
  })

  it('refuses hours a round already runs through, and says why', async () => {
    renderPanel()
    await openSheet()

    const [caddiePicker, dutyPicker] = screen.getAllByRole('combobox')
    // cp_2 is out on the 07:00 round, which runs to 11:30.
    fireEvent.change(caddiePicker!, { target: { value: 'cp_2' } })
    fireEvent.change(dutyPicker!, { target: { value: 'コース整備' } })
    fireEvent.click(screen.getByRole('checkbox'))

    const [from, to] = screen.getAllByDisplayValue(/^\d{2}:\d{2}$/)
    fireEvent.change(from!, { target: { value: '09:00' } })
    fireEvent.change(to!, { target: { value: '10:00' } })

    await waitFor(() =>
      expect(screen.getByText(/その時間には別の業務かラウンドが入っています/)).toBeTruthy())
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    expect(calls.some(call => call.init?.method === 'POST')).toBe(false)
  })

  it('clears one filed stretch by its own id', async () => {
    filedDuties = [
      {
        id: 'duty_1',
        caddieProfileId: 'cp_1',
        date: DATE,
        dutyLabel: 'コース整備',
        startTime: '08:00',
        endTime: '12:00',
        allDay: false,
        note: '9番ホール',
      },
    ]
    const onChanged = vi.fn()
    renderPanel(onChanged)

    await waitFor(() => expect(screen.getByText('08:00–12:00')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '解除' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const cleared = calls.find(call => call.init?.method === 'DELETE')
    expect(cleared?.path).toBe('/v1/course/caddie-duty-assignments/duty_1')
  })
})
