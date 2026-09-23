/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import type { MembershipPlan } from '../golf/customers/membership'
import { MembershipDiscountsPage } from './MembershipDiscountsPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

type Discount = { planId: string; kind: 'yen' | 'percent'; value: number }

const plansPath = '/v1/course/membership-plans'
const discountsPath = '/v1/course/membership-discounts'

function plan(id: string, name: string, sortOrder: number): MembershipPlan {
  return { id, name, active: true, sortOrder }
}

let plans: MembershipPlan[] = []
let stored: Discount[] = []
let writes: Discount[][] = []

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <MembershipDiscountsPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('MembershipDiscountsPage save paths', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/settings/membership-discounts')
    clearResourceCache()
    plans = [plan('plan-full', '正会員', 0), plan('plan-weekday', '平日会員', 1)]
    stored = [{ planId: 'plan-full', kind: 'yen', value: 5000 }]
    writes = []
    api.json.mockReset()
    toast.show.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === discountsPath && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { items: Discount[] }
        writes.push(body.items)
        stored = body.items
        return { items: stored }
      }
      if (path === discountsPath && !init?.method) return { items: stored.map(item => ({ ...item })) }
      if (path === plansPath && !init?.method) return { items: plans.map(item => ({ ...item })) }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  // Every plan on sale gets a row, discounted or not: a table that only listed
  // the discounted ones would hide the plan an operator came to add one to.
  it('lists every plan on sale, and says which ones discount nothing', async () => {
    renderPage()

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('5,000 円引き'),
      expect.stringContaining('割引なし'),
    ])
  })

  // The API takes the whole list, so editing one plan must carry the others
  // through untouched rather than writing the edited row on its own.
  it('keeps the other plans’ discounts when one is edited', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByText('平日会員'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /引き方/ }), {
      target: { value: 'percent' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /割引額/ }), {
      target: { value: '20' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(writes).toEqual([[
        { planId: 'plan-full', kind: 'yen', value: 5000 },
        { planId: 'plan-weekday', kind: 'percent', value: 20 },
      ]]),
    )
  })

  // Zero means "no discount", which is an absent row rather than a stored zero.
  it('drops a discount taken back to zero', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByText('正会員'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /割引額/ }), {
      target: { value: '0' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(writes).toEqual([[]]))
  })
})
