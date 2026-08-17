/**
 * Transient "it worked" / "it failed" messages.
 *
 * These used to be a banner pinned above the page, which pushed the content
 * down and stayed until it was dismissed by hand. A toast says the same thing
 * over the app and then gets out of the way, so the screen the operator was
 * reading does not move under them.
 */

import { toast } from '@tachyon-sdk/native-ui'

export type ToastTone = 'success' | 'danger' | 'warning' | 'info' | 'loading'

export type ToastMessage = {
  tone: ToastTone
  /** Headline; the message becomes the description under it. */
  title?: string
  message: string
  /** Reuse an id when repeated feedback should replace itself rather than stack. */
  id?: string
  /** Individual notices can use a less disruptive corner than the shared default. */
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
}

/** Every toast is finite; errors stay longer because they usually need rereading. */
export const DEFAULT_TOAST_DURATION_MS = 4_000
export const ERROR_TOAST_DURATION_MS = 8_000

export function showToast(input: ToastMessage | null) {
  if (!input) return
  const { tone, title, message, id, position } = input
  const headline = title ?? message
  const options = {
    ...(title ? { description: message } : {}),
    ...(id ? { id } : {}),
    ...(position ? { position } : {}),
    duration: tone === 'loading'
      ? Number.POSITIVE_INFINITY
      : tone === 'danger' ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS,
  }
  if (tone === 'loading') return toast.loading(headline, options)
  if (tone === 'success') return toast.success(headline, options)
  if (tone === 'danger') return toast.error(headline, options)
  if (tone === 'warning') return toast.warning(headline, options)
  return toast.info(headline, options)
}
