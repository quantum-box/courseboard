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
