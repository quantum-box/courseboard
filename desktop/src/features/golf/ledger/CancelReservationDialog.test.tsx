/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { CancelReservationDialog } from './CancelReservationDialog'
import type { TeeReservation } from '../timeline/models'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

const reservation = {
  id: 'rsv_1',
  partyName: '本田 康彦',
  teeTime: '2026-06-10T08:00:00',
} as TeeReservation

describe('cancelling a booking from the ledger', () => {
  beforeEach(async () => {
    api.json.mockReset()
    api.json.mockResolvedValue(undefined)
    await i18next.changeLanguage('ja')
  })

  afterEach(cleanup)

  it('sends the club’s own reason alongside the sentence the desk typed', async () => {
    // The sentence is what makes one row make sense; the code is what a month
    // of cancellations can be counted and billed by.
    await act(async () => {
      render(
        <I18nextProvider i18n={i18next}>
          <CancelReservationDialog
            reservation={reservation}
            onClose={() => {}}
            onCancelled={() => {}}
          />
        </I18nextProvider>,
      )
    })

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no_contact' } })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '当日連絡がつかず' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }))
    })

    expect(api.json).toHaveBeenCalledTimes(1)
    const [path, init] = api.json.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/v1/course/reservations/rsv_1/cancel')
    expect(JSON.parse(init.body as string)).toEqual({
      reasonCode: 'no_contact',
      reason: '当日連絡がつかず',
    })
  })

  it('does not open on the one reason the club never charges for', async () => {
    // Opening on "weather" would file a month of ordinary cancellations as
    // acts of god, and every one of them would drop off the collection list.
    await act(async () => {
      render(
        <I18nextProvider i18n={i18next}>
          <CancelReservationDialog
            reservation={reservation}
            onClose={() => {}}
            onCancelled={() => {}}
          />
        </I18nextProvider>,
      )
    })

    expect(screen.getByRole('combobox')).toHaveProperty('value', 'personal')
  })
})
