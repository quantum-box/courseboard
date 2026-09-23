/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { AvailabilityCalendar } from './CaddiesPage'

const api = vi.hoisted(() => ({
  json: vi.fn(),
  text: vi.fn(),
}))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return {
    ...actual,
    courseboardApiJson: api.json,
    courseboardApiText: api.text,
  }
})

type SavedAvailability = {
  id: string
  caddieProfileId: string
  date: string
  status: string
  twoRoundRequest: boolean
  healthNote: string | null
  updatedAt: string
}

const profile = {
  id: 'caddie-range-test',
  displayName: 'Range test caddie',
  skillLevel: 'rookie' as const,
  employmentStatus: 'active',
  baseFeeAmount: 0,
  currency: 'JPY',
  maxRoundsPerDay: 1,
  ratingCount: 0,
}

function renderCalendar() {
  return render(
    <I18nextProvider i18n={i18next}>
      <AvailabilityCalendar
        profile={profile}
        setFlash={vi.fn()}
        onDirtyChange={vi.fn()}
      />
    </I18nextProvider>,
  )
}

describe('AvailabilityCalendar range entry flow', () => {
  const saved = new Map<string, SavedAvailability>()
  const postBodies: Array<Omit<SavedAvailability, 'id' | 'updatedAt'>> = []

  beforeEach(() => {
    clearResourceCache()
    saved.clear()
    postBodies.length = 0
    api.json.mockReset()
    api.text.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/extension-status') {
        return { configJson: { timezone: 'Asia/Tokyo' } }
      }
      if (path.startsWith('/v1/course/caddie-availabilities?')) {
        return { items: [...saved.values()] }
      }
      if (path === '/v1/course/caddie-availabilities' && init?.method === 'POST') {
        const input = JSON.parse(String(init.body)) as Omit<SavedAvailability, 'id' | 'updatedAt'>
        postBodies.push(input)
        const record = {
          ...input,
          id: `availability-${input.date}`,
          updatedAt: '2026-08-10T00:00:00Z',
        }
        saved.set(record.date, record)
        return record
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  it('saves one day through the real Sheet and reads it back on a fresh mount', async () => {
    const yearMonth = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date())
    const selectedDate = `${yearMonth}-20`
    const firstRender = renderCalendar()

    fireEvent.click(await screen.findByRole('button', {
      name: `${selectedDate} の希望を入れる`,
    }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /出られるかどうか/ }), {
      target: { value: 'morning_only' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /体調のメモ/ }), {
      target: { value: 'single day entry' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(postBodies).toEqual([{
      caddieProfileId: profile.id,
      date: selectedDate,
      status: 'morning_only',
      twoRoundRequest: false,
      healthNote: 'single day entry',
    }]))

    firstRender.unmount()
    clearResourceCache()
    renderCalendar()
    const reloadedDay = await screen.findByRole('button', {
      name: `${selectedDate} の希望を入れる`,
    })
    await waitFor(() => expect(reloadedDay.textContent).toContain('午前だけ'))
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('drops the two-round request when the day turns into one they cannot work', async () => {
    // Two rounds are only walked on a whole free day, so the form must not be
    // able to file the pair against a day off: the board drew a "2R" badge
    // beside somebody who had just said they cannot come, and the day's
    // caddie supply counted the request.
    const yearMonth = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date())
    const selectedDate = `${yearMonth}-21`
    renderCalendar()

    fireEvent.click(await screen.findByRole('button', {
      name: `${selectedDate} の希望を入れる`,
    }))
    const dialog = await screen.findByRole('dialog')
    const twoRounds = within(dialog).getByRole('checkbox', {
      name: /2ラウンドを希望する/,
    }) as HTMLInputElement

    fireEvent.click(twoRounds)
    expect(twoRounds.checked).toBe(true)
    expect(twoRounds.disabled).toBe(false)

    fireEvent.change(within(dialog).getByRole('combobox', { name: /出られるかどうか/ }), {
      target: { value: 'unavailable' },
    })
    expect(twoRounds.checked).toBe(false)
    expect(twoRounds.disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(postBodies).toEqual([{
      caddieProfileId: profile.id,
      date: selectedDate,
      status: 'unavailable',
      twoRoundRequest: false,
      healthNote: null,
    }]))
  })

  it('keeps the anchor after closing the Sheet and saves an expanded mixed range', async () => {
    const yearMonth = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date())
    const date = (day: number) => `${yearMonth}-${String(day).padStart(2, '0')}`
    const dayButton = (day: number) => screen.getByRole('button', {
      name: `${date(day)} の希望を入れる`,
    })

    const firstRender = renderCalendar()
    const first = await screen.findByRole('button', { name: `${date(10)} の希望を入れる` })

    // The existing one-day flow still opens the modal Sheet immediately.
    fireEvent.click(first)
    const oneDayDialog = await screen.findByRole('dialog')
    expect(within(oneDayDialog).getByRole('heading').textContent).toContain(date(10))

    // Closing the modal removes its overlay but deliberately keeps the anchor.
    fireEvent.click(within(oneDayDialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(dayButton(10).getAttribute('aria-pressed')).toBe('true')

    // Shift extends without reopening the modal, so the second calendar click
    // is reachable. Extending again includes already-selected days without
    // toggling holes and keeps the original plain-click anchor at day 10.
    fireEvent.click(dayButton(12), { shiftKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const day of [10, 11, 12]) {
      expect(dayButton(day).getAttribute('aria-pressed')).toBe('true')
    }
    fireEvent.click(dayButton(14), { shiftKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const day of [10, 11, 12, 13, 14]) {
      expect(dayButton(day).getAttribute('aria-pressed')).toBe('true')
    }
    expect(dayButton(9).getAttribute('aria-pressed')).toBe('false')
    expect(dayButton(15).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(`選択中: ${date(10)}〜${date(14)}（5日）`)).toBeTruthy()

    // The explicit range action opens one Sheet whose values are applied to
    // every selected date, rather than silently falling back to the anchor.
    fireEvent.click(screen.getByRole('button', { name: '選んだ日に希望を入れる' }))
    const rangeDialog = await screen.findByRole('dialog')
    expect(within(rangeDialog).getByRole('heading').textContent).toContain(
      `${date(10)}〜${date(14)}（5日）`,
    )
    fireEvent.change(within(rangeDialog).getByRole('combobox', { name: /出られるかどうか/ }), {
      target: { value: 'unavailable' },
    })
    fireEvent.change(within(rangeDialog).getByRole('textbox', { name: /体調のメモ/ }), {
      target: { value: 'range entry' },
    })
    fireEvent.click(within(rangeDialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(saved.size).toBe(5))
    expect(postBodies).toEqual([10, 11, 12, 13, 14].map(day => ({
      caddieProfileId: profile.id,
      date: date(day),
      status: 'unavailable',
      twoRoundRequest: false,
      healthNote: 'range entry',
    })))
    expect([...saved.values()].map(item => item.date)).toEqual([
      date(10),
      date(11),
      date(12),
      date(13),
      date(14),
    ])
    for (const item of saved.values()) {
      expect(item).toMatchObject({
        caddieProfileId: profile.id,
        status: 'unavailable',
        twoRoundRequest: false,
        healthNote: 'range entry',
      })
    }

    // A fresh mount reads the stored records again, fixing the persistence
    // path as part of the UI flow instead of only asserting helper output.
    firstRender.unmount()
    clearResourceCache()
    renderCalendar()
    await screen.findByRole('button', { name: `${date(10)} の希望を入れる` })
    await waitFor(() => {
      for (const day of [10, 11, 12, 13, 14]) {
        expect(dayButton(day).textContent).toContain('出られない')
      }
    })
  })
})
