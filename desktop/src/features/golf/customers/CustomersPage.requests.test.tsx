/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearResourceCache } from '../../../hooks/useResource'
import { i18next } from '../../../i18n'
import { CustomersPage } from './CustomersPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

describe('customer ledger requests', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    api.json.mockReset()
    const ledger = Array.from({ length: 100 }, (_, index) => ({
      id: `cus_${index}`,
      name: `顧客 ${index}`,
    }))
    api.json.mockImplementation(async (path: string) => {
      const params = new URL(path, 'http://localhost').searchParams
      const limit = Number(params.get('limit'))
      const offset = Number(params.get('offset') ?? 0)
      return { items: ledger.slice(offset, offset + limit), total: ledger.length }
    })
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('loads one page of the ledger at a time without one membership request per row', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(api.json).toHaveBeenCalledTimes(1)
    expect(api.json).toHaveBeenCalledWith('/v1/course/customers?limit=20')
    expect(screen.getByText('1〜20件目 / 全100件')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /次へ/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    // The next page is asked of the server, not sliced from a held hundred.
    expect(api.json).toHaveBeenCalledTimes(2)
    expect(api.json).toHaveBeenLastCalledWith('/v1/course/customers?limit=20&offset=20')
    expect(screen.getByText('顧客 20')).toBeTruthy()
  })
})
