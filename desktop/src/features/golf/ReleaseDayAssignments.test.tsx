/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18next } from '../../i18n'
import { ReleaseDayAssignments, type CaddieAssignment } from './CaddiesPage'
const api = vi.hoisted(() => vi.fn())
vi.mock('../../api', async original => ({ ...await original<typeof import('../../api')>(), courseboardApiJson: api }))
vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))
beforeEach(async () => { await i18next.changeLanguage('ja'); api.mockReset(); api.mockResolvedValue({ releasedAssignmentIds: ['a'], failed: [] }) })
afterEach(cleanup)
const assignment = (id: string, status = 'assigned', date = '2026-11-06'): CaddieAssignment => ({
  id, caddieProfileId: 'c1', reservationId: id, scheduledAt: `${date}T07:00:00+09:00`, status,
  assignmentRole: 'primary', feeAmount: 10000, feeCurrency: 'JPY',
})
it('confirms and clears only unstarted bookings on the selected date', async () => {
  const changed = vi.fn()
  render(<I18nextProvider i18n={i18next}><ReleaseDayAssignments date="2026-11-06" profiles={[]} onChanged={changed}
    assignments={[assignment('a'), assignment('done', 'completed'), assignment('started', 'in_progress'), assignment('other', 'assigned', '2026-11-07')]} /></I18nextProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'この日の割り当てを解除' }))
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '1件の割り当てを解除' }))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(api).toHaveBeenCalledTimes(1)
  expect(api.mock.calls[0][0]).toBe('/v1/course/caddie-assignments/release-day')
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({ date: '2026-11-06' })
})
it('retries only failed assignments after partial failure', async () => {
  api.mockResolvedValueOnce({ releasedAssignmentIds: ['a'], failed: [{ assignmentId: 'b', message: 'retry' }] }).mockResolvedValue({ releasedAssignmentIds: ['b'], failed: [] })
  render(<I18nextProvider i18n={i18next}><ReleaseDayAssignments date="2026-11-06" profiles={[]} onChanged={() => {}}
    assignments={[assignment('a'), assignment('b')]} /></I18nextProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'この日の割り当てを解除' }))
  fireEvent.click(screen.getByRole('button', { name: '2件の割り当てを解除' }))
  await screen.findByText('1件を解除できませんでした。残った対象を確認して再実行できます。')
  fireEvent.click(screen.getByRole('button', { name: '1件の割り当てを解除' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.mock.calls.map(call => call[0])).toEqual(['/v1/course/caddie-assignments/release-day', '/v1/course/caddie-assignments/release-day'])
})

it('keeps the dialog available to retry a request failure', async () => {
  api.mockRejectedValueOnce(new Error('offline'))
  const changed = vi.fn()
  render(<I18nextProvider i18n={i18next}><ReleaseDayAssignments date="2026-11-06" profiles={[]} onChanged={changed} assignments={[assignment('a')]} /></I18nextProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'この日の割り当てを解除' }))
  fireEvent.click(screen.getByRole('button', { name: '1件の割り当てを解除' }))
  await screen.findByText('1件を解除できませんでした。残った対象を確認して再実行できます。')
  expect(changed).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: '1件の割り当てを解除' }) as HTMLButtonElement).disabled).toBe(false)
})
