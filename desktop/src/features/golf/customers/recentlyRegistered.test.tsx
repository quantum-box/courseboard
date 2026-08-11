/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { CustomersPage } from './CustomersPage'
import { forgetRegisteredCustomers, rememberRegisteredCustomer } from './recentlyRegistered'

function registerCustomer(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '顧客を新しく登録する' }))
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

describe('登録したばかりの顧客', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    await i18next.changeLanguage('ja')
    forgetRegisteredCustomers()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    forgetRegisteredCustomers()
  })

  it('新しい順に並び、同じ人を二重に持たない', () => {
    const customer = { id: 'cus_1', name: '本田 康彦' }
    rememberRegisteredCustomer(customer)
    rememberRegisteredCustomer({ id: 'cus_2', name: '増田 公陽' })
    rememberRegisteredCustomer(customer)

    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    const names = screen.getAllByRole('link').map(link => link.textContent)
    expect(names).toHaveLength(2)
    expect(names[0]).toContain('本田 康彦')
    expect(names[1]).toContain('増田 公陽')
  })

  it('登録した顧客は検索しなくても台帳画面に残る', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    registerCustomer('新井 一郎')

    // 検索欄は空のまま。以前はここで詳細ページへ飛ばしていたため、
    // 受付には登録した人の手がかりが何も残らなかった。
    expect((screen.getByLabelText('名前・カナ・電話番号・メールアドレス') as HTMLInputElement).value)
      .toBe('')
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /新井 一郎/ })).toBeTruthy()
    })
    expect(screen.getByText('いま登録した顧客')).toBeTruthy()
  })

  it('検索中は検索結果だけを出す', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    registerCustomer('新井 一郎')
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /新井 一郎/ })).toBeTruthy()
    })

    fireEvent.change(
      screen.getByLabelText('名前・カナ・電話番号・メールアドレス'),
      { target: { value: '本田' } },
    )

    await waitFor(() => {
      expect(screen.queryByText('いま登録した顧客')).toBeNull()
    })
    expect(screen.queryByRole('link', { name: /新井 一郎/ })).toBeNull()
  })
})
