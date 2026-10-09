/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18next } from '../../../i18n'
import { ReservationDocumentPage } from './ReservationDocumentPage'
import type { ImportJob } from './api'

const mock = vi.hoisted(() => ({ json: vi.fn(), targets: vi.fn(), get: vi.fn(), execute: vi.fn(), reserve: vi.fn() }))
vi.mock('../../../api', () => ({ courseboardApiJson: mock.json }))
vi.mock('../../../auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', tenant: { id: 't', operatorId: 'tenant-a', platformId: 'platform-a' }, user: { id: 'actor-a' } } }) }))
vi.mock('../customers/reception/PdfPages', () => ({ PdfPages: () => null }))
vi.mock('./api', () => ({ listTargets: mock.targets, getJob: mock.get, issueMessage: () => '' }))
vi.mock('./document-api', () => ({ executeDocumentRevision: mock.execute, reserveReservationDocument: mock.reserve, saveDocumentRevision: vi.fn(), readReservationDocument: vi.fn(), fetchDocumentOriginal: vi.fn(), uploadDocumentSources: vi.fn() }))
const running = {
  id: 'dtj_saved', objectKey: 'courseboardReservationReports', status: 'running',
  processed: 1, total: 1, validationErrors: [], importOptions: { year: 2026 },
  document: { rowField: 'rows', sources: [], ocrStatus: 'completed', expiresAt: '2020-01-01', executionConfirmed: true,
    revisionVersion: 1, revisionSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
    extracted: { fields: { rows: [] }, warnings: [] }, revision: { version: 1, sha256: 'a'.repeat(64), rows: [] } },
} as unknown as ImportJob
beforeEach(async () => { vi.clearAllMocks(); localStorage.clear(); await i18next.changeLanguage('ja') })
afterEach(cleanup)
function mount(jobId?: string) { render(<I18nextProvider i18n={i18next}><ReservationDocumentPage jobId={jobId} /></I18nextProvider>) }
it('restores and reconciles the same confirmed job after expiry and catalog failure', async () => {
  mock.targets.mockRejectedValue(new Error('offline'))
  mock.json.mockRejectedValue(new Error('offline'))
  mock.get.mockResolvedValue(running)
  mock.execute.mockResolvedValue({ ...running, status: 'completed' })
  localStorage.setItem('courseboard.document-operation:tenant-a:platform-a:actor-a', JSON.stringify({ idempotencyKey: 'original', jobId: running.id }))
  mount()
  await screen.findByText(/施設の一覧を取得できません/)
  const reconcile = await screen.findByRole('button', { name: '同じ保存の結果を確認・再開' }) as HTMLButtonElement
  expect(reconcile.disabled).toBe(false)
  fireEvent.click(reconcile)
  await screen.findByText(/全行を反映した保存結果/)
  expect(mock.execute).toHaveBeenCalledWith(running, 'confirm', expect.any(AbortSignal))
  expect(mock.reserve).not.toHaveBeenCalled()
})
it('does not create replacement work when the durable retry handle is damaged', async () => {
  localStorage.setItem('courseboard.document-operation:tenant-a:platform-a:actor-a', '{damaged')
  mount()
  await screen.findByText(/再開に必要な情報を端末に保存できません/)
  expect(mock.reserve).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: '選んだPDFを読み取る' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mock.targets).not.toHaveBeenCalled()
})
it('requires an explicit new read after a terminal failure and preserves the old history handle', async () => {
  mock.targets.mockResolvedValue([{ key: 'courseboardReservationReports', documentImport: { pricingStatus: 'undecided' } }])
  mock.json.mockResolvedValue({ items: [] })
  mock.get.mockResolvedValue({ ...running, status: 'invalid', document: { ...running.document!, executionConfirmed: false, ocrStatus: 'failed', extracted: undefined, revision: undefined } })
  const key = 'courseboard.document-operation:tenant-a:platform-a:actor-a'
  localStorage.setItem(key, JSON.stringify({ idempotencyKey: 'old-read', jobId: running.id }))
  mount()
  await screen.findByText(/この読取は再開できません/)
  expect(JSON.parse(localStorage.getItem(key)!).idempotencyKey).toBe('old-read')
  expect(mock.reserve).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '次のPDFを選ぶ' }))
  await screen.findByRole('button', { name: '選んだPDFを読み取る' })
  const next = JSON.parse(localStorage.getItem(key)!)
  expect(next.idempotencyKey).not.toBe('old-read')
  expect(next.jobId).toBeUndefined()
  expect(mock.reserve).not.toHaveBeenCalled()
})

it('opens results and permits the next PDF after completed-with-errors without replaying terminal work', async () => {
  mock.targets.mockResolvedValue([{ key: 'courseboardReservationReports', documentImport: { pricingStatus: 'undecided' } }])
  mock.json.mockResolvedValue({ items: [] })
  mock.get.mockResolvedValue({ ...running, status: 'completed_with_errors', errors: 1 })
  const key = 'courseboard.document-operation:tenant-a:platform-a:actor-a'
  localStorage.setItem(key, JSON.stringify({ idempotencyKey: 'old-read', jobId: running.id }))
  mount()
  await screen.findByText(/保存できなかった行があります/)
  expect(screen.queryByText(/全行を反映した保存結果/)).toBeNull()
  expect(screen.queryByRole('button', { name: '同じ保存の結果を確認・再開' })).toBeNull()
  expect(screen.getByRole('button', { name: '保存した予約表を開く' })).toBeTruthy()
  expect(mock.execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '次のPDFを選ぶ' }))
  await screen.findByRole('button', { name: '選んだPDFを読み取る' })
  expect(JSON.parse(localStorage.getItem(key)!).jobId).toBeUndefined()
  expect(mock.reserve).not.toHaveBeenCalled()
})
it('keeps server placeholders reviewable for unreadable pages and an entirely unreadable PDF', async () => {
  mock.targets.mockResolvedValue([{ key: 'courseboardReservationReports', documentImport: { pricingStatus: 'undecided' } }])
  mock.json.mockResolvedValue({ items: [] })
  const rows = [
    { _source_index: 0, _source_page: 1, _source_row: 2, cells: '{"facilityName":"East"}' },
    { _source_index: 0, _source_page: 2, _source_row: 1, cells: '{}' },
    { _source_index: 1, _source_page: 1, _source_row: 1, cells: '{}' },
    { _source_index: 1, _source_page: 2, _source_row: 1, cells: '{}' },
  ]
  mock.get.mockResolvedValue({ ...running, status: 'review', document: { ...running.document!, executionConfirmed: false, expiresAt: '2099-01-01', revision: undefined,
    sources: [{ index: 0 }, { index: 1 }], extracted: { fields: { rows }, warnings: [] } } })
  mount(running.id)
  await screen.findByRole('heading', { name: '原本 2 · 2ページ · 1行目' })
  expect(screen.getAllByText(/このページから表を読み取れませんでした/)).toHaveLength(3)
  fireEvent.change(screen.getByRole('combobox', { name: '原本ファイル' }), { target: { value: '1' } })
  const pages = screen.getByRole('combobox', { name: '原本のページ' }) as HTMLSelectElement
  expect(Array.from(pages.options, option => option.value)).toEqual(['1', '2'])
  fireEvent.change(screen.getAllByRole('textbox', { name: '施設名' })[0]!, { target: { value: 'Corrected East' } })
  expect((screen.getByRole('button', { name: '確認した修正を保存' }) as HTMLButtonElement).disabled).toBe(true)
})
