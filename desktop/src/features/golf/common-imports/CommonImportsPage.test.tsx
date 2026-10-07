/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../../../i18n'
import { CommonImportsPage } from './CommonImportsPage'
import type { ImportJob } from './api'

const mock = vi.hoisted(() => ({ json: vi.fn(), jobs: vi.fn(), job: vi.fn(), step: vi.fn() }))
vi.mock('../../../api', async importOriginal => ({
  ...await importOriginal<typeof import('../../../api')>(), courseboardApiJson: mock.json,
}))
vi.mock('../../../auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', tenant: { id: 'tenant-a' } } }) }))
vi.mock('../../../feature-flags/gated-routes', () => ({ useRouteGate: () => 'visible' }))
vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  listTargets: async () => ['customer', 'courseboardReservationReports'].map(key => ({ key, label: key === 'customer' ? '顧客台帳' : '予約表集計', importModes: ['create_only'], import: { writable: true, fields: [] } })),
  listJobs: mock.jobs, getJob: mock.job, stepJob: mock.step,
}))
const ready: ImportJob = {
  id: 'dtj_report', objectKey: 'courseboardReservationReports', status: 'ready', mode: 'create_only',
  processed: 0, total: 1, created: 0, updated: 0, errors: 0, validationErrors: [], preview: [],
  batch: false, previewPage: 0, previewPages: 1, filename: 'input.csv', failure: null,
  importOptions: { year: 2026 }, sourceSha256: 'a'.repeat(64), createdAt: '2026-10-07T00:00:00Z',
}
function renderPage() {
  render(<I18nextProvider i18n={i18next}><CommonImportsPage initialTarget="courseboardReservationReports" /></I18nextProvider>)
}
describe('reservation report course catalog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18next.changeLanguage('ja')
    mock.jobs.mockResolvedValue([])
    mock.job.mockResolvedValue(ready)
  })
  afterEach(cleanup)
  it('blocks upload and confirmation on catalog failure, allows customer imports, and retries', async () => {
    mock.json.mockRejectedValueOnce(new Error('catalog unavailable')).mockResolvedValue({ items: [] })
    mock.jobs.mockResolvedValue([ready])
    renderPage()
    await screen.findByText(/コース一覧を取得できないため/)
    const file = screen.getByLabelText('CSV／Excel') as HTMLInputElement
    expect(file.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    const confirm = await screen.findByRole('button', { name: '確認して取り込む' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(mock.step).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('取込対象'), { target: { value: 'customer' } })
    expect(file.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('取込対象'), { target: { value: 'courseboardReservationReports' } })
    expect(file.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'コース一覧を再取得' }))
    await waitFor(() => expect(file.disabled).toBe(false))
    expect(mock.json).toHaveBeenCalledTimes(2)
  })
  it('excludes inactive courses while retaining the unlinked facility option', async () => {
    mock.json.mockResolvedValue({ items: [
      { id: 'active', name: '営業中', isActive: true },
      { id: 'inactive', name: '停止中', isActive: false },
    ] })
    renderPage()
    await waitFor(() => expect((screen.getByLabelText('CSV／Excel') as HTMLInputElement).disabled).toBe(false))
    const mapping = screen.getByLabelText('対応するコース') as HTMLSelectElement
    expect(Array.from(mapping.options).map(option => option.value)).toEqual(['', 'active'])
  })
  it('allows a fully staged job to reconcile its receipt while the catalog is unavailable', async () => {
    const running = { ...ready, status: 'running', processed: 1, created: 1 }
    mock.json.mockRejectedValue(new Error('catalog unavailable'))
    mock.jobs.mockResolvedValue([running])
    mock.job.mockResolvedValue(running)
    mock.step.mockResolvedValue({ ...running, status: 'completed' })
    renderPage()
    await screen.findByText(/コース一覧を取得できないため/)
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    const reconcile = await screen.findByRole('button', { name: '処理を再開' }) as HTMLButtonElement
    expect(reconcile.disabled).toBe(false)
    expect((screen.getByLabelText('CSV／Excel') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(reconcile)
    await screen.findByText('完了：1 / 1 行')
    expect(mock.step).toHaveBeenCalledTimes(1)
    expect(mock.step).toHaveBeenCalledWith('dtj_report', 'advance', expect.any(AbortSignal))
  })
})
