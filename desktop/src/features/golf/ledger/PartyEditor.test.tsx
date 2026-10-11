/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import type { TeeReservation } from '../timeline/models'
import { PartyEditor } from './PartyEditor'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

const reservation: TeeReservation = {
  id: 'rsv-1',
  reservationNumber: 'R-1',
  reservationServiceId: 'plan-caddie',
  golfCourseId: 'course-east',
  courseName: '東コース',
  teeTime: '2026-08-12T07:00:00+09:00',
  durationMinutes: 270,
  playType: 'caddie',
  partySize: 4,
  partyName: '実務再テスト予約',
  customerId: 'cus-1',
  status: 'confirmed',
  holes: 18,
  party: {
    competitionName: '本田会',
    groupNumber: 2,
    players: [{ name: 'QAプレイヤー1' }, { name: 'QAプレイヤー2' }],
  },
}

const plans = [
  {
    reservationServiceId: 'plan-caddie',
    label: 'キャディ付き',
    playType: 'caddie' as const,
    expectedDurationMinutes: 270,
    golfCourseIds: ['course-east'],
    maxPlayersPerGroup: 4,
  },
]

afterEach(() => {
  cleanup()
  api.json.mockReset()
})

function renderEditor(overrides: Partial<Parameters<typeof PartyEditor>[0]> = {}) {
  const props = {
    reservation,
    plans,
    playerTagOptions: [],
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onReservationChanged: vi.fn(),
    ...overrides,
  }
  render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <PartyEditor {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  )
  return props
}

/** Required fields carry a badge inside their label, so this matches loosely. */
function input(label: string) {
  return screen.getByLabelText(label, { exact: false }) as HTMLInputElement
}

describe('the ledger booking sheet', () => {
  it('opens with what the booking was taken with, not an empty form', () => {
    // The desk clicks a row that plainly reads "実務再テスト予約 / 4名" on the
    // board. A sheet that showed neither read as a booking that had lost them.
    renderEditor()

    expect(input(i18next.t('ledger:newReservation.customerName')).value).toBe('実務再テスト予約')
    expect(input(i18next.t('ledger:newReservation.quantity')).value).toBe('4')
    expect(input(i18next.t('ledger:party.competition')).value).toBe('本田会')
    expect(input(i18next.t('ledger:party.groupNumber')).value).toBe('2')
    expect(screen.getByDisplayValue('QAプレイヤー1')).toBeTruthy()
  })

  it('saves a corrected name and headcount before the group detail', async () => {
    api.json.mockResolvedValue({ players: [] })
    const props = renderEditor()

    fireEvent.change(input(i18next.t('ledger:newReservation.quantity')), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByText(i18next.t('ledger:party.save')))

    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    // The membership lookup the picker makes for a linked customer, and the
    // check-in list the sheet reads on open, are not writes — so the saved
    // calls are the ones that carry a method.
    const writes = api.json.mock.calls.filter(
      call => (call[0] as string).startsWith('/v1/course/reservations/') && call[1]?.method,
    )
    expect(writes.map(call => call[0] as string)).toEqual([
      '/v1/course/reservations/rsv-1',
      '/v1/course/reservations/rsv-1/party',
    ])
    expect(JSON.parse(writes[0]![1].body)).toEqual({
      customerName: '実務再テスト予約',
      customerId: 'cus-1',
      quantity: 3,
    })
    expect(props.onReservationChanged).toHaveBeenCalled()
  })

  it('leaves the booking alone when only the group detail changed', async () => {
    api.json.mockResolvedValue({ players: [] })
    const props = renderEditor()

    fireEvent.change(input(i18next.t('ledger:party.competition')), {
      target: { value: '増田杯' },
    })
    fireEvent.click(screen.getByText(i18next.t('ledger:party.save')))

    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(
      api.json.mock.calls
        .filter(call => (call[0] as string).startsWith('/v1/course/reservations/') && call[1]?.method)
        .map(call => call[0] as string),
    ).toEqual(['/v1/course/reservations/rsv-1/party'])
  })

  it('refuses to save a booking with no name on it', () => {
    renderEditor()

    fireEvent.change(input(i18next.t('ledger:newReservation.customerName')), {
      target: { value: '  ' },
    })

    const save = screen.getByText(i18next.t('ledger:party.save')) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })
})

describe('changing the plan of a booking that is already settled (SCC-9)', () => {
  const twoPlans = [
    ...plans,
    {
      reservationServiceId: 'plan-self',
      label: 'セルフ',
      playType: 'self' as const,
      expectedDurationMinutes: 270,
      golfCourseIds: ['course-east'],
      maxPlayersPerGroup: 4,
    },
  ]

  function planRadios() {
    return screen.getAllByRole('radio') as HTMLInputElement[]
  }

  it('lets the desk change the plan of an unpaid booking nobody has arrived for', async () => {
    renderEditor({ plans: twoPlans })

    await waitFor(() => expect(planRadios()).toHaveLength(2))
    expect(planRadios().every(radio => !radio.disabled)).toBe(true)
    expect(screen.queryByText(i18next.t('ledger:party.planLocked.paid'))).toBeNull()
  })

  it('says a paid booking keeps its plan, before the desk picks another', async () => {
    // A deposit is money taken too, so any amount locks the plan.
    renderEditor({ plans: twoPlans, reservation: { ...reservation, paidAmount: 5_000 } })

    expect(await screen.findByText(i18next.t('ledger:party.planLocked.paid'))).toBeTruthy()
    expect(planRadios().every(radio => radio.disabled)).toBe(true)
  })

  it('says a group that has checked in keeps its plan', async () => {
    api.json.mockImplementation(async (path: string) => {
      if (path.endsWith('/checkins')) {
        return {
          items: [{
            reservationId: reservation.id,
            playerIndex: 0,
            playerName: 'QAプレイヤー1',
            playedOn: '2026-08-12',
            checkedInAt: '2026-08-12T06:40:00Z',
          }],
        }
      }
      return { items: [] }
    })
    renderEditor({ plans: twoPlans })

    expect(await screen.findByText(i18next.t('ledger:party.planLocked.checkedIn'))).toBeTruthy()
    expect(planRadios().every(radio => radio.disabled)).toBe(true)
  })

  it('says a round that is over keeps its plan', async () => {
    renderEditor({ plans: twoPlans, reservation: { ...reservation, status: 'completed' } })

    expect(await screen.findByText(i18next.t('ledger:party.planLocked.over'))).toBeTruthy()
    expect(planRadios().every(radio => radio.disabled)).toBe(true)
  })
})
