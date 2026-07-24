import { describe, expect, it } from 'vitest'
import {
  isPageRefreshShortcut,
  pageRefreshShortcutLabel,
} from './shortcuts'

describe('page shortcuts', () => {
  const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'

  it('recognizes the standard page refresh shortcut', () => {
    expect(pageRefreshShortcutLabel(macUserAgent)).toBe('⌘R')
    expect(isPageRefreshShortcut({ altKey: false, ctrlKey: false, key: 'r', metaKey: true, shiftKey: false })).toBe(true)
    expect(isPageRefreshShortcut({ altKey: true, ctrlKey: false, key: 'r', metaKey: true, shiftKey: false })).toBe(false)
    expect(isPageRefreshShortcut({ altKey: false, ctrlKey: false, key: 'r', metaKey: true, shiftKey: true })).toBe(false)
  })
})
