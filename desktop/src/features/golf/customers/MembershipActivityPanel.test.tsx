/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../api'
import { clearResourceCache } from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { MembershipActivityPanel } from './MembershipActivityPanel'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

const first = {
  id: 'mact_1',
  kind: 'membership.subject_updated',
  occurredAt: '2026-09-01T00:00:00Z',
  actor: { type: 'user', id: 'operator_1' },
  source: { channel: 'store', application: null },
  target: { type: 'consent', id: null },
  before: { name: '旧' },
  after: { name: '新' },
  schemaVersion: 1,
}

const second = {
  ...first,
  id: 'mact_2',
  kind: 'membership.future_change',
  target: null,
  before: null,
  after: { future: true },
}

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18next}>
      <MembershipActivityPanel customerId="cus_1" />
    </I18nextProvider>,
  )
}

describe('MembershipActivityPanel', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    api.json.mockReset()
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.restoreAllMocks()
  })

  it('shows a loading state while the first page is pending', () => {
    api.json.mockReturnValue(new Promise(() => undefined))
    renderPanel()

    expect(screen.getByText('会員変更履歴を読み込んでいます。')).toBeTruthy()
    expect(screen.queryByText('会員変更履歴はありません')).toBeNull()
  })

  it('shows EmptyState only for a successful empty page', async () => {
    api.json.mockResolvedValue({ items: [], nextCursor: null })
    renderPanel()

    await waitFor(() => expect(screen.getByText('会員変更履歴はありません')).toBeTruthy())
    expect(screen.getByText('この顧客の会員情報に変更はまだ記録されていません。')).toBeTruthy()
  })

  it('keeps a 404 as a retryable error instead of an empty history', async () => {
    api.json.mockRejectedValueOnce(new ApiError('customer not found', 404))
    renderPanel()

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByText('会員変更履歴はありません')).toBeNull()

    api.json.mockResolvedValueOnce({ items: [first], nextCursor: null })
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    await waitFor(() => expect(screen.getByText('対象を更新')).toBeTruthy())
  })

  it('appends a next page using the opaque cursor', async () => {
    api.json.mockImplementation(async (path: string) => {
      if (path.includes('cursor=next%2F1')) return { items: [second], nextCursor: null }
      return { items: [first], nextCursor: 'next/1' }
    })
    renderPanel()

    await waitFor(() => expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))

    await waitFor(() => expect(screen.getByText(/membership\.future_change/)).toBeTruthy())
    expect(api.json).toHaveBeenLastCalledWith(
      '/v1/course/customers/cus_1/membership-activities?limit=5&cursor=next%2F1',
    )
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull()
  })

  it('renders a target type without inventing an id', async () => {
    api.json.mockResolvedValue({ items: [first], nextCursor: null })
    renderPanel()

    await waitFor(() => expect(screen.getByText('対象を更新')).toBeTruthy())
    expect(screen.getByText('consent')).toBeTruthy()
    expect(screen.queryByText(/consent \/$/)).toBeNull()
  })
})
