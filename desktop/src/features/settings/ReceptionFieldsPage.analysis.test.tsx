/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache, peekResourceCache, writeResourceCache } from '../../hooks/useResource'
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
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 800,
      height: 1000,
      close: vi.fn(),
    } as ImageBitmap))
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

  it('saves manual and OCR consent items together with the top save button, retaining failures for retry', async () => {
    let failManual = true
    const created: string[] = []
    let fieldsSaved = false
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields') {
        if (init?.method === 'PUT') fieldsSaved = true
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true') return { items: [] }
      if (path === '/v1/course/customer-reception-fields/analysis') return {
        fields: [], warnings: [],
        consentItems: [{ consentKey: 'golf_privacy', label: '個人情報', body: null, required: true }],
      }
      if (path === '/v1/course/customer-consent-items' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        expect(fieldsSaved).toBe(true)
        if (body.label === '追加の同意' && failManual) throw new Error('temporary failure')
        created.push(body.label)
        return { id: body.consentKey, active: true, ...body }
      }
      throw new Error(`Unexpected API call: ${path}`)
    })
    const { container } = renderPage()
    const add = await screen.findByRole('button', { name: '同意項目を追加' })
    await waitFor(() => expect(add.hasAttribute('disabled')).toBe(false))
    fireEvent.click(add)
    const save = screen.getByRole('button', { name: '項目設定を保存' })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '同意項目の名前' }), { target: { value: '追加の同意' } })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['blank'], 'blank.png', { type: 'image/png' })] },
    })
    await screen.findByText('個人情報')
    fireEvent.click(save)
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ title: '同意項目を作成できませんでした' })))
    expect(screen.getByDisplayValue('追加の同意')).toBeTruthy()
    expect(created).toEqual(['個人情報'])
    expect(api.json.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
    failManual = false
    fireEvent.click(save)
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: '受付票の項目設定を保存しました' })))
    expect(created).toEqual(['個人情報', '追加の同意'])
    await waitFor(() => expect(screen.queryByDisplayValue('追加の同意')).toBeNull())
  })

  it('keeps saved fields as the cancel baseline while retaining a failed OCR consent', async () => {
    let stored = [...DEFAULT_RECEPTION_FIELDS]
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields') {
        if (init?.method === 'PUT') stored = JSON.parse(String(init.body)).items
        return { items: stored }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true') return { items: [] }
      if (path === '/v1/course/customer-reception-fields/analysis') return {
        fields: [], warnings: [],
        consentItems: [{ consentKey: 'golf_privacy', label: '個人情報', body: null, required: true }],
      }
      if (path === '/v1/course/customer-consent-items') throw new Error('temporary failure')
      throw new Error(`Unexpected API call: ${path}`)
    })
    const { container } = renderPage()
    await screen.findByRole('textbox', { name: '電話番号の表示名' })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['blank'], 'blank.png', { type: 'image/png' })] },
    })
    await screen.findByText('個人情報')
    fireEvent.change(screen.getByRole('textbox', { name: '電話番号の表示名' }), { target: { value: '保存された連絡先' } })
    fireEvent.click(screen.getByRole('button', { name: '項目設定を保存' }))
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ title: '同意項目を作成できませんでした' })))
    expect(screen.getByRole('button', { name: '1件をまとめて作成' })).toBeTruthy()
    expect(screen.getByDisplayValue('保存された連絡先')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提案を取り消す' }))
    expect(screen.getByDisplayValue('保存された連絡先')).toBeTruthy()
    expect(screen.getByRole('button', { name: '項目設定を保存' }).hasAttribute('disabled')).toBe(true)
  })

  it('validates the effective consent prompt at 120 Unicode characters before writing fields', async () => {
    renderPage()
    const add = await screen.findByRole('button', { name: '同意項目を追加' })
    await waitFor(() => expect(add.hasAttribute('disabled')).toBe(false))
    fireEvent.click(add)
    const name = screen.getByRole('textbox', { name: '同意項目の名前' })
    const body = screen.getByRole('textbox', { name: '同意の説明文' })
    const save = screen.getByRole('button', { name: '項目設定を保存' })
    fireEvent.change(name, { target: { value: '同意' } })
    fireEvent.change(body, { target: { value: '😀'.repeat(121) } })
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '1件をまとめて作成' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/同意の説明文は120文字以内/)).toBeTruthy()
    fireEvent.click(save)
    expect(api.json.mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'POST')).toBe(false)
    fireEvent.change(body, { target: { value: '😀'.repeat(120) } })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.change(name, { target: { value: 'あ'.repeat(121) } })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.change(body, { target: { value: '   ' } })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(name, { target: { value: 'あ'.repeat(120) } })
    expect(save.hasAttribute('disabled')).toBe(false)
  })

  it('lists consent items already registered in Field without an analysis', async () => {
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return {
          items: [{
            id: 'consent_1',
            consentKey: 'golf_cart_terms_acknowledgement',
            label: 'カート利用約款を遵守します。',
            body: null,
            required: true,
            termsVersion: '1',
            active: true,
            sortOrder: 0,
          }],
        }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    renderPage()

    expect(await screen.findByText('カート利用約款を遵守します。')).toBeTruthy()
    expect(screen.getByText(/golf_cart_terms_acknowledgement .*Field登録済み/)).toBeTruthy()
  })

  describe('registered consent items', () => {
    const cart = {
      id: 'mci_cart',
      consentKey: 'golf_cart_terms_acknowledgement',
      label: 'カート利用約款を遵守します。',
      body: null,
      required: false,
      termsVersion: '1',
      active: true,
      sortOrder: 0,
    }

    function serveCatalog(items: unknown[], onWrite: (path: string, init: RequestInit) => unknown) {
      api.json.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path === '/v1/course/customer-reception-fields' && !init?.method) {
          return { items: DEFAULT_RECEPTION_FIELDS }
        }
        if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
          return { items }
        }
        if (path.startsWith('/v1/course/customer-consent-items/') && init?.method) {
          return onWrite(path, init)
        }
        throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
      })
    }

    afterEach(() => vi.restoreAllMocks())

    it('edits the wording and required flag through CourseBoard', async () => {
      serveCatalog([cart], (_path, init) => ({
        ...cart,
        ...JSON.parse(String(init.body)),
        termsVersion: '2',
      }))
      writeResourceCache('course:customer-consent-items-active', [cart])
      renderPage()

      fireEvent.click(await screen.findByRole('button', { name: '「カート利用約款を遵守します。」を編集' }))
      fireEvent.change(screen.getByDisplayValue('カート利用約款を遵守します。'), {
        target: { value: '乗用カート利用約款を遵守します。' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: '必須' }))
      fireEvent.click(screen.getByRole('button', { name: '保存' }))

      await waitFor(() => expect(api.json).toHaveBeenCalledWith(
        '/v1/course/customer-consent-items/mci_cart',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ label: '乗用カート利用約款を遵守します。', body: null, required: true }),
        }),
      ))
      expect(await screen.findByText('乗用カート利用約款を遵守します。')).toBeTruthy()
      expect(screen.getByText(/必須 \/ 第2版/)).toBeTruthy()
      // Reception's active-only copy must not keep the old wording.
      expect(peekResourceCache('course:customer-consent-items-active')).toBeUndefined()
    })

    it('deletes after confirmation and can bring the item back', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      serveCatalog([cart], (_path, init) => (
        init.method === 'DELETE' ? null : { ...cart, ...JSON.parse(String(init.body)) }
      ))
      renderPage()

      fireEvent.click(await screen.findByRole('button', { name: '「カート利用約款を遵守します。」を削除' }))

      await waitFor(() => expect(api.json).toHaveBeenCalledWith(
        '/v1/course/customer-consent-items/mci_cart',
        expect.objectContaining({ method: 'DELETE' }),
      ))
      await waitFor(() => expect(screen.queryByText('カート利用約款を遵守します。')).toBeNull())
      expect(screen.getByText('Fieldに登録済みの同意項目はまだありません。')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: '削除した項目を表示（1件）' }))
      fireEvent.click(screen.getByRole('button', { name: '「カート利用約款を遵守します。」を受付画面に戻す' }))

      await waitFor(() => expect(api.json).toHaveBeenCalledWith(
        '/v1/course/customer-consent-items/mci_cart',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ active: true }) }),
      ))
      expect(await screen.findByRole('button', { name: '「カート利用約款を遵守します。」を削除' })).toBeTruthy()
    })

    it('keeps the item when the operator cancels the delete', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      serveCatalog([cart], () => {
        throw new Error('no write expected')
      })
      renderPage()

      fireEvent.click(await screen.findByRole('button', { name: '「カート利用約款を遵守します。」を削除' }))

      expect(screen.getByText('カート利用約款を遵守します。')).toBeTruthy()
      expect(api.json).not.toHaveBeenCalledWith(
        '/v1/course/customer-consent-items/mci_cart',
        expect.anything(),
      )
    })
  })

  it('shows OCR progress and lets the operator retry a failed read', async () => {
    let attempts = 0
    let finishRead: (() => void) | null = null
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return { items: [] }
      }
      if (path === '/v1/course/customer-reception-fields/analysis' && init?.method === 'POST') {
        attempts += 1
        if (attempts === 1) {
          await new Promise<void>(resolve => { finishRead = resolve })
          throw new Error('OCR timed out')
        }
        return {
          fields: [],
          consentItems: [{
            consentKey: 'golf_privacy_terms',
            label: '個人情報の取扱い',
            body: null,
            required: true,
          }],
          warnings: [],
        }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText('項目設定を読み込んでいます。')).toBeNull())
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['blank'], 'blank.png', { type: 'image/png' })] },
    })

    expect(await screen.findByText(/用紙をOCRで読み取っています/)).toBeTruthy()
    await waitFor(() => expect(finishRead).not.toBeNull())
    finishRead!()

    fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み取る' }))

    expect(await screen.findByText('個人情報の取扱い')).toBeTruthy()
    expect(attempts).toBe(2)
    expect(screen.queryByRole('button', { name: 'もう一度読み取る' })).toBeNull()
  })

  it('retries the sheet that failed rather than the previously read one', async () => {
    const sent: string[] = []
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return { items: [] }
      }
      if (path === '/v1/course/customer-reception-fields/analysis' && init?.method === 'POST') {
        const sheet = await ((init.body as FormData).get('file') as File).text()
        sent.push(sheet)
        if (sheet === 'sheet-b' && sent.filter(item => item === 'sheet-b').length === 1) {
          throw new Error('OCR timed out')
        }
        return { fields: [], consentItems: [], warnings: [] }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText('項目設定を読み込んでいます。')).toBeNull())
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['sheet-a'], 'a.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(sent).toEqual(['sheet-a']))
    await waitFor(() => expect(screen.queryByText(/用紙をOCRで読み取っています/)).toBeNull())

    fireEvent.change(fileInput, {
      target: { files: [new File(['sheet-b'], 'b.png', { type: 'image/png' })] },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み取る' }))

    await waitFor(() => expect(sent).toEqual(['sheet-a', 'sheet-b', 'sheet-b']))
  })

  it('offers no retry of the previous sheet when a new file fails before OCR', async () => {
    const sent: string[] = []
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return { items: [] }
      }
      if (path === '/v1/course/customer-reception-fields/analysis' && init?.method === 'POST') {
        sent.push(await ((init.body as FormData).get('file') as File).text())
        if (sent.length === 1) throw new Error('OCR timed out')
        return { fields: [], consentItems: [], warnings: [] }
      }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText('項目設定を読み込んでいます。')).toBeNull())
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['sheet-a'], 'a.png', { type: 'image/png' })] },
    })
    expect(await screen.findByRole('button', { name: 'もう一度読み取る' })).toBeTruthy()

    fireEvent.change(fileInput, {
      target: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] },
    })

    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('空の用紙を読み取れませんでした')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'もう一度読み取る' })).toBeNull()
    expect(sent).toEqual(['sheet-a'])
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
    await waitFor(() => {
      const candidate = screen.getByText('個人情報の取扱い').closest('li')
      expect(candidate?.textContent).toContain('Field登録済み')
    })
  })

  it('does not call detected consent items unregistered while the Field catalog is unavailable', async () => {
    let failCatalogRequest: (() => void) | undefined
    const catalogRequest = new Promise<never>((_resolve, reject) => {
      failCatalogRequest = () => reject(new Error('Field catalog unavailable'))
    })
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/v1/course/customer-reception-fields' && !init?.method) {
        return { items: DEFAULT_RECEPTION_FIELDS }
      }
      if (path === '/v1/course/customer-consent-items?includeInactive=true' && !init?.method) {
        return catalogRequest
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
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })

    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText('項目設定を読み込んでいます。')).toBeNull())
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['blank'], 'blank.png', { type: 'image/png' })] },
    })

    const consentLabel = await screen.findByText('個人情報の取扱い')
    const candidate = consentLabel.closest('li')
    expect(candidate?.textContent).toContain('登録状況未確認')
    expect(screen.getByRole('button', { name: '1件をまとめて作成' }).hasAttribute('disabled')).toBe(true)

    failCatalogRequest?.()
    await waitFor(() => expect(screen.queryByText('同意項目を読み込んでいます。')).toBeNull())
    expect(screen.getByText('個人情報の取扱い').closest('li')?.textContent)
      .toContain('登録状況未確認')
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
    vi.unstubAllGlobals()
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
