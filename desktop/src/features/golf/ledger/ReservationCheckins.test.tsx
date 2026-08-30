/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { ReservationCheckins } from './ReservationCheckins'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

const players = [
  { name: '本田 康彦', customerId: 'cus-1' },
  { name: '佐藤 花子', customerId: 'cus-2' },
  { name: '同伴者' },
]

afterEach(() => {
  cleanup()
  api.json.mockReset()
})

function renderCheckins(overrides: Partial<Parameters<typeof ReservationCheckins>[0]> = {}) {
  render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <ReservationCheckins
          reservationId="rsv-1"
          players={players}
          dirty={false}
          {...overrides}
        />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

describe('checking a group in', () => {
  it('sends the seats that were ticked, with the ledger entry each one is linked to', async () => {
    // Per seat, not per booking: the point of the record is the people who
    // played in somebody else's group, and Field cannot hold those.
    api.json.mockResolvedValue({ items: [] })
    renderCheckins()
    await waitFor(() => expect(api.json).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('本田 康彦', { exact: false }))
    fireEvent.click(screen.getByText(i18next.t('ledger:checkin.submit', { count: 1 })))

    await waitFor(() => {
      const writes = api.json.mock.calls.filter(call => call[1]?.method === 'POST')
      expect(writes).toHaveLength(1)
      expect(JSON.parse(writes[0]![1].body)).toEqual({
        players: [{ playerIndex: 0, customerId: 'cus-1', playerName: '本田 康彦' }],
      })
    })
  })

  it('records a seat nobody has matched to the ledger rather than refusing it', async () => {
    // The busiest hour of the morning is the one where two of four names are
    // not yet anybody in particular. Refusing would leave it unrecorded.
    api.json.mockResolvedValue({ items: [] })
    renderCheckins()
    await waitFor(() => expect(api.json).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('同伴者', { exact: false }))
    fireEvent.click(screen.getByText(i18next.t('ledger:checkin.submit', { count: 1 })))

    await waitFor(() => {
      const writes = api.json.mock.calls.filter(call => call[1]?.method === 'POST')
      expect(JSON.parse(writes[0]![1].body).players[0]).toEqual({
        playerIndex: 2,
        customerId: null,
        playerName: '同伴者',
      })
    })
  })

  it('shows a seat already checked in as done instead of offering it again', async () => {
    api.json.mockResolvedValue({
      items: [
        {
          reservationId: 'rsv-1',
          playerIndex: 0,
          customerId: 'cus-1',
          playerName: '本田 康彦',
          playedOn: '2026-08-30',
          checkedInAt: '2026-08-29T22:14:00Z',
          checkedInBy: 'user-1',
        },
      ],
    })
    renderCheckins()

    await waitFor(() =>
      expect(screen.queryByLabelText('本田 康彦', { exact: false })).toBeNull(),
    )
    expect(screen.getByText('佐藤 花子', { exact: false })).toBeTruthy()
  })

  it('will not check anybody in while the roster above has unsaved edits', async () => {
    // Seats are numbered by the saved roster. Checking in against a draft
    // would file somebody under a seat the server has never seen.
    api.json.mockResolvedValue({ items: [] })
    renderCheckins({ dirty: true })
    await waitFor(() => expect(api.json).toHaveBeenCalled())

    const box = screen.getByLabelText('本田 康彦', { exact: false }) as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(screen.getByText(i18next.t('ledger:checkin.unsaved'))).toBeTruthy()
  })

  it('says so plainly when the booking has no names on it yet', async () => {
    api.json.mockResolvedValue({ items: [] })
    renderCheckins({ players: [] })

    expect(screen.getByText(i18next.t('ledger:checkin.noNames'))).toBeTruthy()
  })
})
