/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../i18n'
import { clearResourceCache } from '../hooks/useResource'
import { DEFAULT_TIME_ZONE } from '../lib/clock'
import {
  TenantTimezoneProvider,
  notifyTenantTimezoneChanged,
  useTenantTimezone,
} from './TenantTimezoneProvider'

const api = vi.hoisted(() => ({ json: vi.fn() }))

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, courseboardApiJson: api.json }
})

function Child() {
  return <p data-testid="zone">{useTenantTimezone()}</p>
}

function renderProvider() {
  return render(
    <I18nextProvider i18n={i18next}>
      <TenantTimezoneProvider>
        <Child />
      </TenantTimezoneProvider>
    </I18nextProvider>,
  )
}

const zone = () => screen.getByTestId('zone').textContent
const warning = () => screen.queryByRole('status')

/**
 * This provider wraps every route, so these tests are really about one
 * question: can the desk still open a screen when the tenant settings call
 * does not answer? It used to be no — the provider threw, and React unmounted
 * the whole tree.
 */
describe('TenantTimezoneProvider', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    api.json.mockReset()
  })

  afterEach(cleanup)

  it('uses the configured zone once it arrives', async () => {
    api.json.mockResolvedValue({ configJson: { timezone: 'Asia/Taipei' } })
    renderProvider()
    await waitFor(() => expect(zone()).toBe('Asia/Taipei'))
    expect(warning()).toBeNull()
  })

  it('renders the page while the settings call is still in flight', () => {
    api.json.mockReturnValue(new Promise(() => {}))
    renderProvider()
    // Not a loading placeholder: the children are on screen from the first
    // paint, carrying the default zone until the real one lands.
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
  })

  it('keeps the page usable and says so when the settings call fails', async () => {
    api.json.mockRejectedValue(new Error('extension status unavailable'))
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
    // The banner names the zone actually in use, so the reader knows which
    // offset the dates on screen were rendered with.
    expect(warning()!.textContent).toContain(DEFAULT_TIME_ZONE)
  })

  it('falls back and warns when the stored zone is not a real one', async () => {
    // A configuration mistake, not a transient failure — substituting silently
    // would leave every date on screen quietly wrong.
    api.json.mockResolvedValue({ configJson: { timezone: 'JST' } })
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
  })

  it('treats an absent zone as the default without warning', async () => {
    api.json.mockResolvedValue({ configJson: {} })
    renderProvider()
    await waitFor(() => expect(api.json).toHaveBeenCalled())
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
    expect(warning()).toBeNull()
  })

  it('clears the warning when the settings screen saves a zone', async () => {
    api.json.mockRejectedValue(new Error('extension status unavailable'))
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())

    // A save is authoritative even though the last read failed.
    notifyTenantTimezoneChanged('Asia/Taipei')
    await waitFor(() => expect(zone()).toBe('Asia/Taipei'))
    expect(warning()).toBeNull()
  })
})
