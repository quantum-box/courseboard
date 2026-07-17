import { describe, expect, it } from 'vitest'
import {
  isPageRefreshShortcut,
  navigationShortcutDigit,
  navigationShortcutLabel,
  pageRefreshShortcutLabel,
} from './shortcuts'

describe('navigation shortcuts', () => {
  const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'

  it('uses Control on Apple browsers because Command-number is reserved by the browser', () => {
    expect(navigationShortcutLabel('1', 'web', macUserAgent)).toBe('⌃1')
    expect(navigationShortcutDigit(
      { altKey: false, code: 'Digit1', ctrlKey: true, metaKey: false },
      'web',
      macUserAgent,
    )).toBe('1')
  })

  it('uses Alt on non-Apple browsers', () => {
    expect(navigationShortcutLabel('2', 'web', 'Mozilla/5.0 (Windows NT 10.0)')).toBe('Alt+2')
  })

  it('keeps native desktop shortcuts on the platform command modifier', () => {
    expect(navigationShortcutLabel('3', 'desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('⌘3')
    expect(navigationShortcutDigit(
      { altKey: false, code: 'Digit3', ctrlKey: false, metaKey: true },
      'desktop',
      macUserAgent,
    )).toBe('3')
  })

  it('does not handle browser-reserved Command-number shortcuts on the Web', () => {
    expect(navigationShortcutDigit(
      { altKey: false, code: 'Digit1', ctrlKey: false, metaKey: true },
      'web',
      macUserAgent,
    )).toBeNull()
  })

  it('recognizes the standard page refresh shortcut', () => {
    expect(pageRefreshShortcutLabel(macUserAgent)).toBe('⌘R')
    expect(isPageRefreshShortcut({ altKey: false, ctrlKey: false, key: 'r', metaKey: true, shiftKey: false })).toBe(true)
    expect(isPageRefreshShortcut({ altKey: true, ctrlKey: false, key: 'r', metaKey: true, shiftKey: false })).toBe(false)
    expect(isPageRefreshShortcut({ altKey: false, ctrlKey: false, key: 'r', metaKey: true, shiftKey: true })).toBe(false)
  })
})
