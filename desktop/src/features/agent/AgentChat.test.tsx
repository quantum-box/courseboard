/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18next } from '../../i18n'
import { AgentChat } from './AgentChat'
const mocks = vi.hoisted(() => ({ create: vi.fn(), execute: vi.fn(), submit: vi.fn(), write: vi.fn(), field: vi.fn(), reservations: vi.fn() }))
vi.mock('./chat-api', async importOriginal => ({
  ...await importOriginal<typeof import('./chat-api')>(),
  isAgentDemo: () => false,
  agentSessionClient: () => ({ createSession: mocks.create, execute: mocks.execute, submitToolResult: mocks.submit }),
  loadCatalog: vi.fn(async () => ({ operations: [{ operationId: 'update', method: 'PATCH', path: '/v1/course/reservations/{id}', summary: '予約を変更', parameters: [] }], schemas: {} })),
  executeOperation: mocks.write,
  callFieldTool: mocks.field,
}))
vi.mock('./reservation-status', () => ({ getReservationStatus: mocks.reservations }))
const tool = (name: string, id: string, args: object) => ({ type: 'tool_call_pending', tool_name: name, tool_id: id, args })
beforeEach(async () => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  mocks.create.mockResolvedValue('as_test')
  mocks.submit.mockResolvedValue(undefined)
  mocks.write.mockResolvedValue({ updated: true })
  mocks.execute.mockImplementation(async function* () {
    yield tool('courseboard_describe_operation', 'describe', { operationId: 'update' })
    yield tool('courseboard_execute_operation', 'write', { operationId: 'update', pathParams: { id: 'r1' }, body: { customerName: '田中' }, confirmation: '田中様の予約を変更します' })
    yield { type: 'attempt_completion', result: '処理しました' }
    yield { type: 'done' }
  })
  await i18next.changeLanguage('ja')
})
afterEach(cleanup)
function start() {
  fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '予約を変更して' } })
  fireEvent.click(screen.getByRole('button', { name: '送信' }))
}
it('waits for review before a real write and sends the result back to AIP', async () => {
  render(<AgentChat />); start()
  await screen.findByText('田中様の予約を変更します')
  expect(mocks.write).not.toHaveBeenCalled()
  expect(screen.getByText('田中')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'この内容で実行' }))
  await screen.findByText('処理しました')
  expect(mocks.write).toHaveBeenCalledTimes(1)
  expect(mocks.submit).toHaveBeenLastCalledWith('as_test', expect.objectContaining({ tool_id: 'write', is_error: false }), expect.any(AbortSignal))
})
it('never executes declined changes', async () => {
  render(<AgentChat />); start()
  fireEvent.click(await screen.findByRole('button', { name: '実行しない' }))
  await screen.findByText('処理しました')
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.submit.mock.calls.at(-1)?.[1].result).toContain('cancelled')
})
it('deduplicates repeated tool events and refuses execute before describe', async () => {
  mocks.execute.mockImplementation(async function* () {
    const event = tool('courseboard_execute_operation', 'duplicate', { operationId: 'update' })
    yield event; yield event; yield { type: 'done' }
  })
  render(<AgentChat />); start()
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.submit.mock.calls[0][1].is_error).toBe(true)
})
it('stops a pending confirmation without executing and requires a new session', async () => {
  render(<AgentChat />); start()
  await screen.findByRole('button', { name: 'この内容で実行' })
  fireEvent.click(screen.getByRole('button', { name: '中断' }))
  await screen.findByText(/処理を中断しました/)
  expect(mocks.write).not.toHaveBeenCalled()
  expect((screen.getByLabelText('依頼内容') as HTMLTextAreaElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '新しい会話' }))
  expect((screen.getByLabelText('依頼内容') as HTMLTextAreaElement).disabled).toBe(false)
})
it('never repeats a write after an uncertain failure', async () => {
  mocks.write.mockRejectedValue(new Error('response lost'))
  render(<AgentChat />); start()
  fireEvent.click(await screen.findByRole('button', { name: 'この内容で実行' }))
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2))
  expect(mocks.write).toHaveBeenCalledTimes(1)
  expect(mocks.submit.mock.calls[1][1].is_error).toBe(true)
})

it('uses the dedicated reservation summary directly without selecting report operations', async () => {
  mocks.reservations.mockResolvedValue({ source: '/v1/course/tee-ledger', complete: true, reservationTotals: { groups: 29, players: 98 } })
  mocks.execute.mockImplementation(async function* () {
    yield tool('courseboard_get_reservation_status', 'status', { date: '2026-11-07' })
    yield { type: 'done' }
  })
  render(<AgentChat />); start()
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
  expect(mocks.execute.mock.calls[0][1].reservation_status).toBe(true)
  expect(mocks.reservations).toHaveBeenCalledWith({ date: '2026-11-07' }, expect.any(AbortSignal), expect.any(String))
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.submit.mock.calls[0][1].result).toContain('29')
  expect(mocks.submit.mock.calls[0][1].result).toContain('98')
})
