/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18next } from '../../i18n'
import { AgentChat } from './AgentChat'
const mocks = vi.hoisted(() => ({ create: vi.fn(), execute: vi.fn(), submit: vi.fn(), write: vi.fn(), field: vi.fn(), reservations: vi.fn() }))
vi.mock('./chat-api', async importOriginal => ({
  ...await importOriginal<typeof import('./chat-api')>(),
  isAgentDemo: () => false,
  agentSessionClient: () => ({ createSession: mocks.create, execute: mocks.execute, submitToolResult: mocks.submit }),
  loadCatalog: vi.fn(async () => ({ operations: [{ operationId: 'update', method: 'PATCH', path: '/v1/course/reservations/{id}', summary: '予約を変更', parameters: [] }, { operationId: 'monthly', method: 'GET', path: '/v1/course/monthly-settlement', summary: 'GET /v1/course/monthly-settlement', parameters: [] }, { operationId: 'ledger', method: 'GET', path: '/v1/course/tee-ledger', summary: '予約台帳', parameters: [] }], schemas: {} })),
  executeOperation: mocks.write,
  callFieldTool: mocks.field,
}))
vi.mock('./reservation-status', async importOriginal => ({ ...await importOriginal<typeof import('./reservation-status')>(), getReservationStatus: mocks.reservations }))
const status = { source: '/v1/course/tee-ledger', sourceLabel: '予約台帳', date: '2026-11-07', timezone: 'Asia/Tokyo', scope: 'all', complete: true, reservationTotals: { groups: 29, players: 98, selfGroups: 20, caddieGroups: 9 }, observedTotals: { groups: 29, players: 98, selfGroups: 20, caddieGroups: 9 }, remainingCapacity: { knownOpenSlots: 306, uncountedCourses: 3, complete: false }, unavailable: [], guidance: '', courses: [{ courseId: 'in', courseName: '滝のIN', groups: 0, players: 0, selfGroups: 0, caddieGroups: 0 }, { courseId: 'out', courseName: '滝のOUT', groups: 4, players: 13, selfGroups: 2, caddieGroups: 2 }] }
const tool = (name: string, id: string, args: object) => ({ type: 'tool_call_pending', tool_name: name, tool_id: id, args })
beforeEach(async () => {
  vi.clearAllMocks()
  sessionStorage.clear()
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
it('renders streamed completion results without the runtime envelope', async () => {
  mocks.execute.mockImplementation(async function* () {
    yield { type: 'say', text: '<attempt_completion> <result> **確認結果**\n\n顧客は0件です。' }
    yield { type: 'say', text: '</result><command></command></attempt_completion>' }
    yield { type: 'done' }
  })
  render(<AgentChat />); start()
  await screen.findByText('顧客は0件です。')
  expect(screen.getByText('確認結果').tagName).toBe('STRONG')
  expect(screen.queryByText(/attempt_completion|<result>|<command>/)).toBeNull()
})
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
  mocks.reservations.mockResolvedValue(status)
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

it('renders source rows exactly and suppresses generated IN/OUT transcriptions', async () => {
  mocks.reservations.mockResolvedValue(status)
  mocks.execute.mockImplementation(async function* () {
    yield { type: 'say', text: '先行する生成文' }
    yield tool('courseboard_get_reservation_status', 'status', { date: '2026-11-07' })
    yield { type: 'say', text: '誤記: 滝のINは4組13名' }
    yield { type: 'attempt_completion', result: '誤記: 滝のOUTは0組' }
    yield { type: 'done' }
  })
  render(<AgentChat />); start()
  await screen.findByRole('button', { name: '送信' })
  expect(within(screen.getByRole('row', { name: '滝のIN 0 0 0 0' })).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0', '0', '0', '0'])
  expect(screen.getByRole('row', { name: '滝のOUT 4 13 2 2' })).toBeTruthy()
  expect(screen.queryByText(/誤記|先行する生成文/)).toBeNull()
  const result = JSON.parse(mocks.submit.mock.calls[0][1].result)
  expect(result.courseBreakdownRenderedByHost).toBe(true)
  expect(result.courses).toBeUndefined()
  expect(JSON.stringify(result)).not.toContain('滝の')
})
it('retains other answers when reservation status is part of a mixed request', async () => {
  mocks.reservations.mockResolvedValue(status)
  mocks.execute.mockImplementation(async function* () {
    yield tool('courseboard_get_reservation_status', 'status', { date: '2026-11-07' })
    yield tool('courseboard_describe_operation', 'describe', { operationId: 'update' })
    yield tool('courseboard_execute_operation', 'write', { operationId: 'update', pathParams: { id: 'r1' } })
    yield { type: 'attempt_completion', result: '予約を更新しました' }
    yield { type: 'done' }
  })
  render(<AgentChat />); start()
  fireEvent.click(await screen.findByRole('button', { name: 'この内容で実行' }))
  await screen.findByText('予約を更新しました')
  expect(screen.getByRole('row', { name: '滝のOUT 4 13 2 2' })).toBeTruthy()
})

it('also renders authoritative rows when the generic ledger operation is selected', async () => {
  mocks.write.mockResolvedValue(status)
  mocks.execute.mockImplementation(async function* () {
    yield tool('courseboard_describe_operation', 'describe', { operationId: 'ledger' })
    yield tool('courseboard_execute_operation', 'ledger', { operationId: 'ledger', query: { date: status.date } })
    yield { type: 'attempt_completion', result: '誤記: 滝のINは4組13名' }
    yield { type: 'done' }
  })
  render(<AgentChat />); start()
  await screen.findByRole('button', { name: '送信' })
  expect(screen.getByRole('row', { name: '滝のOUT 4 13 2 2' })).toBeTruthy()
  expect(screen.queryByText(/誤記/)).toBeNull()
})

it('submits with Cmd/Ctrl+Enter while preserving normal Enter and IME composition', async () => {
  mocks.execute.mockImplementation(async function* () { yield { type: 'done' } })
  render(<AgentChat />)
  const input = screen.getByLabelText('依頼内容')
  fireEvent.change(input, { target: { value: '予約を調べて' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true, isComposing: true })
  expect(mocks.execute).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1))
  await screen.findByRole('button', { name: '送信' })
  fireEvent.change(input, { target: { value: '売上を調べて' } })
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: '送信' }).closest('.agent-composer-input')?.contains(input)).toBe(true)
  expect(screen.queryByText('データの更新前に、内容を確認できます。')).toBeNull()
})

it('collapses completed activities and uses business descriptions instead of endpoints', async () => {
  let finish!: () => void
  const done = new Promise<void>(resolve => { finish = resolve })
  mocks.execute.mockImplementation(async function* () {
    yield tool('courseboard_describe_operation', 'describe-month', { operationId: 'monthly' })
    yield tool('courseboard_execute_operation', 'read-month', { operationId: 'monthly' })
    yield { type: 'say', text: '月の集計です' }
    await done
    yield { type: 'done' }
  })
  render(<AgentChat />); start()
  await screen.findByText('月の集計です')
  const log = screen.getByText('作業中…').closest('details')!
  expect(log.open).toBe(true)
  expect(within(log).getByText('月次集計を確認しています')).toBeTruthy()
  expect([...log.querySelectorAll('summary')].some(summary => /GET \/v1\/course/.test(summary.textContent ?? ''))).toBe(false)
  finish()
  await screen.findByText('作業履歴（2件完了）')
  await waitFor(() => expect(log.open).toBe(false))
  fireEvent.click(within(log).getByText('作業履歴（2件完了）'))
  expect(log.open).toBe(true)
  expect(screen.getByText('月の集計です')).toBeTruthy()
})

it('opens an empty history and restores a previous conversation with its original session', async () => {
  mocks.create.mockResolvedValueOnce('as_first').mockResolvedValueOnce('as_second')
  mocks.execute.mockImplementation(async function* () {
    yield { type: 'attempt_completion', result: '回答しました' }
    yield { type: 'done' }
  })
  render(<AgentChat historyKey="history:tenant:user" />)
  fireEvent.click(screen.getByRole('button', { name: '会話の履歴を開く' }))
  expect(screen.getByText('まだ会話がありません。')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  start()
  await screen.findByText('回答しました')
  fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '続きの下書き' } })
  fireEvent.click(screen.getByRole('button', { name: '新しい会話' }))
  fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '別の相談' } })
  fireEvent.click(screen.getByRole('button', { name: '送信' }))
  await screen.findByText('回答しました')
  fireEvent.click(screen.getByRole('button', { name: '会話の履歴を開く' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /予約を変更して/ }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByLabelText('依頼内容') as HTMLTextAreaElement).value).toBe('続きの下書き')
  fireEvent.click(screen.getByRole('button', { name: '送信' }))
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(3))
  expect(mocks.execute.mock.calls[2][0]).toBe('as_first')
  expect(mocks.create).toHaveBeenCalledTimes(2)
})

it('restores the history after remounting and isolates another account', async () => {
  mocks.execute.mockImplementation(async function* () {
    yield { type: 'attempt_completion', result: '保存された回答' }
    yield { type: 'done' }
  })
  const view = render(<AgentChat historyKey="history:tenant:user" />)
  start()
  await screen.findByText('保存された回答')
  view.unmount()
  const restored = render(<AgentChat historyKey="history:tenant:user" />)
  expect(screen.getByText('保存された回答')).toBeTruthy()
  restored.unmount()
  render(<AgentChat historyKey="history:tenant:other-user" />)
  expect(screen.queryByText('保存された回答')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '会話の履歴を開く' }))
  expect(screen.getByText('まだ会話がありません。')).toBeTruthy()
})

it('restores an interrupted turn as read-only without replaying a pending change', async () => {
  const view = render(<AgentChat historyKey="history:tenant:user" />)
  start()
  await screen.findByRole('button', { name: 'この内容で実行' })
  view.unmount()
  render(<AgentChat historyKey="history:tenant:user" />)
  expect((screen.getByLabelText('依頼内容') as HTMLTextAreaElement).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: 'この内容で実行' })).toBeNull()
  expect(screen.getByText(/処理を中断しました/)).toBeTruthy()
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.execute).toHaveBeenCalledTimes(1)
})

it('shows tool inputs and results only when the trace row is expanded', async () => {
  mocks.execute.mockImplementation(async function* () {
    yield tool('courseboard_describe_operation', 'describe', { operationId: 'update' })
    yield { type: 'done' }
  })
  const { container } = render(<AgentChat />)
  start()
  await waitFor(() => expect(container.querySelector('details[data-state="ok"]')).toBeTruthy())
  const log = container.querySelector<HTMLDetailsElement>('details.agent-activity-log')!
  fireEvent.click(within(log).getByText('作業履歴（1件完了）'))
  const trace = container.querySelector<HTMLDetailsElement>('details.agent-trace')!
  expect(trace.open).toBe(false)
  fireEvent.click(within(trace).getByText('操作内容を確認しています'))
  expect(trace.open).toBe(true)
  expect(within(trace).getByText('入力')).toBeTruthy()
  expect(within(trace).getByText('結果')).toBeTruthy()
  expect(trace.textContent).toContain('operationId')
  expect(trace.textContent).toContain('予約を変更')
})

it('keeps an unsent draft when switching to a new conversation', () => {
  render(<AgentChat historyKey="history:tenant:user" />)
  fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '明日の予約を確認したい' } })
  fireEvent.click(screen.getByRole('button', { name: '新しい会話' }))
  fireEvent.click(screen.getByRole('button', { name: '会話の履歴を開く' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /明日の予約を確認したい/ }))
  expect((screen.getByLabelText('依頼内容') as HTMLTextAreaElement).value).toBe('明日の予約を確認したい')
  expect(mocks.execute).not.toHaveBeenCalled()
})

it('starts normally if a stored history is unreadable', () => {
  sessionStorage.setItem('history:tenant:user', '{invalid')
  render(<AgentChat historyKey="history:tenant:user" />)
  expect(screen.getByRole('heading', { name: 'Courseboard エージェント' })).toBeTruthy()
  expect((screen.getByLabelText('依頼内容') as HTMLTextAreaElement).disabled).toBe(false)
})
