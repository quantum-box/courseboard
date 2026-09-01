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
    api.json.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `cus_${index}`,
        name: `顧客 ${index}`,
      })),
    })
    await i18next.changeLanguage('ja')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('loads the ledger once without one membership request per row', async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <CustomersPage />
      </I18nextProvider>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(api.json).toHaveBeenCalledTimes(1)
    expect(api.json).toHaveBeenCalledWith('/v1/course/customers?limit=100')

    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(api.json).toHaveBeenCalledTimes(1)
  })
})
