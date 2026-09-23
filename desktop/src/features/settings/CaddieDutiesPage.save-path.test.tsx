/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearResourceCache } from '../../hooks/useResource'
import { i18next } from '../../i18n'
import { PageReloadProvider } from '../../lib/pageReload'
import { CaddieDutiesPage } from './CaddieDutiesPage'

const api = vi.hoisted(() => ({ json: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

vi.mock('../../lib/toast', () => ({ showToast: toast.show }))

const dutiesPath = '/v1/course/caddie-duties'
let stored: string[] = []
let writes: string[][] = []

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <PageReloadProvider>
        <CaddieDutiesPage />
      </PageReloadProvider>
    </I18nextProvider>,
  )
}

describe('CaddieDutiesPage save paths', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    window.history.replaceState({}, '', '/settings/caddie-duties')
    clearResourceCache()
    stored = ['コース整備', '練習場', 'フロント補助']
    writes = []
    api.json.mockReset()
    toast.show.mockReset()
    api.json.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === dutiesPath && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { items: string[] }
        writes.push(body.items)
        stored = body.items
        return { items: stored }
      }
      if (path === dutiesPath && !init?.method) return { items: [...stored] }
      throw new Error(`Unexpected API call: ${init?.method ?? 'GET'} ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearResourceCache()
  })

  it('lists the pick list in the order the dispatch sheet offers it', async () => {
    renderPage()

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['順', '業務種別', ''])
    expect(within(table).getAllByRole('row').slice(1).map(row => row.textContent))
      .toEqual(expect.arrayContaining([expect.stringContaining('コース整備')]))
  })

  // The reorder controls sit inside a row that opens the editor when clicked;
  // moving a job must not also put its sheet on screen.
  it('moves a job without opening the editor', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getAllByRole('button', { name: '下へ動かす' })[0])

    await waitFor(() => expect(writes).toEqual([['練習場', 'コース整備', 'フロント補助']]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renames a job through the sheet and writes the whole list back', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByText('練習場'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /業務種別/ }), {
      target: { value: 'ドライビングレンジ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(writes).toEqual([['コース整備', 'ドライビングレンジ', 'フロント補助']]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('refuses a name the list already holds', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: '業務種別を追加' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /業務種別/ }), {
      target: { value: 'コース整備' },
    })

    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled)
      .toBe(true)
    expect(within(dialog).getByText(/同じ業務種別が2つあります/)).toBeTruthy()
    expect(writes).toEqual([])
  })
})
