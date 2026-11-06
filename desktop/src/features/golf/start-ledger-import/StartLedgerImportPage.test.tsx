/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18next } from '../../../i18n'
import { StartLedgerImportPage } from './StartLedgerImportPage'
import type { StartLedgerContext, StartLedgerRead } from './api'

const mock = vi.hoisted(() => ({ create: vi.fn(), upload: vi.fn(), step: vi.fn(), get: vi.fn(), cancel: vi.fn(), context: vi.fn(), importParties: vi.fn() }))
vi.mock('../../../auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', tenant: { id: 't', operatorId: 'tenant-a', platformId: 'platform-a' }, user: { id: 'actor-a' } } }) }))
vi.mock('../customers/reception/PdfPages', () => ({ PdfPages: () => null }))
vi.mock('./api', async importOriginal => ({
  ...(await importOriginal<typeof import('./api')>()),
  createStartLedgerJob: mock.create, uploadStartLedgerPdfs: mock.upload, stepStartLedgerJob: mock.step,
  getStartLedgerJob: mock.get, cancelStartLedgerJob: mock.cancel, getStartLedgerContext: mock.context, importStartLedgerParties: mock.importParties,
}))

const context: StartLedgerContext = {
  courses: [{ id: 'out', name: '空沼OUT' }, { id: 'in', name: '空沼IN' }],
  plans: [
    { reservationServiceId: 'early133', name: '早期予約133', requiresCaddie: true },
    { reservationServiceId: 'early19', name: '早期予約19（全20回）', requiresCaddie: false },
  ],
  booked: [],
}
const completed: StartLedgerRead = {
  id: 'goj_1', status: 'completed', completedUnits: 3, totalUnits: 3, date: '2026-11-07', warnings: [],
  parties: [
    { courseName: '空沼OUT', teeTime: '08:45', playStyle: 'caddie', playStyleText: 'キャディ', representative: '菊池 芳彦', groupName: '菊池 芳彦 様', planName: '早期予約133',
      players: [{ tag: '共通', number: '1', name: '丹治 敦' }], remarks: {}, copiedFromAbove: [], warnings: [] },
    { courseName: '空沼OUT', teeTime: '08:52', playStyle: 'caddie', playStyleText: 'キャディ', representative: '菊池 芳彦', groupName: '菊池 芳彦 様', planName: '早期予約19（全20回）',
      players: [{ tag: '共通', number: '1', name: '山形 洋一' }], remarks: { meal: '各自注文', scoreTally: true, settlement: 'individual' }, copiedFromAbove: ['representative', 'groupName'], warnings: [] },
  ],
}

beforeEach(async () => { vi.clearAllMocks(); localStorage.clear(); await i18next.changeLanguage('ja') })
afterEach(cleanup)
const mount = () => render(<I18nextProvider i18n={i18next}><StartLedgerImportPage /></I18nextProvider>)
const pdf = () => new File(['%PDF-1.7'], 'ledger.pdf', { type: 'application/pdf' })

it('reads a PDF, lists one group at a time, and books only the checked groups', async () => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:ledger')
  globalThis.URL.revokeObjectURL = vi.fn()
  mock.create.mockResolvedValue({ job: { ...completed, status: 'uploading', parties: [], completedUnits: 0 }, uploads: [{ storageKey: 'k', uploadUrl: 'https://s/put', expiresAt: '' }] })
  mock.step.mockImplementation((_id: string, step: string) => Promise.resolve(step === 'confirm' ? { ...completed, status: 'running', parties: [] } : completed))
  mock.context.mockResolvedValue(context)
  mock.importParties.mockResolvedValue([{ outcome: 'created', reservationId: 'r-1' }])
  const { container } = mount()

  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [pdf()] } })
  fireEvent.click(screen.getByRole('button', { name: '選んだPDFを読み取る' }))
  const first = await screen.findByRole('region', { name: '空沼OUT 08:45' })
  expect(mock.upload).toHaveBeenCalledOnce()
  expect(mock.context).toHaveBeenCalledWith('2026-11-07', expect.any(AbortSignal))
  expect(JSON.parse(localStorage.getItem('courseboard.start-ledger-operation:tenant-a:platform-a:actor-a')!).jobId).toBe('goj_1')

  const second = screen.getByRole('region', { name: '空沼OUT 08:52' })
  expect(within(second).getByText(/上の組から補いました/u)).toBeTruthy()
  // The sheet says キャディ; the plan matched by name is self-play.
  expect(within(second).getByText(/選んだプランはセルフです/u)).toBeTruthy()

  const importButton = () => screen.getByRole('button', { name: /予約台帳に登録/u }) as HTMLButtonElement
  expect(importButton().disabled).toBe(true)
  fireEvent.click(within(first).getByRole('checkbox', { name: '原本と照合した' }))
  expect(importButton().textContent).toContain('1 組')
  fireEvent.click(importButton())

  await screen.findByText('登録 1 組・とばした組 0 組・失敗 0 組')
  expect(mock.importParties).toHaveBeenCalledWith('2026-11-07', [{
    golfCourseId: 'out', teeTime: '08:45', reservationServiceId: 'early133', customerName: '菊池 芳彦', quantity: 1,
    competitionName: null, players: [{ name: '丹治 敦', tag: '共通', memberNumber: '1' }], remarks: {}, notes: null,
  }], expect.any(AbortSignal))
  expect(within(first).getByText('登録しました')).toBeTruthy()
  // The second group is still unbooked, so a reload must still find this read.
  expect(JSON.parse(localStorage.getItem('courseboard.start-ledger-operation:tenant-a:platform-a:actor-a')!).jobId).toBe('goj_1')
})

it('resumes the read this desk left behind', async () => {
  localStorage.setItem('courseboard.start-ledger-operation:tenant-a:platform-a:actor-a', JSON.stringify({ idempotencyKey: 'k', jobId: 'goj_1' }))
  mock.get.mockResolvedValue(completed)
  mock.context.mockResolvedValue(context)
  mount()
  await screen.findByRole('region', { name: '空沼OUT 08:45' })
  expect(mock.get).toHaveBeenCalledWith('goj_1', expect.any(AbortSignal))
  expect(screen.getByText(/原本を見ながら確認するには/u)).toBeTruthy()
})
