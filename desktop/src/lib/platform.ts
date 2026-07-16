import { invoke } from '@tauri-apps/api/core'

export function isTauri() {
  return '__TAURI_INTERNALS__' in window
}

export function platformKind(): 'web' | 'desktop' | 'mobile' {
  if (!isTauri()) return 'web'
  const ua = navigator.userAgent.toLowerCase()
  return /iphone|ipad|android/.test(ua) ? 'mobile' : 'desktop'
}

export function platformLabel() {
  const platform = platformKind()
  if (platform === 'mobile') return 'Mobile'
  if (platform === 'desktop') return 'Desktop'
  return 'Web'
}

const DEFAULT_EXTERNAL_HOSTS = [
  'stripe.com',
  'square.link',
  'square.site',
  'squareup.com',
  'txcloud.app',
]

function trustedExternalHosts() {
  const configured = (import.meta.env.VITE_COURSEBOARD_EXTERNAL_HOSTS ?? '')
    .split(',')
    .map((host: string) => host.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
  return new Set([...DEFAULT_EXTERNAL_HOSTS, ...configured])
}

export function safeExternalUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('外部URLが不正です。')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('HTTPS以外の外部URLは開けません。')
  }
  const hostname = url.hostname.toLowerCase()
  const allowed = [...trustedExternalHosts()].some(
    host => hostname === host || hostname.endsWith(`.${host}`),
  )
  if (!allowed) throw new Error('許可されていない外部サイトは開けません。')
  return url.toString()
}

export async function openExternal(value: string) {
  const url = safeExternalUrl(value)
  if (isTauri()) {
    await invoke('open_external_url', { url })
    return
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) throw new Error('外部サイトを開けませんでした。ポップアップ設定を確認してください。')
}

export function safeAreaInsetsSupported() {
  return CSS.supports('padding-top: env(safe-area-inset-top)')
}
