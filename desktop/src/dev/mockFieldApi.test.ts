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
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', undefined)
    expect(isMockFieldDataEnabled()).toBe(true)
  })

  it('can be opted out while staying on development auth', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'false')
    expect(isMockFieldDataEnabled()).toBe(false)
  })

  it('returns golf extension status and courses fixtures', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    const status = resolveMockFieldApiJson('/v1/erp/extensions/status')
    expect(status.kind).toBe('hit')
    if (status.kind !== 'hit') return
    const statusBody = status.data as { items: Array<{ extensionKey: string; tenantStatus: string }> }
    expect(statusBody.items[0]?.extensionKey).toBe('golf_course')
    expect(statusBody.items[0]?.tenantStatus).toBe('enabled')

    const courses = resolveMockFieldApiJson('/v1/erp/extensions/golf-course/courses')
    expect(courses.kind).toBe('hit')
    if (courses.kind !== 'hit') return
    const courseBody = courses.data as { items: unknown[] }
    expect(courseBody.items.length).toBeGreaterThanOrEqual(2)
  })

  it('returns settlement csv text', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    const csv = resolveMockFieldApiText(
      '/v1/erp/extensions/golf-course/monthly-settlement/export.csv?yearMonth=2026-07',
    )
    expect(csv.kind).toBe('hit')
    if (csv.kind !== 'hit') return
    expect(csv.data).toContain('gross_amount')
  })

  it('returns tee sheet and expanded caddie assignment fixtures', () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    const sheet = resolveMockFieldApiJson(
      '/v1/erp/extensions/golf-course/tee-sheet?date=2026-07-18',
    )
    expect(sheet.kind).toBe('hit')
    if (sheet.kind !== 'hit') return
    const body = sheet.data as { items: unknown[] }
    expect(body.items.length).toBeGreaterThanOrEqual(10)

    const assignments = resolveMockFieldApiJson(
      '/v1/erp/extensions/golf-course/caddie-assignments',
    )
    expect(assignments.kind).toBe('hit')
    if (assignments.kind !== 'hit') return
    const assignmentBody = assignments.data as { items: unknown[] }
    expect(assignmentBody.items.length).toBeGreaterThanOrEqual(6)
  })
})
