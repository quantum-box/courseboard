function isApplePlatform(userAgent: string) {
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(userAgent)
}

export function pageRefreshShortcutLabel(userAgent = navigator.userAgent) {
  return isApplePlatform(userAgent) ? '⌘R' : 'Ctrl+R'
}

export function isPageRefreshShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
) {
  return !event.altKey
    && !event.shiftKey
    && (event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === 'r'
}
