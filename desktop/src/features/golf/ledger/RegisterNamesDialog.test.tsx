/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18next } from '../../../i18n'
import { RegisterNamesDialog } from './RegisterNamesDialog'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../../lib/toast', () => ({ showToast: vi.fn() }))

afterEach(() => {
  cleanup()
  api.json.mockReset()
})

describe('registering names after a booking', () => {
  it('keeps the compe name and remarks when it writes the linked roster back', async () => {
    api.json.mockImplementation(async (path: string) =>
      path.endsWith('/party') ? { players: [] } : { id: 'cus-new' })
    const onDone = vi.fn()
    render(
      <I18nextProvider i18n={i18next}>
        <RegisterNamesDialog
          reservationId="rsv-1"
          names={[{ name: '増田 公陽', role: 'player', playerIndex: 0 }]}
          players={[{ name: '増田 公陽', tag: '共通', memberNumber: '', customerId: null }]}
          party={{ competitionName: '本田会', groupNumber: 2, remarks: { settlement: 'individual' } }}
          onDone={onDone}
        />
      </I18nextProvider>,
    )

    fireEvent.click(screen.getByText(i18next.t('ledger:register.confirm')))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const write = api.json.mock.calls.find(call => (call[0] as string).endsWith('/party'))!
    expect(JSON.parse(write[1].body)).toMatchObject({
      competitionName: '本田会',
      groupNumber: 2,
      remarks: { settlement: 'individual' },
      players: [{ name: '増田 公陽', customerId: 'cus-new' }],
    })
  })
})
