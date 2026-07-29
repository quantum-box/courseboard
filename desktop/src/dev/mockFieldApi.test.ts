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

  it('requires a staff link when creating a caddie profile', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    const rejected = resolveMockFieldApiJson('/v1/course/caddie-profiles', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'テスト キャディ', skillLevel: 'regular' }),
    })
    expect(rejected.kind).toBe('error')
    if (rejected.kind !== 'error') return
    expect(rejected.status).toBe(400)

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
})
