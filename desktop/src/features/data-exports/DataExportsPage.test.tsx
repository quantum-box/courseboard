/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api'
import { clearResourceCache } from '../../hooks/useResource'
import { PageReloadProvider } from '../../lib/pageReload'
import { DataExportsPage } from './DataExportsPage'
import type { ExportDefinition } from './api'

const api = vi.hoisted(() => ({ json: vi.fn(), text: vi.fn(), download: vi.fn() }))
vi.mock('../../api', async original => ({
  ...await original<typeof import('../../api')>(),
  fieldApiJson: api.json, fieldApiText: api.text, downloadBlob: api.download,
}))
vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))

const objects = [{ key: 'reservation', label: '予約', fields: [
  { field: 'customer_name', label: '顧客名' },
  { field: 'reservation_number', label: '予約番号' },
] }]
const definition: ExportDefinition = {
  id: 'bxd_1', name: '予約表', sourceObject: 'reservation',
  destinationType: 'csv', status: 'active', mapping: { fields: [
    { source: 'customer_name', target: '顧客名', required: false, approved: true },
  ] },
}
let definitions: ExportDefinition[]

function renderPage() {
  return render(<PageReloadProvider><DataExportsPage /></PageReloadProvider>)
}

describe('data export settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearResourceCache()
    definitions = [definition, { ...definition, id: 'bxd_2', name: '停止中', status: 'inactive' }]
    api.text.mockResolvedValue('顧客名\n山田\n')
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/objects')) return { items: objects }
      if (path.endsWith('/definitions') && init?.method === 'POST') {
        return { ...JSON.parse(String(init.body)), id: 'bxd_new' }
      }
      if (path.endsWith('/definitions')) return { items: definitions }
      throw new Error(`Unexpected path: ${path}`)
    })
  })
  afterEach(() => { cleanup(); clearResourceCache() })

  it('shows existing settings and only enables exports for active, accessible sources', async () => {
    definitions.push({ ...definition, id: 'bxd_3', name: '権限のない出力', sourceObject: 'private' })
    renderPage()
    const download = await screen.findByRole<HTMLButtonElement>('button', { name: '予約表のCSVを保存' })
    expect(download.disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '停止中のCSVを保存' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '権限のない出力のCSVを保存' }).disabled).toBe(true)
    fireEvent.click(download)
    await waitFor(() => expect(api.download).toHaveBeenCalledOnce())
  })

  it('creates a reusable definition with renamed, reordered selected columns', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: '出力設定を追加' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /出力設定名/ }), { target: { value: '自分の予約表' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /出力するデータ/ }), { target: { value: 'reservation' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '顧客名' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '予約番号' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: '顧客名の出力列名' }), { target: { value: 'お客様' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '予約番号を上へ' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await screen.findByText('自分の予約表')
    const [, request] = api.json.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(request.body).mapping.fields.map((field: { source: string; target: string }) => [field.source, field.target]))
      .toEqual([['reservation_number', '予約番号'], ['customer_name', 'お客様']])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps download failures beside the affected row and retries without saving an error body as a CSV', async () => {
    api.text.mockRejectedValueOnce(new ApiError('Forbidden', 403))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '予約表のCSVを保存' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('権限がありません')
    expect(api.download).not.toHaveBeenCalled()
    fireEvent.click(within(alert).getByRole('button', { name: 'もう一度試す' }))
    await waitFor(() => expect(api.download).toHaveBeenCalledOnce())
  })

  it('retries a failed catalogue request before allowing creation', async () => {
    api.json.mockRejectedValueOnce(new ApiError('Forbidden', 403))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '出力設定を追加' }).disabled).toBe(true)
    fireEvent.click(within(alert).getByRole('button', { name: 'もう一度試す' }))
    await screen.findByRole('table')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '出力設定を追加' }).disabled).toBe(false)
  })
})
