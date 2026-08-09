import { describe, expect, it } from 'vitest'

import type { GolfReservationProduct } from '../models'
import type { LedgerColumn, LedgerSlot } from './models'
import {
  reservationBlockReason,
  reservationProduct,
  selectedReservationTarget,
} from './newReservation'

function slot(overrides: Partial<LedgerSlot> = {}): LedgerSlot {
  return {
    teeTime: '07:00',
    capacity: 2,
    availableGroups: 1,
    bookedGroups: 1,
    playerCount: 4,
    isActive: true,
    isSellable: true,
    items: [],
    ...overrides,
  }
}

function column(overrides: Partial<LedgerColumn> = {}): LedgerColumn {
  return {
    golfCourseId: 'course-1',
    courseName: '東コース',
    resourceId: 'resource-1',
    gridSource: 'inventory',
    groupCount: 0,
    playerCount: 0,
    selfGroupCount: 0,
    caddieGroupCount: 0,
    openSlotCount: 1,
    slots: [slot()],
    ...overrides,
  }
}

function product(
  serviceId: string,
  playType: 'caddie' | 'self',
  courseId: string | null,
): GolfReservationProduct {
  return {
    id: `product-${serviceId}`,
    tenantId: 'tenant-1',
    extensionKey: 'golf_course',
    reservationServiceId: serviceId,
    displayName: null,
    playType,
    holeCount: 18,
    expectedDurationMinutes: 270,
    golfCourseId: courseId,
    maxPlayersPerGroup: 4,
    createdAt: '',
    updatedAt: '',
  }
}

describe('new ledger reservations', () => {
  it('resolves exactly one selected ledger row', () => {
    const target = selectedReservationTarget(
      [column()],
      { golfCourseId: 'course-1', teeTimes: ['07:00'] },
    )
    expect(target?.column.resourceId).toBe('resource-1')
    expect(target?.slot.teeTime).toBe('07:00')
    expect(selectedReservationTarget(
      [column()],
      { golfCourseId: 'course-1', teeTimes: ['07:00', '07:08'] },
    )).toBeNull()
  })

  it('allows a sellable generated slot', () => {
    expect(reservationBlockReason({ column: column(), slot: slot() })).toBeNull()
  })

  it('blocks full and inactive slots before submit', () => {
    expect(reservationBlockReason({
      column: column(),
      slot: slot({ availableGroups: 0, isSellable: false }),
    })).toBe('full')
    expect(reservationBlockReason({
      column: column(),
      slot: slot({ isActive: false, isSellable: false }),
    })).toBe('inactive')
  })

  it('blocks rows which do not represent generated inventory', () => {
    expect(reservationBlockReason({
      column: column({ gridSource: 'schedule' }),
      slot: slot({ capacity: null, availableGroups: null }),
    })).toBe('missingInventory')
    expect(reservationBlockReason({
      column: column({ resourceId: null }),
      slot: slot(),
    })).toBe('missingResource')
  })

  it('prefers a course product and falls back to an unscoped legacy product', () => {
    const global = product('service-global', 'self', null)
    const exact = product('service-exact', 'self', 'course-1')
    expect(reservationProduct([global, exact], 'course-1', 'self')?.reservationServiceId)
      .toBe('service-exact')
    expect(reservationProduct([global], 'course-2', 'self')?.reservationServiceId)
      .toBe('service-global')
  })
})
