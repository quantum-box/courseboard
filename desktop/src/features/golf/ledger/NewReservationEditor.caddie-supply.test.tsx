/* @vitest-environment jsdom */

import { TooltipProvider } from '@tachyon-sdk/native-ui'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import type { CourseCaddieSupply } from '../caddieCourseSupply'
import { NewReservationEditor } from './NewReservationEditor'

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: vi.fn() }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

const target = {
  golfCourseId: 'course-east',
  courseName: '東コース',
  teeTime: '07:00',
  resourceId: 'res-east-1',
}

const caddiePlan = {
  reservationServiceId: 'plan-caddie',
  label: 'キャディ付き18H',
  playType: 'caddie' as const,
  expectedDurationMinutes: 270,
  golfCourseIds: ['course-east'],
  maxPlayersPerGroup: 4,
}

const selfPlan = {
  reservationServiceId: 'plan-self',
  label: 'セルフ18H',
  playType: 'self' as const,
  expectedDurationMinutes: 240,
  golfCourseIds: ['course-east'],
  maxPlayersPerGroup: 4,
}

function supply(overrides: Partial<CourseCaddieSupply>): CourseCaddieSupply {
  return {
    golfCourseId: 'course-east',
    courseName: '東コース',
    workingCaddies: 6,
    roundsCapacity: 10,
    caddieAttachedGroups: 4,
    movableCaddies: 2,
    shortfall: 6,
    ...overrides,
  }
}

afterEach(cleanup)

function renderEditor(caddieSupply: CourseCaddieSupply | null) {
  render(
    <I18nextProvider i18n={i18next}>
      <TooltipProvider>
        <NewReservationEditor
          target={target}
          date="2026-08-24"
          plans={[caddiePlan, selfPlan]}
          playerTagOptions={[]}
          caddieSupply={caddieSupply}
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />
      </TooltipProvider>
    </I18nextProvider>,
  )
}

function planRadio(label: string) {
  return screen.getByRole('radio', { name: new RegExp(label) }) as HTMLInputElement
}

describe('booking a tee time when the caddie room is full', () => {
  it('takes the caddie plan out of reach and opens on self-play instead', () => {
    // The complaint from the club: the desk filled the whole sheet in, pressed
    // save, and only then heard there was no caddie. The answer has to arrive
    // before the typing, not after.
    renderEditor(supply({ roundsCapacity: 8, caddieAttachedGroups: 8, shortfall: 0 }))

    expect(planRadio('キャディ付き18H').disabled).toBe(true)
    expect(screen.getByText(i18next.t('ledger:newReservation.caddieSoldOut'))).toBeTruthy()

    // The same tee time is still sellable as self-play, so the sheet stays
    // usable and lands on the plan the desk can actually book.
    const self = planRadio('セルフ18H')
    expect(self.disabled).toBe(false)
    expect(self.checked).toBe(true)
  })

  it('keeps the caddie plan bookable while rounds remain', () => {
    renderEditor(supply({ roundsCapacity: 10, caddieAttachedGroups: 4, shortfall: 6 }))

    const caddie = planRadio('キャディ付き18H')
    expect(caddie.disabled).toBe(false)
    expect(caddie.checked).toBe(true)
    expect(screen.queryByText(i18next.t('ledger:newReservation.caddieSoldOut'))).toBeNull()
  })

  it('oversold is still sold out', () => {
    // shortfall goes negative once bookings pass what the shifts can carry.
    renderEditor(supply({ roundsCapacity: 4, caddieAttachedGroups: 6, shortfall: -2 }))

    expect(planRadio('キャディ付き18H').disabled).toBe(true)
  })

  it('does not refuse a caddie round when the supply never arrived', () => {
    // A failed or still-flying lookup is not the club saying it has no
    // caddies. Refusing here would take the desk's phone bookings away for an
    // upstream reason nobody at the counter can see.
    renderEditor(null)

    expect(planRadio('キャディ付き18H').disabled).toBe(false)
  })

  it('does not refuse a caddie round in a month nobody has confirmed', () => {
    // Shifts are confirmed a month at a time, and an unconfirmed month reports
    // every course at zero. Zero capacity with zero bookings is "not decided
    // yet", not "no caddies" — the same reading the ledger column takes.
    renderEditor(supply({ workingCaddies: 0, roundsCapacity: 0, caddieAttachedGroups: 0, shortfall: 0 }))

    expect(planRadio('キャディ付き18H').disabled).toBe(false)
  })

  it('says what to do when the course sells caddie rounds only', () => {
    render(
      <I18nextProvider i18n={i18next}>
        <TooltipProvider>
          <NewReservationEditor
            target={target}
            date="2026-08-24"
            plans={[caddiePlan]}
            playerTagOptions={[]}
            caddieSupply={supply({ roundsCapacity: 8, caddieAttachedGroups: 8, shortfall: 0 })}
            onClose={vi.fn()}
            onCreated={vi.fn()}
          />
        </TooltipProvider>
      </I18nextProvider>,
    )

    // Every plan greyed out with no explanation reads as a broken sheet.
    expect(screen.getByText(i18next.t('ledger:newReservation.caddieSoldOutTitle'))).toBeTruthy()
    const save = screen.getByRole('button', {
      name: i18next.t('ledger:newReservation.save'),
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })
})
