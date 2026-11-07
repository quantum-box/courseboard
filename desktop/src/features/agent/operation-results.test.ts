import { beforeEach, expect, it, vi } from 'vitest'
import { courseboardApiJson } from '../../api'
import { executeOperation } from './chat-api'
vi.mock('../../api', () => ({ courseboardApiJson: vi.fn(), operatorApiBaseUrl: () => '' }))
const api = vi.mocked(courseboardApiJson)
beforeEach(() => { api.mockReset() })
it('labels an empty imported report as non-authoritative instead of zero live reservations', async () => {
  api.mockResolvedValue({ items: [] })
  const result = await executeOperation({ operationId: 'report', method: 'GET', path: '/v1/course/reservation-report-entries' }, {}, new AbortController().signal)
  expect(result).toMatchObject({ authoritativeForReservationCounts: false, data: { items: [] } })
})
it('compacts a generic ledger read using the same authoritative totals as the dedicated tool', async () => {
  api.mockResolvedValue({ date: '2026-11-07', timezone: 'Asia/Tokyo', columns: [{ golfCourseId: 'a', courseName: 'A', gridSource: 'inventory', groupCount: 29, playerCount: 98, selfGroupCount: 20, caddieGroupCount: 9, openSlotCount: 306, slots: Array(1000).fill({}) }] })
  const result = await executeOperation({ operationId: 'ledger', method: 'GET', path: '/v1/course/tee-ledger', parameters: [{ name: 'date', in: 'query', required: true }] }, { query: { date: '2026-11-07' } }, new AbortController().signal)
  expect(result).toMatchObject({ complete: true, reservationTotals: { groups: 29, players: 98 } })
  expect(JSON.stringify(result)).not.toContain('slots')
})
