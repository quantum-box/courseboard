/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CancellationFeeCollection } from './api'
import { i18next } from './i18n'
import { PaymentPage } from './PaymentPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('./api', async importOriginal => ({
  ...(await importOriginal<typeof import('./api')>()),
  apiJson: api.json,
}))

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn(async () => null) }))

function collection(overrides: Partial<CancellationFeeCollection> = {}): CancellationFeeCollection {
  return {
    id: 'cfc_test',
    tenant_id: 'tn_test',
    customer_name: '山田 太郎',
    amount: 5000,
    currency: 'JPY',
    due_date: '2026-12-01',
    payment_url: 'https://courseboard.example/pay/token',
    // No Field invoice: the page stops before it asks Stripe for a form.
    field_invoice_id: null,
    status: 'pending',
    sms_status: 'sent',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PaymentPage token="token" />
    </I18nextProvider>,
  )
}

afterEach(() => {
  cleanup()
  api.json.mockReset()
})

describe('PaymentPage', () => {
  it('shows who issued the bill above the payer name', async () => {
    api.json.mockResolvedValue(collection({ issuer_name: '札幌カントリー倶楽部' }))

    renderPage()

    const issuer = await screen.findByText('札幌カントリー倶楽部')
    expect(issuer.previousElementSibling?.textContent).toBe(i18next.t('payment:field.issuer'))
    const payer = screen.getByText('山田 太郎')
    expect(
      issuer.compareDocumentPosition(payer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('leaves the issuer row out when the bill carries no issuer', async () => {
    api.json.mockResolvedValue(collection())

    renderPage()

    await screen.findByText('山田 太郎')
    expect(screen.queryByText(i18next.t('payment:field.issuer'))).toBeNull()
  })
})
