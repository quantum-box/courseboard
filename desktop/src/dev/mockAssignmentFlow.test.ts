/* @vitest-environment jsdom */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  sessionStorage.clear()
  vi.resetModules()
  vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
  vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
})
afterEach(() => { sessionStorage.clear(); vi.unstubAllEnvs() })

it('saves a local assignment across reloads and rejects duplicate assignment of the group', async () => {
  const { resolveMockFieldApiJson: api } = await import('./mockFieldApi')
  const body = { reservationId: 'res_mock_9', caddieProfileId: 'caddie_aya', scheduledAt: '2026-11-06T10:00:00+09:00' }
  const init = { method: 'POST', body: JSON.stringify(body) }
  const created = api('/v1/course/caddie-assignments', init)
  expect(created.kind).toBe('hit')
  if (created.kind !== 'hit') return
  expect(created.data).toMatchObject({ ...body, status: 'assigned' })
  expect(api('/v1/course/caddie-assignments', init)).toMatchObject({ kind: 'error', status: 409 })

  vi.resetModules()
  const reloaded = await import('./mockFieldApi')
  const assignments = reloaded.resolveMockFieldApiJson('/v1/course/caddie-assignments')
  expect(assignments).toMatchObject({ kind: 'hit', data: { items: expect.arrayContaining([
    expect.objectContaining({ ...body, canonicalStatus: 'assigned' }),
  ]) } })
})

it('keeps the local assignment workflow inside the known fixtures', async () => {
  const { resolveMockFieldApiJson: api } = await import('./mockFieldApi')
  expect(api('/v1/course/tenant-timezone')).toEqual({ kind: 'hit', data: { timezone: 'Asia/Tokyo' } })
  expect(api('/v1/course/caddie-assignments', { method: 'POST', body: JSON.stringify({
    reservationId: 'does-not-exist', caddieProfileId: 'caddie_aya',
  }) })).toMatchObject({ kind: 'error', status: 404 })
})

it('plans every pending group and persists automatic assignments without double booking', async () => {
  const { resolveMockFieldApiJson: api } = await import('./mockFieldApi')
  const run = (dryRun: boolean) => api('/v1/course/caddie-auto-assignments', {
    method: 'POST', body: JSON.stringify({ date: '2026-11-06', dryRun }),
  })
  const initial = run(true)
  expect(initial).toMatchObject({ kind: 'hit', data: { assigned: expect.any(Array), skipped: expect.any(Array) } })
  // The busy fixture already fills the roster's daily capacity. Free the test
  // day's assignments to exercise planning and persistence with enough supply.
  const existing = api('/v1/course/caddie-assignments')
  if (existing.kind !== 'hit') throw new Error('Missing assignments')
  for (const item of (existing.data as { items: Array<{ id: string; scheduledAt: string }> }).items) {
    if (item.scheduledAt.startsWith('2026-11-06')) api(`/v1/course/caddie-assignments/${item.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
    })
  }
  const preview = run(true)
  expect(preview.kind).toBe('hit')
  if (preview.kind !== 'hit') return
  const plan = preview.data as { assigned: Array<{ reservationId: string; caddieProfileId: string; scheduledAt: string; durationMinutes: number }>; skipped: unknown[] }
  expect(plan.assigned.length).toBeGreaterThan(3)
  expect(plan.assigned.length + plan.skipped.length).toBeGreaterThan(12)
  expect(new Set(plan.assigned.map(item => item.reservationId)).size).toBe(plan.assigned.length)
  for (const first of plan.assigned) {
    for (const second of plan.assigned) {
      if (first === second || first.caddieProfileId !== second.caddieProfileId) continue
      expect(Date.parse(first.scheduledAt) + first.durationMinutes * 60_000 <= Date.parse(second.scheduledAt)
        || Date.parse(second.scheduledAt) + second.durationMinutes * 60_000 <= Date.parse(first.scheduledAt)).toBe(true)
    }
  }
  expect(run(true)).toEqual(preview)
  expect(run(false)).toMatchObject({ kind: 'hit', data: { assigned: plan.assigned } })
  expect(run(true)).toMatchObject({ kind: 'hit', data: { assigned: [] } })
  vi.resetModules()
  const reloaded = await import('./mockFieldApi')
  const assignments = reloaded.resolveMockFieldApiJson('/v1/course/caddie-assignments')
  expect(assignments).toMatchObject({ kind: 'hit', data: { items: expect.arrayContaining(
    plan.assigned.map(item => expect.objectContaining({ reservationId: item.reservationId, caddieProfileId: item.caddieProfileId })),
  ) } })
})


it('provides reservations on every day of November', async () => {
  const { resolveMockFieldApiJson: api } = await import('./mockFieldApi')
  for (let day = 1; day <= 30; day += 1) {
    const date = `2026-11-${String(day).padStart(2, '0')}`
    const sheet = api(`/v1/course/tee-sheet?date=${date}`)
    expect(sheet.kind).toBe('hit')
    if (sheet.kind !== 'hit') continue
    const rows = (sheet.data as { items: Array<{ teeTime: string }> }).items
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.every(row => row.teeTime.startsWith(date))).toBe(true)
  }
})


it('links the Sapporo-inspired products and bookings to nine starting courses totalling 81 holes', async () => {
  const { resolveMockFieldApiJson: api } = await import('./mockFieldApi')
  const courses = api('/v1/course/courses')
  const products = api('/v1/course/reservation-products')
  if (courses.kind !== 'hit' || products.kind !== 'hit') throw new Error('Missing catalogue')
  const courseRows = (courses.data as { items: Array<{ id: string; holeCount: number }> }).items
  const productRows = (products.data as { items: Array<{ reservationServiceId: string; displayName: string; golfCourseIds: string[] }> }).items
  expect(courseRows).toHaveLength(9)
  expect(courseRows.reduce((sum, row) => sum + row.holeCount, 0)).toBe(81)
  expect(productRows).toHaveLength(21)
  expect(productRows.filter(row => row.displayName.startsWith('真駒内CC 空沼'))
    .every(row => row.golfCourseIds.every(id => ['course_soranuma', 'course_soranuma_in'].includes(id)))).toBe(true)
  expect(productRows.filter(row => row.displayName.startsWith('真駒内CC 藻岩'))
    .every(row => row.golfCourseIds.every(id => ['course_moiwa', 'course_moiwa_in'].includes(id)))).toBe(true)
  const ids = new Set(courseRows.map(row => row.id))
  expect(productRows.every(row => row.displayName && row.golfCourseIds.length && row.golfCourseIds.every(id => ids.has(id)))).toBe(true)
  const sheet = api('/v1/course/tee-sheet?date=2026-11-06')
  if (sheet.kind !== 'hit') throw new Error('Missing bookings')
  for (const row of (sheet.data as { items: Array<{ golfCourseId: string; reservationServiceId: string }> }).items) {
    expect(productRows.find(product => product.reservationServiceId === row.reservationServiceId)?.golfCourseIds).toContain(row.golfCourseId)
  }
})

it('provides a complete November roster with rest days and valid course placements', async () => {
  const { resolveMockFieldApiJson: api } = await import('./mockFieldApi')
  const result = api('/v1/course/caddie-shifts?from=2026-11-01&to=2026-11-30')
  if (result.kind !== 'hit') throw new Error('Missing shifts')
  const shifts = (result.data as { items: Array<{ caddieProfileId: string; date: string; isWorking: boolean; golfCourseId: string | null; roundsCapacity: number }> }).items
  expect(shifts.length).toBe(245 * 30)
  expect(new Set(shifts.filter(row => row.isWorking).map(row => row.golfCourseId)).size).toBe(9)
  for (const id of new Set(shifts.map(row => row.caddieProfileId))) {
    const days = shifts.filter(row => row.caddieProfileId === id)
    expect(days).toHaveLength(30)
    expect(days.filter(row => !row.isWorking).length).toBeGreaterThanOrEqual(8)
    expect(days.every(row => row.isWorking ? row.golfCourseId && row.roundsCapacity > 0 : row.roundsCapacity === 0)).toBe(true)
  }
})
