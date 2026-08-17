/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api'
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
 * staff member is deleted the profile can only be reached by id from this
 * screen. The delete flow therefore has to take the caddie off the roster
 * while the staff member still exists.
 */
let staffDeleted = false
let calls: string[] = []
let caddieDeleteFails = false
let caddieAlreadyGone = false

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
    caddieDeleteFails = false
    caddieAlreadyGone = false
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
      if (path.startsWith('/v1/course/caddie-profiles/') && init?.method === 'DELETE') {
        calls.push('caddie:delete')
        if (caddieAlreadyGone) throw new ApiError('golf caddie profile not found', 404)
        if (caddieDeleteFails || staffDeleted) {
          throw new Error('NotFoundError: staff member not found')
        }
        return undefined
      }
      if (path === '/v1/course/caddie-profiles') {
        return {
          items: staffDeleted ? [] : [{
            id: CADDIE_ID,
            displayName: '佐藤 彩',
            skillLevel: 'veteran',
            rank: 'A',
            employmentStatus: 'active',
            staffId: STAFF_ID,
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

  it('deletes the caddie before the staff member, never after', async () => {
    fireEvent.click(await openConfirmation())

    await waitFor(() => expect(calls).toContain('staff:delete'))
    // The order is the whole point: Field refuses every write to a caddie
    // whose staff member is already gone, so the other order would strand the
    // caddie on the assignment board with no way back.
    expect(calls).toEqual(['caddie:delete', 'staff:delete'])
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'success' }),
    )
  })

  it('calls the delete off when the caddie cannot be removed', async () => {
    caddieDeleteFails = true
    fireEvent.click(await openConfirmation())

    await waitFor(() => expect(screen.getByText(
      /キャディ名簿から削除できなかったので、削除を中止しました/,
    )).toBeTruthy())
    // Both records are left as they were, so the operator can retry.
    expect(calls).toEqual(['caddie:delete'])
    expect(staffDeleted).toBe(false)
    expect(toast.show).not.toHaveBeenCalled()
  })

  it('carries on when the caddie was already deleted elsewhere', async () => {
    caddieAlreadyGone = true
    fireEvent.click(await openConfirmation())

    // A 404 means the roster is already where this wanted it, so refusing to
    // delete the staff member would leave the operator stuck for no reason.
    await waitFor(() => expect(calls).toEqual(['caddie:delete', 'staff:delete']))
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'success' }),
    )
  })
})
