/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache, peekResourceCache, writeResourceCache } from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { MembershipBadge } from './MembershipBadge'
import {
  memberNumberPath,
  membershipPath,
  membershipPlansPath,
  type CustomerMembership,
  type MembershipPlan,
} from './membership'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: toast.show }))

const CUSTOMER_ID = 'customer-1'
const SECOND_CUSTOMER_ID = 'customer-2'
const PLAN: MembershipPlan = {
  id: 'plan-1',
  name: '正会員',
  description: null,
  feeJpy: 120000,
  validDays: null,
  active: true,
  sortOrder: 1,
}
const VISITOR: CustomerMembership = {
  customerId: CUSTOMER_ID,
  isMember: false,
  plan: null,
  memberNumber: null,
}
const MEMBER: CustomerMembership = {
  customerId: CUSTOMER_ID,
  isMember: true,
  plan: PLAN,
  memberNumber: null,
}

type ApiCall = { path: string; init?: RequestInit }
const calls: ApiCall[] = []

function renderBadge(editable = false, customerId = CUSTOMER_ID) {
  return render(
    <I18nextProvider i18n={i18next}>
      <MembershipBadge customerId={customerId} editable={editable} />
    </I18nextProvider>,
  )
}

describe('MembershipBadge resource lifecycle', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    calls.length = 0
    api.json.mockReset()
    toast.show.mockReset()
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('renders the cached membership during revalidation and keeps it after failure', async () => {
    let membershipReads = 0
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === membershipPath(CUSTOMER_ID) && !init?.method) {
        membershipReads += 1
        if (membershipReads === 1) return MEMBER
        throw new Error('membership temporarily unavailable')
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const firstRender = renderBadge()
    expect(await screen.findByText('正会員')).toBeTruthy()
    firstRender.unmount()

    renderBadge()

    // A cache hit is visible on the first paint; revalidation must not replace
    // the last known membership with a loading or unknown placeholder.
    expect(screen.getByText('正会員')).toBeTruthy()
    expect(screen.queryByText('会員種別を確認しています…')).toBeNull()
    await waitFor(() => expect(membershipReads).toBe(2))
    expect(screen.getByText('正会員')).toBeTruthy()
    expect(screen.queryByText('会員種別を確認できませんでした')).toBeNull()
  })

  it('shares active plans through the existing cache key', async () => {
    writeResourceCache('membership:plans:active', { items: [PLAN] })
    let releasePlans: ((value: { items: MembershipPlan[] }) => void) | undefined
    const refreshedPlans = new Promise<{ items: MembershipPlan[] }>(resolve => {
      releasePlans = resolve
    })
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === membershipPath(CUSTOMER_ID) && !init?.method) return VISITOR
      if (path === membershipPlansPath) {
        // Keep the stale-while-revalidate request open. The cached option must
        // still be usable while the active plan list is refreshed.
        return refreshedPlans
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderBadge(true)
    await screen.findByText('ビジター')
    fireEvent.click(screen.getByRole('button', { name: '会員にする' }))

    expect(await screen.findByRole('option', { name: '正会員' })).toBeTruthy()
    expect(calls.filter(call => call.path === membershipPlansPath)).toHaveLength(1)
    releasePlans?.({ items: [PLAN] })
    await waitFor(() => expect(peekResourceCache('membership:plans:active')).toEqual({ items: [PLAN] }))
  })

  it('leaves an empty plan select when the active plan read fails', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === membershipPath(CUSTOMER_ID) && !init?.method) return VISITOR
      if (path === membershipPlansPath) throw new Error('plans temporarily unavailable')
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderBadge(true)
    await screen.findByText('ビジター')
    fireEvent.click(screen.getByRole('button', { name: '会員にする' }))
    await waitFor(() => expect(calls.filter(call => call.path === membershipPlansPath)).toHaveLength(1))
    await waitFor(() => {
      expect(screen.getByRole('combobox').querySelectorAll('option')).toHaveLength(1)
    })
    expect(screen.getByRole('option', { name: '会員種別を選ぶ' })).toBeTruthy()
    expect(screen.queryByText('会員種別を確認できませんでした')).toBeNull()
  })

  it('resets grant and member-number controls when the customer changes', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path.endsWith('/membership') && !init?.method) {
        return { ...MEMBER, customerId: path.includes(SECOND_CUSTOMER_ID) ? SECOND_CUSTOMER_ID : CUSTOMER_ID }
      }
      if (path === membershipPlansPath) return { items: [PLAN] }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const view = renderBadge(true)
    await screen.findByText('正会員')
    fireEvent.click(screen.getByRole('button', { name: '会員種別を変える' }))
    fireEvent.click(screen.getByRole('button', { name: '会員番号を登録' }))
    expect(screen.getByPlaceholderText('例: A-1024')).toBeTruthy()

    view.rerender(
      <I18nextProvider i18n={i18next}>
        <MembershipBadge customerId={SECOND_CUSTOMER_ID} editable />
      </I18nextProvider>,
    )

    await waitFor(() => expect(screen.getByText('正会員')).toBeTruthy())
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByPlaceholderText('例: A-1024')).toBeNull()
  })

  it('updates the membership cache after granting a plan', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === membershipPath(CUSTOMER_ID) && !init?.method) return VISITOR
      if (path === membershipPlansPath) return { items: [PLAN] }
      if (path === membershipPath(CUSTOMER_ID) && init?.method === 'POST') return MEMBER
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderBadge(true)
    await screen.findByText('ビジター')
    fireEvent.click(screen.getByRole('button', { name: '会員にする' }))
    await waitFor(() => expect(calls.filter(call => call.path === membershipPlansPath)).toHaveLength(1))
    await screen.findByRole('option', { name: '正会員' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: PLAN.id } })

    await waitFor(() => expect(screen.getByText('正会員')).toBeTruthy())
    expect(peekResourceCache(`customer:membership:${CUSTOMER_ID}`)).toEqual(MEMBER)
    expect(calls).toContainEqual(expect.objectContaining({
      path: membershipPath(CUSTOMER_ID),
      init: expect.objectContaining({ method: 'POST' }),
    }))
  })

  it('updates the membership cache after saving a member number', async () => {
    const numberedMember: CustomerMembership = { ...MEMBER, memberNumber: 'M-42' }
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === membershipPath(CUSTOMER_ID) && !init?.method) return MEMBER
      if (path === memberNumberPath(CUSTOMER_ID) && init?.method === 'PUT') {
        return numberedMember
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderBadge(true)
    await screen.findByText('正会員')
    fireEvent.click(screen.getByRole('button', { name: '会員番号を登録' }))
    fireEvent.change(screen.getByPlaceholderText('例: A-1024'), { target: { value: 'M-42' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await screen.findByText('会員番号 M-42')
    expect(peekResourceCache(`customer:membership:${CUSTOMER_ID}`)).toEqual(numberedMember)
    expect(calls).toContainEqual(expect.objectContaining({
      path: memberNumberPath(CUSTOMER_ID),
      init: expect.objectContaining({ method: 'PUT' }),
    }))
  })
})
