/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { NewReservationEditor } from './NewReservationEditor'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

const target = {
  golfCourseId: 'course-east',
  courseName: '東コース',
  teeTime: '07:00',
  resourceId: 'res-east-1',
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

function renderEditor() {
  const props = {
    target,
    date: '2026-08-12',
    plans,
    playerTagOptions: [],
    onClose: vi.fn(),
    onCreated: vi.fn(),
  }
  render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <NewReservationEditor {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  )
  return props
}

/** Required fields carry a badge inside their label, so this matches loosely. */
function input(label: string) {
  return screen.getByLabelText(label, { exact: false }) as HTMLInputElement
}

describe('the ledger new-booking sheet', () => {
  it('takes the group detail while the caller is still on the phone', async () => {
    // The same three boxes the edit sheet has. Missing here, a compe name given
    // on the call had to be typed again later — from memory — or not at all.
    api.json.mockResolvedValue({ id: 'rsv-9' })
    const props = renderEditor()

    fireEvent.change(input(i18next.t('ledger:newReservation.customerName')), {
      target: { value: '本田' },
    })
    fireEvent.change(input(i18next.t('ledger:party.competition')), {
      target: { value: '本田会' },
    })
    fireEvent.change(input(i18next.t('ledger:party.organizer')), {
      target: { value: '本田太郎' },
    })
    fireEvent.change(input(i18next.t('ledger:party.groupNumber')), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18next.t('ledger:newReservation.save') }))

    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    const create = api.json.mock.calls.find(call => call[0] === '/v1/course/reservations')
    expect(create).toBeTruthy()
    expect(JSON.parse(create![1].body)).toMatchObject({
      customerName: '本田',
      competitionName: '本田会',
      organizer: '本田太郎',
      groupNumber: 2,
    })
  })

  it('sends nothing for the boxes the desk left alone', async () => {
    // An empty compe name is not a compe called "": the booking has to reach
    // Field with the field unset, or the board would print a blank one.
    api.json.mockResolvedValue({ id: 'rsv-9' })
    const props = renderEditor()

    fireEvent.change(input(i18next.t('ledger:newReservation.customerName')), {
      target: { value: '本田' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18next.t('ledger:newReservation.save') }))

    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    const create = api.json.mock.calls.find(call => call[0] === '/v1/course/reservations')
    expect(JSON.parse(create![1].body)).toMatchObject({
      competitionName: null,
      organizer: null,
      groupNumber: null,
    })
  })

  it('keeps the caddie plan selectable and saveable regardless of supply', () => {
    // Caddie supply no longer guards the plan list at all (SCC-27): the sheet
    // takes no `caddieSupply` prop any more, so this only has to show the
    // caddie plan is a plain, always-enabled choice.
    renderEditor()

    const caddie = screen.getByRole('radio', { name: /キャディ付き/ }) as HTMLInputElement
    expect(caddie.disabled).toBe(false)
    expect(caddie.checked).toBe(true)

    fireEvent.change(input(i18next.t('ledger:newReservation.customerName')), {
      target: { value: '本田' },
    })
    const save = screen.getByRole('button', {
      name: i18next.t('ledger:newReservation.save'),
    }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })
})
