/* @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../i18n'
import { clearResourceCache } from '../hooks/useResource'
import { DEFAULT_TIME_ZONE } from '../lib/clock'
import { ApiError } from '../api'
import {
  TenantTimezoneProvider,
  notifyTenantTimezoneChanged,
  useTenantTimezone,
} from './TenantTimezoneProvider'

const api = vi.hoisted(() => ({ context: vi.fn() }))

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, courseboardApiJson: api.context }
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

describe('TenantTimezoneProvider', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('ja')
    clearResourceCache()
    api.context.mockReset()
  })

  afterEach(cleanup)

  it('uses the configured zone once it arrives', async () => {
    api.context.mockResolvedValue({ timezone: 'Asia/Taipei' })
    renderProvider()
    await waitFor(() => expect(zone()).toBe('Asia/Taipei'))
    expect(api.context).toHaveBeenCalledWith('/v1/course/tenant-timezone')
    expect(warning()).toBeNull()
  })

  it('renders the page while the settings call is still in flight', () => {
    api.context.mockReturnValue(new Promise(() => {}))
    renderProvider()
    // Not a loading placeholder: the children are on screen from the first
    // paint, carrying the default zone until the real one lands.
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
  })

  it.each(['settings unavailable', '403 Forbidden: ListExtensionStatus denied'])(
    'warns rather than silently using Tokyo when settings cannot be read: %s', async message => {
      api.context.mockRejectedValue(new Error(message))
      await act(async () => { renderProvider() })
      expect(api.context).toHaveBeenCalled()
      expect(zone()).toBe(DEFAULT_TIME_ZONE)
      expect(warning()).not.toBeNull()
    },
  )

  it('falls back and warns when the stored zone is not a real one', async () => {
    // A configuration mistake, not a transient failure — substituting silently
    // would leave every date on screen quietly wrong.
    api.context.mockResolvedValue({ timezone: 'JST' })
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
  })

  it.each([424, 502, 503, 504])('recovers from an upstream %s with one retry', async status => {
    api.context.mockRejectedValueOnce(new ApiError('upstream unavailable', status))
      .mockResolvedValueOnce({ timezone: 'Asia/Taipei' })
    renderProvider()
    await waitFor(() => expect(zone()).toBe('Asia/Taipei'))
    expect(api.context).toHaveBeenCalledTimes(2)
    expect(warning()).toBeNull()
  })

  it('stops after one failed upstream retry and warns', async () => {
    api.context.mockRejectedValue(new ApiError('upstream unavailable', 424))
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())
    expect(api.context).toHaveBeenCalledTimes(2)
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
  })

  it('does not retry a settings permission denial', async () => {
    api.context.mockRejectedValue(new ApiError('ListExtensionStatus denied', 403))
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())
    expect(api.context).toHaveBeenCalledTimes(1)
    expect(zone()).toBe(DEFAULT_TIME_ZONE)
  })

  it.each([null, {}, { configJson: null }, { configJson: {} }, { timezone: ' ' }])(
    'treats absent settings %j as Tokyo without warning', async settings => {
      api.context.mockResolvedValue(settings)
      await act(async () => { renderProvider() })
      expect(api.context).toHaveBeenCalled()
      expect(zone()).toBe(DEFAULT_TIME_ZONE)
      expect(warning()).toBeNull()
    },
  )

  it('keeps a cached configured zone when revalidation fails', async () => {
    api.context.mockResolvedValue({ timezone: 'America/New_York' })
    const view = renderProvider()
    await waitFor(() => expect(zone()).toBe('America/New_York'))
    view.unmount()

    api.context.mockRejectedValue(new Error('settings unavailable'))
    await act(async () => { renderProvider() })
    expect(api.context).toHaveBeenCalledTimes(2)
    expect(zone()).toBe('America/New_York')
    expect(warning()).toBeNull()
  })

  it('clears the warning when the settings screen saves a zone', async () => {
    api.context.mockResolvedValue({ timezone: 'JST' })
    renderProvider()
    await waitFor(() => expect(warning()).not.toBeNull())

    // A save is authoritative even though the last read failed.
    notifyTenantTimezoneChanged('Asia/Taipei')
    await waitFor(() => expect(zone()).toBe('Asia/Taipei'))
    expect(warning()).toBeNull()
  })
})
