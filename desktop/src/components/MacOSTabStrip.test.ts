import { describe, expect, it } from 'vitest'
import { supportsDesktopTabs, tabTitleForRoute } from './MacOSTabStrip'

describe('tabTitleForRoute', () => {
  it('maps known routes to concise tab titles', () => {
    expect(tabTitleForRoute('golf')).toBe('ホーム')
    expect(tabTitleForRoute('golf/caddies/dispatch')).toBe('今日の配置')
    expect(tabTitleForRoute('settings')).toBe('設定')
  })

  it('falls back to the product title', () => {
    expect(tabTitleForRoute('unknown')).toBe('Course Board')
  })
})

describe('supportsDesktopTabs', () => {
  it('enables native tabs on macOS and Windows only', () => {
    expect(supportsDesktopTabs('macos')).toBe(true)
    expect(supportsDesktopTabs('windows')).toBe(true)
    expect(supportsDesktopTabs('linux')).toBe(false)
    expect(supportsDesktopTabs('ios')).toBe(false)
  })
})
