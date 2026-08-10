import { describe, expect, it } from 'vitest'
import { isPageRefreshShortcut } from './shortcuts'

describe('page shortcuts', () => {
  it('recognizes the standard page refresh shortcut', () => {
    expect(isPageRefreshShortcut({ altKey: false, ctrlKey: false, key: 'r', metaKey: true, shiftKey: false })).toBe(true)
    expect(isPageRefreshShortcut({ altKey: true, ctrlKey: false, key: 'r', metaKey: true, shiftKey: false })).toBe(false)
    expect(isPageRefreshShortcut({ altKey: false, ctrlKey: false, key: 'r', metaKey: true, shiftKey: true })).toBe(false)
  })
})
