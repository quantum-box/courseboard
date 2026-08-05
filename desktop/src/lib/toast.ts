/**
 * Transient "it worked" / "it failed" messages.
 *
 * These used to be a banner pinned above the page, which pushed the content
 * down and stayed until it was dismissed by hand. A toast says the same thing
 * over the app and then gets out of the way, so the screen the operator was
 * reading does not move under them.
 */

import { toast } from '@tachyon-sdk/native-ui'

export type ToastTone = 'success' | 'danger' | 'warning' | 'info'

export type ToastMessage = {
  tone: ToastTone
  /** Headline; the message becomes the description under it. */
  title?: string
  message: string
}

/** Errors stay up longer: they usually need reading twice, or acting on. */
const ERROR_DURATION_MS = 8_000

export function showToast(input: ToastMessage | null) {
  if (!input) return
  const { tone, title, message } = input
  const headline = title ?? message
  const options = {
    ...(title ? { description: message } : {}),
    ...(tone === 'danger' ? { duration: ERROR_DURATION_MS } : {}),
  }
  if (tone === 'success') return toast.success(headline, options)
  if (tone === 'danger') return toast.error(headline, options)
  if (tone === 'warning') return toast.warning(headline, options)
  return toast.info(headline, options)
}
