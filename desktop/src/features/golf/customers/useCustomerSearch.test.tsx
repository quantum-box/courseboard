/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
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

  it('検索対象にemailを明示し、空欄には入力案内を表示する', () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    expect(screen.getByLabelText('名前・カナ・電話番号・メールアドレス')).toBeTruthy()
    expect(screen.getByText(/1文字の名前から検索できます/)).toBeTruthy()
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
