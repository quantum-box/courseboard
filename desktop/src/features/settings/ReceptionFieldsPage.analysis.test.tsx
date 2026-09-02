/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { DEFAULT_RECEPTION_FIELDS } from '../golf/customers/reception/models'
import { ReceptionFieldsPage } from './ReceptionFieldsPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <ReceptionFieldsPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('ReceptionFieldsPage analysis proposal', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/settings/reception-fields')
    clearResourceCache()
    api.json.mockReset()
    toast.show.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return { items: [] }
      }
      if (path === '/v1/course/customer-reception-fields/analysis' && init?.method === 'POST') {
        return {
          fields: [{
            fieldKey: 'phone',
            kind: 'standard',
            fieldType: 'tel',
            enabled: true,
            required: true,
            label: '分析した連絡先',
            customLabel: true,
            sortOrder: 2,
            options: [],
          }],
          warnings: [],
        }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  it('creates reviewed consent candidates in Field through CourseBoard', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return { items: [] }
      }
      if (path === '/v1/course/customer-reception-fields/analysis' && init?.method === 'POST') {
        return {
          fields: [],
          consentItems: [{
            consentKey: 'golf_privacy_terms',
            label: '個人情報の取扱い',
            body: '個人情報の取扱いに同意します',
            required: true,
          }],
          warnings: [],
        }
      }
      if (path === '/v1/course/customer-consent-items' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return { id: 'mci-created', active: true, ...body }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText('項目設定を読み込んでいます。')).toBeNull())
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['blank'], 'blank.png', { type: 'image/png' })] },
    })

    expect(await screen.findByText('個人情報の取扱い')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1件をまとめて作成' }))

    await waitFor(() => expect(api.json).toHaveBeenCalledWith(
      '/v1/course/customer-consent-items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          body: '個人情報の取扱いに同意します',
          consentKey: 'golf_privacy_terms',
          label: '個人情報の取扱い',
          required: true,
          sortOrder: 0,
          termsVersion: '1',
        }),
      }),
    ))
    await waitFor(() => expect(screen.queryByText('個人情報の取扱い')).toBeNull())
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('restores manual unsaved edits when the operator cancels an analysis proposal', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText('項目設定を読み込んでいます。')).toBeNull())
    const phoneLabel = await screen.findByRole('textbox', { name: '電話番号の表示名' })
    fireEvent.change(phoneLabel, { target: { value: '手入力した連絡先' } })
    await waitFor(() => expect(screen.getByDisplayValue('手入力した連絡先')).toBeTruthy())

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['blank'], 'blank.png', { type: 'image/png' })] },
    })

    await screen.findByDisplayValue('分析した連絡先')
    fireEvent.click(screen.getByRole('button', { name: '提案を取り消す' }))

    await waitFor(() => expect(screen.getByDisplayValue('手入力した連絡先')).toBeTruthy())
    expect(screen.queryByDisplayValue('分析した連絡先')).toBeNull()
  })

  it('keeps focus while editing a custom field key', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return {
          items: [
            ...DEFAULT_RECEPTION_FIELDS,
            {
              fieldKey: 'custom_field_1',
              kind: 'custom',
              fieldType: 'text',
              enabled: true,
              required: false,
              label: '追加項目',
              customLabel: true,
              sortOrder: DEFAULT_RECEPTION_FIELDS.length,
              options: [],
            },
          ],
        }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderPage()
    const keyInput = await screen.findByDisplayValue('custom_field_1')
    keyInput.focus()

    fireEvent.change(keyInput, { target: { value: 'member_code' } })

    expect(document.activeElement).toBe(keyInput)
    expect((keyInput as HTMLInputElement).value).toBe('member_code')
  })

  it('updates only the edited row when custom field keys temporarily match', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return {
          items: [
            ...DEFAULT_RECEPTION_FIELDS,
            ...['member', 'member_code'].map((fieldKey, index) => ({
              fieldKey,
              kind: 'custom',
              fieldType: 'text',
              enabled: true,
              required: false,
              label: fieldKey,
              customLabel: true,
              sortOrder: DEFAULT_RECEPTION_FIELDS.length + index,
              options: [],
            })),
          ],
        }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderPage()
    const keyInputs = await screen.findAllByRole('textbox', { name: '項目キー' })

    fireEvent.change(keyInputs[0], { target: { value: 'member_code' } })
    fireEvent.change(keyInputs[0], { target: { value: 'member_code2' } })

    expect(keyInputs.map(input => (input as HTMLInputElement).value)).toEqual([
      'member_code2',
      'member_code',
    ])
  })

  it('keeps a reordered row associated with its own move control', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return {
          items: [
            ...DEFAULT_RECEPTION_FIELDS,
            ...['first_field', 'second_field', 'third_field'].map((fieldKey, index) => ({
              fieldKey,
              kind: 'custom',
              fieldType: 'text',
              enabled: true,
              required: false,
              label: fieldKey,
              customLabel: true,
              sortOrder: DEFAULT_RECEPTION_FIELDS.length + index,
              options: [],
            })),
          ],
        }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderPage()
    expect(await screen.findAllByRole('textbox', { name: '項目キー' })).toHaveLength(3)
    const firstMoveDown = screen.getAllByRole('button', { name: '下へ移動' })[0]
    firstMoveDown.focus()

    fireEvent.click(firstMoveDown)
    expect(document.activeElement).toBe(firstMoveDown)
    fireEvent.click(firstMoveDown)

    expect(screen.getAllByRole('textbox', { name: '項目キー' }).map(input => (
      (input as HTMLInputElement).value
    ))).toEqual(['second_field', 'third_field', 'first_field'])
  })
})
