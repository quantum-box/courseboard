/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { StaffPage } from './StaffPage'

const api = vi.hoisted(() => ({ course: vi.fn(), field: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.course, fieldApiJson: api.field }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

const STAFF_ID = 'staff_aya'
const CADDIE_ID = 'caddie_aya'

/**
 * Field resolves a caddie profile's staff link on every write, so once the
 * staff member is deleted the profile can no longer be edited — from this
 * screen or from the caddie screen. The delete flow therefore has to suspend
 * the caddie while the staff member still exists.
 */
let staffDeleted = false
let calls: string[] = []
let caddieStandDownFails = false

function staffMember() {
  return {
    id: STAFF_ID,
    name: '佐藤 彩',
    active: true,
    employmentStatus: 'active',
    employmentType: 'part_time',
    hiredAt: null,
    contractEndDate: null,
    phone: null,
    email: null,
    attributesJson: null,
  }
}

function renderDetail() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <StaffPage staffId={STAFF_ID} />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

async function openConfirmation() {
  renderDetail()
  const remove = await screen.findByRole('button', { name: '名簿から削除' })
  fireEvent.click(remove)
  return await screen.findByRole('button', { name: '削除する' })
}

describe('StaffPage delete path', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/')
    clearResourceCache()
    staffDeleted = false
    caddieStandDownFails = false
    calls = []
    toast.show.mockReset()

    api.field.mockReset()
    api.field.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/v1/erp/staff/${STAFF_ID}` && init?.method === 'DELETE') {
        calls.push('staff:delete')
        staffDeleted = true
        return undefined
      }
      if (path === '/v1/erp/staff') return { items: staffDeleted ? [] : [staffMember()] }
      throw new Error(`Unexpected Field call: ${init?.method ?? 'GET'} ${path}`)
    })

    api.course.mockReset()
    api.course.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/course/caddie-profiles/') && init?.method === 'PATCH') {
        calls.push('caddie:patch')
        if (caddieStandDownFails || staffDeleted) {
          throw new Error('NotFoundError: staff member not found')
        }
        return {}
      }
      if (path === '/v1/course/caddie-profiles') {
        return {
          items: [{
            id: CADDIE_ID,
            displayName: '佐藤 彩',
            skillLevel: 'veteran',
            rank: 'A',
            employmentStatus: 'active',
            staffId: staffDeleted ? null : STAFF_ID,
          }],
        }
      }
      if (path.startsWith('/v1/course/caddie-attendance-snapshot')) {
        return { date: '2026-08-16', items: [] }
      }
      throw new Error(`Unexpected course call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(cleanup)

  it('suspends the caddie before deleting, never after', async () => {
    fireEvent.click(await openConfirmation())

    await waitFor(() => expect(calls).toContain('staff:delete'))
    // The order is the whole point: a caddie suspended after the delete would
    // be refused by Field and stranded as "出勤できる" on the assignment board.
    expect(calls).toEqual(['caddie:patch', 'staff:delete'])
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'success' }),
    )
  })

  it('calls the delete off when the caddie cannot be stood down', async () => {
    caddieStandDownFails = true
    fireEvent.click(await openConfirmation())

    await waitFor(() => expect(screen.getByText(
      /キャディ名簿を「止めている」にできなかったので、削除を中止しました/,
    )).toBeTruthy())
    // Both records are left as they were, so the operator can retry.
    expect(calls).toEqual(['caddie:patch'])
    expect(staffDeleted).toBe(false)
    expect(toast.show).not.toHaveBeenCalled()
  })
})
