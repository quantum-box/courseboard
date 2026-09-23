/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { courseboardApiJson } from '../../../api'
import {
  clearResourceCache,
  peekResourceCache,
  writeResourceCache,
} from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { CustomerDetailPage } from './CustomerDetailPage'
import { customerPath, customersPath, type Customer } from './models'

describe('customer ledger deletion', () => {
  beforeEach(async () => {
    clearResourceCache()
    vi.stubEnv('VITE_COURSEBOARD_AUTH_MODE', 'development')
    vi.stubEnv('VITE_COURSEBOARD_MOCK_DATA', 'true')
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    clearResourceCache()
    cleanup()
    vi.unstubAllEnvs()
  })

  it('names the customer, confirms the impact, and removes them from the ledger', async () => {
    const customer = await courseboardApiJson<Customer>(customersPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '削除確認 テスト' }),
    })
    window.history.replaceState({}, '', `/courseboard_id/golf/customers/${customer.id}`)

    render(
      <I18nextProvider i18n={i18next}>
        <CustomerDetailPage customerId={customer.id} />
      </I18nextProvider>,
    )

    await screen.findByText('削除確認 テスト')
    expect(peekResourceCache(`customer:${customer.id}`)).toMatchObject({ name: '削除確認 テスト' })
    writeResourceCache(`customer:membership:${customer.id}`, { isMember: true })
    writeResourceCache(`customer:visits:${customer.id}`, { items: [] })
    writeResourceCache(`customer:registration:${customer.id}`, { source: 'manual' })
    writeResourceCache('customers:search:/v1/course/customers?limit=100', { items: [customer] })
    fireEvent.click(screen.getByRole('button', { name: '顧客台帳から削除する' }))

    expect(screen.getByText('「削除確認 テスト」を顧客台帳から削除しますか？')).toBeTruthy()
    expect(screen.getByText(/予約と来場履歴は消えません/)).toBeTruthy()

    const deleteButtons = screen.getAllByRole('button', { name: '顧客台帳から削除する' })
    await act(async () => {
      fireEvent.click(deleteButtons[deleteButtons.length - 1]!)
    })

    await waitFor(() => {
      expect(window.location.pathname).toBe('/courseboard_id/golf/customers')
    })
    expect(peekResourceCache(`customer:${customer.id}`)).toBeUndefined()
    expect(peekResourceCache(`customer:membership:${customer.id}`)).toBeUndefined()
    expect(peekResourceCache(`customer:visits:${customer.id}`)).toBeUndefined()
    expect(peekResourceCache(`customer:registration:${customer.id}`)).toBeUndefined()
    expect(peekResourceCache('customers:search:/v1/course/customers?limit=100')).toBeUndefined()
    await expect(courseboardApiJson<Customer>(customerPath(customer.id))).rejects.toMatchObject({
      status: 404,
    })
  })
})
