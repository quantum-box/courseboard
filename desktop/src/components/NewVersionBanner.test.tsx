// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewVersionBanner } from './NewVersionBanner'
import { useNewVersionAvailable } from '../lib/newVersion'

vi.mock('../lib/newVersion', () => ({
  useNewVersionAvailable: vi.fn(),
}))

const mockedUseNewVersionAvailable = vi.mocked(useNewVersionAvailable)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NewVersionBanner', () => {
  it('renders nothing while no new version has been detected', () => {
    mockedUseNewVersionAvailable.mockReturnValue(false)
    const { container } = render(<NewVersionBanner />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the reload prompt as a non-modal status message once a new version is detected', () => {
    mockedUseNewVersionAvailable.mockReturnValue(true)
    render(<NewVersionBanner />)

    expect(screen.getByRole('status').textContent).toContain(
      '新しいバージョンが公開されました。再読み込みすると最新の画面になります。',
    )
  })

  it('reloads the page when the reload button is clicked', () => {
    mockedUseNewVersionAvailable.mockReturnValue(true)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    render(<NewVersionBanner />)
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('hides itself when dismissed, without blocking anything the operator was doing', () => {
    mockedUseNewVersionAvailable.mockReturnValue(true)
    render(<NewVersionBanner />)

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the reload/dismiss controls on the class names styles.css targets for pointer-events', () => {
    // The card itself is pointer-events: none in styles.css, mirroring the
    // shared toast layer's "never intercept the next click" rule — only
    // these two classes get pointer-events: auto back. Renaming either class
    // without updating the CSS would silently make the button unclickable.
    mockedUseNewVersionAvailable.mockReturnValue(true)
    render(<NewVersionBanner />)

    expect(screen.getByRole('button', { name: '再読み込み' }).className)
      .toContain('new-version-banner-reload')
    expect(screen.getByRole('button', { name: '閉じる' }).className)
      .toContain('new-version-banner-dismiss')
  })
})
