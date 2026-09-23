/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { clearResourceCache } from '../../../hooks/useResource'
import { CustomersPage } from './CustomersPage'
import { useCustomerSearch } from './useCustomerSearch'

function SearchResult({ query }: { query: string }) {
  const search = useCustomerSearch(query)
  return (
    <output data-testid="customer-ids">
      {search.candidates.map(customer => customer.id).join(',')}
    </output>
  )
}

/** Mirrors the ledger table's page size; a second page needs one row more. */
const PAGE_ROWS = 20

async function finishDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
}

describe('customer search acceptance', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it.each([
    ['1文字の氏名', '辻', 'cus_tsuji'],
    ['カナ', 'マスダ', 'cus_masuda'],
    ['ハイフン付き電話番号', '090-1234-5678', 'cus_honda'],
    ['ハイフンなし電話番号', '09012345678', 'cus_honda'],
    ['全角数字の電話番号', '０９０１２３４５６７８', 'cus_honda'],
    ['email', 'honda@example.com', 'cus_honda'],
  ])('%sで該当する顧客に到達できる', async (_label, query, customerId) => {
    render(<SearchResult query={query} />)

    await finishDebounce()

    expect(screen.getByTestId('customer-ids').textContent).toContain(customerId)
  })

  it('検索欄が空でも台帳の顧客が並ぶ', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    await finishDebounce()

    // What a reload lands on. An empty box is the ledger, not a blank page.
    expect(screen.getByLabelText('名前・カナ・電話番号・メールアドレス')).toBeTruthy()
    expect(screen.getByText('本田 康彦')).toBeTruthy()
    // The same table the other rosters use — columns and a pager, not a list.
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /カナ/ })).toBeTruthy()
    // Membership is loaded only after selecting a customer. Rendering one
    // badge per row would turn this ledger request into an N+1 waterfall.
    expect(screen.queryByRole('columnheader', { name: /会員種別/ })).toBeNull()
    expect(screen.queryByText('会員種別を確認しています…')).toBeNull()
  })

  it('台帳へ戻った直後はキャッシュ済みの顧客を表示する', async () => {
    const first = render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )
    await finishDebounce()
    expect(screen.getByText('本田 康彦')).toBeTruthy()
    first.unmount()

    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    // Revalidation is still waiting for the debounce, but the previous page
    // is already available and must not collapse back to a loading screen.
    expect(screen.getByText('本田 康彦')).toBeTruthy()
  })

  it('20人を超えるとページャで次のページに進める', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )
    // Enough rows that the ledger needs a second page, registered through the
    // real sheet so they arrive the way the desk's do.
    for (let index = 0; index < 21; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /顧客を新しく登録する/ }))
      fireEvent.change(screen.getByLabelText('名前'), {
        target: { value: `頁送り 太郎${index}` },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '保存' }))
      })
    }
    fireEvent.change(
      screen.getByLabelText('名前・カナ・電話番号・メールアドレス'),
      { target: { value: '' } },
    )
    await finishDebounce()

    expect(screen.getAllByRole('row').length).toBe(PAGE_ROWS + 1)
    // The count is the whole ledger's, not the page's.
    expect(screen.getByText(/全\d+件/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /次へ/ }))
    await finishDebounce()

    expect(screen.getByText('本田 康彦')).toBeTruthy()
  }, 15_000)

  it('登録した顧客はリロード後の一覧にも残る', async () => {
    const { unmount } = render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /顧客を新しく登録する/ }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '桐生 あかね' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    await finishDebounce()
    // A fresh mount with no typed query is what a reload gives the desk.
    unmount()

    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )
    await finishDebounce()

    expect(screen.getByText('桐生 あかね')).toBeTruthy()
  })

  it('登録した顧客がそのまま台帳に出る', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /顧客を新しく登録する/ }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '辻 みどり' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    await finishDebounce()

    // The desk stays on the ledger and sees the row, rather than being sent to
    // the new customer's page and coming back to an empty search box.
    expect(screen.getByText('辻 みどり')).toBeTruthy()
  })

  it('0件では実際に使った検索条件と入力確認を表示する', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )
    fireEvent.change(
      screen.getByLabelText('名前・カナ・電話番号・メールアドレス'),
      { target: { value: '存在しない顧客' } },
    )

    await finishDebounce()

    expect(screen.getByText(/名前・カナとして検索しましたが/)).toBeTruthy()
    expect(screen.getByText(/入力を確認し、正しければ新しく登録できます/)).toBeTruthy()
  })
})
