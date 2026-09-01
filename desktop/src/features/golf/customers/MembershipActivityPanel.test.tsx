/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../api'
import { clearResourceCache, writeResourceCache } from '../../../hooks/useResource'
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

function renderPanel(refreshRevision = 0, customerId = 'cus_1') {
  return render(
    <I18nextProvider i18n={i18next}>
      <MembershipActivityPanel customerId={customerId} refreshRevision={refreshRevision} />
    </I18nextProvider>,
  )
}

function activityCacheKey(customerId = 'cus_1', refreshRevision = 0) {
  return `customer:membership-activities:${customerId}\u0000${refreshRevision}`
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

  it('reloads the first page when a successful sibling mutation advances its revision', async () => {
    api.json
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ ...first, kind: 'membership.plan_assigned' }], nextCursor: null })
    const view = renderPanel()

    await screen.findByText('会員変更履歴はありません')
    view.rerender(
      <I18nextProvider i18n={i18next}>
        <MembershipActivityPanel customerId="cus_1" refreshRevision={1} />
      </I18nextProvider>,
    )

    await waitFor(() => expect(api.json).toHaveBeenCalledTimes(2))
    await screen.findByText('プランを割り当て')
  })

  it('does not surface the old first page while a same-customer revision loads', async () => {
    const oldFirst = { ...first, id: 'old-first', after: { name: '旧 revision' } }
    const refreshedFirst = { ...first, id: 'refreshed-first', after: { name: '更新済み revision' } }
    let finishRefresh: ((page: { items: typeof refreshedFirst[]; nextCursor: null }) => void) | undefined
    const refresh = new Promise<{ items: typeof refreshedFirst[]; nextCursor: null }>(resolve => {
      finishRefresh = resolve
    })
    api.json
      .mockResolvedValueOnce({ items: [oldFirst], nextCursor: 'old/1' })
      .mockReturnValueOnce(refresh)
    const view = renderPanel()

    await screen.findAllByText('旧 revision')
    view.rerender(
      <I18nextProvider i18n={i18next}>
        <MembershipActivityPanel customerId="cus_1" refreshRevision={1} />
      </I18nextProvider>,
    )

    expect(screen.queryByText('旧 revision')).toBeNull()
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull()
    expect(screen.getByText('会員変更履歴を読み込んでいます。')).toBeTruthy()

    finishRefresh?.({ items: [refreshedFirst], nextCursor: null })
    await screen.findAllByText('更新済み revision')
  })

  it('unions an append-only revalidated first page with retained pages and keeps their cursor', async () => {
    const activity = (id: string) => ({ ...first, id, before: null, after: { name: id } })
    const oldFirst = ['activity-A', 'activity-B', 'activity-C', 'activity-D', 'activity-E'].map(activity)
    const loadedPage = ['activity-F', 'activity-G', 'activity-H', 'activity-I', 'activity-J'].map(activity)
    const revalidatedFirst = {
      items: [activity('activity-N'), ...oldFirst.slice(0, 4)],
      nextCursor: 'new-first-cursor',
    }
    writeResourceCache(activityCacheKey(), {
      items: oldFirst,
      nextCursor: 'old-first-cursor',
    })
    let finishRevalidation: ((page: typeof revalidatedFirst) => void) | undefined
    const revalidation = new Promise<typeof revalidatedFirst>(resolve => {
      finishRevalidation = resolve
    })
    api.json.mockImplementation((path: string) => {
      if (path.includes('cursor=old-first-cursor')) {
        return Promise.resolve({ items: loadedPage, nextCursor: 'after-J-cursor' })
      }
      if (path.includes('cursor=after-J-cursor')) return Promise.resolve({ items: [], nextCursor: null })
      return revalidation
    })
    renderPanel()

    await screen.findByRole('button', { name: 'さらに読み込む' })
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    await waitFor(() => expect(document.querySelectorAll('.membership-activity-row')).toHaveLength(10))

    finishRevalidation?.(revalidatedFirst)
    await waitFor(() => expect(document.querySelectorAll('.membership-activity-row')).toHaveLength(11))
    const rows = [...document.querySelectorAll('.membership-activity-row')]
    for (const id of [
      'activity-N',
      'activity-A',
      'activity-B',
      'activity-C',
      'activity-D',
      'activity-E',
      'activity-F',
      'activity-G',
      'activity-H',
      'activity-I',
      'activity-J',
    ]) {
      expect(rows.filter(row => row.textContent?.includes(id))).toHaveLength(1)
    }

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    await waitFor(() => expect(api.json).toHaveBeenCalledWith(
      '/v1/course/customers/cus_1/membership-activities?limit=5&cursor=after-J-cursor',
    ))
  })

  it('does not expose old pagination items, errors, or loading after a scope change', async () => {
    const oldExtra = { ...first, id: 'old-extra', before: null, after: { name: 'old-extra' } }
    let secondLoad = true
    api.json.mockImplementation((path: string) => {
      if (path.includes('customers/cus_1/membership-activities?limit=5&cursor=old%2F1')) {
        return Promise.resolve({ items: [oldExtra], nextCursor: 'old/2' })
      }
      if (path.includes('customers/cus_1/membership-activities?limit=5&cursor=old%2F2')) {
        return new Promise(() => undefined)
      }
      if (path.includes('customers/cus_1/membership-activities')) {
        // The first request supplies the first cursor; subsequent calls here
        // are only a safety net for revalidation in this focused test.
        if (secondLoad) {
          secondLoad = false
          return Promise.resolve({ items: [first], nextCursor: 'old/1' })
        }
        return Promise.resolve({ items: [first], nextCursor: 'old/1' })
      }
      return new Promise(() => undefined)
    })
    const view = renderPanel()

    await screen.findByRole('button', { name: 'さらに読み込む' })
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    await screen.findAllByText('old-extra')
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    await screen.findByRole('button', { name: 'さらに読み込んでいます…' })

    view.rerender(
      <I18nextProvider i18n={i18next}>
        <MembershipActivityPanel customerId="cus_2" />
      </I18nextProvider>,
    )

    expect(screen.queryByText('old-extra')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'さらに読み込んでいます…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull()
    expect(screen.getByText('会員変更履歴を読み込んでいます。')).toBeTruthy()
  })

  it('ignores an old load-more success after the customer changes', async () => {
    const oldExtra = { ...second, id: 'mact_old' }
    const newFirst = { ...first, id: 'mact_new', after: { name: '新しい顧客' } }
    let finishOldPage: ((page: { items: typeof oldExtra[]; nextCursor: null }) => void) | undefined
    let oldPageSettled = false
    const oldPage = new Promise<{ items: typeof oldExtra[]; nextCursor: null }>(resolve => {
      finishOldPage = resolve
    })
    void oldPage.then(() => { oldPageSettled = true })
    api.json.mockImplementation((path: string) => {
      if (path.includes('customers/cus_1/membership-activities?limit=5&cursor=old%2F1')) {
        return oldPage
      }
      if (path.includes('customers/cus_1/membership-activities')) {
        return Promise.resolve({ items: [first], nextCursor: 'old/1' })
      }
      if (path.includes('customers/cus_2/membership-activities?limit=5&cursor=new%2F1')) {
        return Promise.resolve({ items: [second], nextCursor: null })
      }
      return Promise.resolve({ items: [newFirst], nextCursor: 'new/1' })
    })
    const view = renderPanel()

    await screen.findByRole('button', { name: 'さらに読み込む' })
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    view.rerender(
      <I18nextProvider i18n={i18next}>
        <MembershipActivityPanel customerId="cus_2" />
      </I18nextProvider>,
    )
    await screen.findAllByText('新しい顧客')

    finishOldPage?.({ items: [oldExtra], nextCursor: null })
    await waitFor(() => expect(oldPageSettled).toBe(true))
    await waitFor(() => expect(screen.queryByText(/membership\.future_change/)).toBeNull())
    expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    await waitFor(() => expect(api.json).toHaveBeenCalledWith(
      '/v1/course/customers/cus_2/membership-activities?limit=5&cursor=new%2F1',
    ))
  })

  it('ignores an old load-more failure after the refresh revision changes', async () => {
    let rejectOldPage: ((error: Error) => void) | undefined
    let oldPageSettled = false
    const oldPage = new Promise<never>((_resolve, reject) => {
      rejectOldPage = reject
    })
    void oldPage.then(
      () => { oldPageSettled = true },
      () => { oldPageSettled = true },
    )
    let initialFirstPage = true
    api.json.mockImplementation((path: string) => {
      if (path.includes('cursor=old%2F1')) return oldPage
      if (path.includes('customers/cus_1/membership-activities')) {
        if (initialFirstPage) {
          initialFirstPage = false
          return Promise.resolve({ items: [first], nextCursor: 'old/1' })
        }
        return Promise.resolve({ items: [{ ...first, after: { name: '更新済み' } }], nextCursor: 'new/1' })
      }
      throw new Error(`Unexpected API path: ${path}`)
    })
    const view = renderPanel()

    await screen.findByRole('button', { name: 'さらに読み込む' })
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    view.rerender(
      <I18nextProvider i18n={i18next}>
        <MembershipActivityPanel customerId="cus_1" refreshRevision={1} />
      </I18nextProvider>,
    )
    await screen.findAllByText('更新済み')

    rejectOldPage?.(new Error('old page failed'))
    await waitFor(() => expect(oldPageSettled).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeTruthy()
  })
})
