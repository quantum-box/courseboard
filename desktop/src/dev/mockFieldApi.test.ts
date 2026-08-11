import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isMockFieldDataEnabled,
  resolveMockFieldApiJson,
  resolveMockFieldApiText,
} from './mockFieldApi'

describe('mockFieldApi', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is disabled outside development auth mode', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'browser-pkce')
    expect(isMockFieldDataEnabled()).toBe(false)
    expect(resolveMockFieldApiJson('/v1/erp/extensions/status')).toEqual({ kind: 'disabled' })
  })

  it('defaults to enabled in development auth mode', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', '')
    expect(isMockFieldDataEnabled()).toBe(true)
  })

  it('can be opted out while staying on development auth', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    expect(isMockFieldDataEnabled()).toBe(false)
  })

  it('returns golf extension status and course-api courses fixtures', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    const status = resolveMockFieldApiJson('/v1/erp/extensions/status')
    expect(status.kind).toBe('hit')
    if (status.kind !== 'hit') return
    const statusBody = status.data as { items: Array<{ extensionKey: string; tenantStatus: string }> }
    expect(statusBody.items[0]?.extensionKey).toBe('golf_course')
    expect(statusBody.items[0]?.tenantStatus).toBe('enabled')

    const courses = resolveMockFieldApiJson('/v1/course/courses')
    expect(courses.kind).toBe('hit')
    if (courses.kind !== 'hit') return
    const courseBody = courses.data as { items: unknown[] }
    expect(courseBody.items.length).toBeGreaterThanOrEqual(2)
  })

  it('registers the staff member a caddie names when the body carries no link', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    const implicit = resolveMockFieldApiJson('/v1/course/caddie-profiles', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'テスト キャディ', skillLevel: 'regular' }),
    })
    expect(implicit.kind).toBe('hit')
    if (implicit.kind !== 'hit') return
    const linkedStaffId = (implicit.data as { staffId: string }).staffId
    expect(linkedStaffId).toMatch(/^staff_/)

    const staff = resolveMockFieldApiJson('/v1/erp/staff')
    expect(staff.kind).toBe('hit')
    if (staff.kind !== 'hit') return
    const roster = staff.data as { items: Array<{ id: string; name: string }> }
    expect(roster.items.find(member => member.id === linkedStaffId)?.name)
      .toBe('テスト キャディ')

    const created = resolveMockFieldApiJson('/v1/course/caddie-profiles', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'テスト キャディ',
        skillLevel: 'regular',
        staffId: 'staff_test_001',
        staffReferenceType: 'staff_member',
        staffReferenceId: 'staff_test_001',
      }),
    })
    expect(created.kind).toBe('hit')
    if (created.kind !== 'hit') return
    expect((created.data as { staffId: string }).staffId).toBe('staff_test_001')
  })

  it('returns settlement csv text via course-api path', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    const csv = resolveMockFieldApiText(
      '/v1/course/monthly-settlement/export.csv?yearMonth=2026-07',
    )
    expect(csv.kind).toBe('hit')
    if (csv.kind !== 'hit') return
    expect(csv.data).toContain('gross_amount')
  })

  it('returns course-api tee sheet, caddie, commercial, and ops fixtures', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    const sheet = resolveMockFieldApiJson(
      '/v1/course/tee-sheet?date=2026-07-18',
    )
    expect(sheet.kind).toBe('hit')
    if (sheet.kind !== 'hit') return
    const body = sheet.data as { items: unknown[] }
    expect(body.items.length).toBeGreaterThanOrEqual(10)

    const assignments = resolveMockFieldApiJson('/v1/course/caddie-assignments')
    expect(assignments.kind).toBe('hit')
    if (assignments.kind !== 'hit') return
    const assignmentBody = assignments.data as { items: unknown[] }
    expect(assignmentBody.items.length).toBeGreaterThanOrEqual(6)

    const caddies = resolveMockFieldApiJson('/v1/course/caddie-profiles')
    expect(caddies.kind).toBe('hit')
    if (caddies.kind !== 'hit') return
    const caddieBody = caddies.data as { items: unknown[] }
    expect(caddieBody.items.length).toBeGreaterThanOrEqual(5)

    const products = resolveMockFieldApiJson('/v1/course/reservation-products')
    expect(products.kind).toBe('hit')
    if (products.kind !== 'hit') return
    const productBody = products.data as { items: unknown[] }
    expect(productBody.items.length).toBeGreaterThanOrEqual(2)

    const policy = resolveMockFieldApiJson('/v1/course/reservation-policy')
    expect(policy.kind).toBe('hit')

    const budgets = resolveMockFieldApiJson('/v1/course/daily-budgets?from=2026-07-01&to=2026-07-31')
    expect(budgets.kind).toBe('hit')

    const settlement = resolveMockFieldApiJson('/v1/course/monthly-settlement?yearMonth=2026-07')
    expect(settlement.kind).toBe('hit')

    const availabilities = resolveMockFieldApiJson(
      '/v1/course/caddie-availabilities?caddieProfileId=caddie_aya&from=2026-07-01&to=2026-07-31',
    )
    expect(availabilities.kind).toBe('hit')

    const extensionStatus = resolveMockFieldApiJson('/v1/course/extension-status')
    expect(extensionStatus.kind).toBe('hit')
    if (extensionStatus.kind !== 'hit') return
    expect((extensionStatus.data as { extensionKey: string }).extensionKey).toBe('golf_course')
  })

  it('creates and cancels a reservation through the course-api contract', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')

    const before = resolveMockFieldApiJson('/v1/course/tee-ledger?date=2026-07-18')
    expect(before.kind).toBe('hit')
    if (before.kind !== 'hit') return
    const beforeBody = before.data as {
      columns: Array<{
        golfCourseId: string
        resourceId: string
        slots: Array<{ teeTime: string; bookedGroups: number }>
      }>
    }
    const eastBefore = beforeBody.columns.find(column => column.golfCourseId === 'course_east')
    expect(eastBefore?.resourceId).toBe('res_east')
    expect(eastBefore?.slots.find(slot => slot.teeTime === '07:24')?.bookedGroups).toBe(0)

    // prepaymentPolicy is deliberately absent here: the real CourseBoard
    // usecase adds "none" to its outbound Field request.
    const created = resolveMockFieldApiJson('/v1/course/reservations', {
      method: 'POST',
      body: JSON.stringify({
        golfCourseId: 'course_east',
        resourceId: 'res_east',
        reservationServiceId: 'svc:caddie-18',
        date: '2026-07-18',
        teeTime: '07:24',
        durationMinutes: 270,
        quantity: 4,
        customerName: '  オフライン予約  ',
      }),
    })
    expect(created.kind).toBe('hit')
    if (created.kind !== 'hit') return
    const reservationId = (created.data as { id: string }).id

    const afterCreate = resolveMockFieldApiJson('/v1/course/tee-ledger?date=2026-07-18')
    expect(afterCreate.kind).toBe('hit')
    if (afterCreate.kind !== 'hit') return
    const createdSlot = (afterCreate.data as typeof beforeBody).columns
      .find(column => column.golfCourseId === 'course_east')
      ?.slots.find(slot => slot.teeTime === '07:24')
    expect(createdSlot?.bookedGroups).toBe(1)

    const sheet = resolveMockFieldApiJson('/v1/course/tee-sheet?date=2026-07-18')
    expect(sheet.kind).toBe('hit')
    if (sheet.kind !== 'hit') return
    const createdReservation = (sheet.data as {
      items: Array<{ id: string; partyName: string; prepaymentPolicy?: string }>
    }).items.find(item => item.id === reservationId)
    expect(createdReservation?.partyName).toBe('オフライン予約')
    expect(createdReservation).not.toHaveProperty('prepaymentPolicy')

    const cancelled = resolveMockFieldApiJson(
      `/v1/course/reservations/${encodeURIComponent(reservationId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: '電話でキャンセル' }),
      },
    )
    expect(cancelled).toEqual({ kind: 'hit', data: null })

    const afterCancel = resolveMockFieldApiJson('/v1/course/tee-ledger?date=2026-07-18')
    expect(afterCancel.kind).toBe('hit')
    if (afterCancel.kind !== 'hit') return
    const cancelledSlot = (afterCancel.data as typeof beforeBody).columns
      .find(column => column.golfCourseId === 'course_east')
      ?.slots.find(slot => slot.teeTime === '07:24')
    expect(cancelledSlot?.bookedGroups).toBe(0)
  })

  it('requires the canonical resource and returns 409 for a full generated slot', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    const request = {
      golfCourseId: 'course_east',
      reservationServiceId: 'svc:caddie-18',
      date: '2026-07-18',
      teeTime: '08:00',
      durationMinutes: 270,
      quantity: 4,
      customerName: '満枠テスト',
    }

    expect(resolveMockFieldApiJson('/v1/course/reservations', {
      method: 'POST',
      body: JSON.stringify(request),
    })).toEqual({ kind: 'error', status: 400, message: 'resourceId is required' })

    expect(resolveMockFieldApiJson('/v1/course/reservations', {
      method: 'POST',
      body: JSON.stringify({ ...request, resourceId: 'res_west' }),
    })).toMatchObject({ kind: 'error', status: 400 })

    expect(resolveMockFieldApiJson('/v1/course/reservations', {
      method: 'POST',
      body: JSON.stringify({ ...request, resourceId: 'res_east' }),
    })).toEqual({ kind: 'error', status: 409, message: 'この枠はちょうど埋まりました' })

    expect(resolveMockFieldApiJson('/v1/course/reservations', {
      method: 'POST',
      body: JSON.stringify({
        ...request,
        resourceId: 'res_east',
        teeTime: '06:59',
      }),
    })).toEqual({ kind: 'error', status: 409, message: 'この枠はちょうど埋まりました' })
  })

  it('answers feature flag evaluation with every requested key enabled', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    expect(resolveMockFieldApiJson('/v1/course/feature-flags/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        keys: ['feature.courseboard.flag-evaluation-smoke', 'feature.courseboard.other'],
      }),
    })).toEqual({
      kind: 'hit',
      data: {
        values: [
          { key: 'feature.courseboard.flag-evaluation-smoke', enabled: true },
          { key: 'feature.courseboard.other', enabled: true },
        ],
      },
    })

    expect(resolveMockFieldApiJson('/v1/course/feature-flags/evaluate', {
      method: 'POST',
      body: JSON.stringify({}),
    })).toEqual({ kind: 'hit', data: { values: [] } })
  })
})
