type PlatformKind = 'web' | 'desktop' | 'mobile'

type ShortcutEvent = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'metaKey'>

function isApplePlatform(userAgent: string) {
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(userAgent)
}

export function navigationShortcutLabel(
  digit: string,
  platform: PlatformKind,
  userAgent = navigator.userAgent,
) {
  if (platform === 'web') return isApplePlatform(userAgent) ? `⌃${digit}` : `Alt+${digit}`
  return isApplePlatform(userAgent) ? `⌘${digit}` : `Ctrl+${digit}`
}

export function navigationShortcutDigit(
  event: ShortcutEvent,
  platform: PlatformKind,
  userAgent = navigator.userAgent,
) {
  const expectedModifier = platform === 'web'
    ? isApplePlatform(userAgent)
      ? event.ctrlKey && !event.altKey && !event.metaKey
      : event.altKey && !event.metaKey && !event.ctrlKey
    : (event.metaKey || event.ctrlKey) && !event.altKey

  if (!expectedModifier) return null

  const match = /^(?:Digit|Numpad)([1-8])$/.exec(event.code)
  return match?.[1] ?? null
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
