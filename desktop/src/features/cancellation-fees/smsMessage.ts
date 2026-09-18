/**
 * What a cancellation-fee SMS will actually say, and what it will actually cost.
 *
 * The desk never sees the finished text before it goes out: the operator edits
 * a template, Field substitutes the placeholders, and AWS SNS sends the result.
 * That matters beyond proofreading, because AWS bills per part and Japanese
 * text falls outside GSM 03.38 — 70 characters for a single part, 67 per part
 * once it spills over (`docs/src/business/cancellation-fee-pricing.md`). The
 * shipped template renders to 118 characters against a 134-character two-part
 * ceiling, so one added phrase makes every send 50% dearer while looking no
 * different. The confirmation step renders this so both are visible first.
 */

/** Characters a single-part message may hold before it starts splitting. */
export const SMS_SINGLE_PART_LIMIT = 70

/** Characters each part holds once the message is split. */
export const SMS_MULTI_PART_LIMIT = 67

/**
 * A stand-in for the payment link, the same length as a real one.
 *
 * The real URL does not exist yet at the confirmation step — Field mints it
 * when the invoice is created. A placeholder of the wrong length would
 * misreport the part count, which is the one number the preview exists to get
 * right, so this mirrors the shape of a link taken off a message Field
 * actually sent: the `/p/` path on `tachyonfield.txcloud.app` followed by a
 * 26-character id, 61 characters in all. The `/pay/inv_…` form written up in
 * `docs/src/business/cancellation-fee-pricing.md` is an older one and is six
 * characters longer.
 */
export const SAMPLE_PAYMENT_URL =
  'https://tachyonfield.txcloud.app/p/00000000000000000000000000'

export type SmsPreviewInput = {
  /** The template as the operator left it, placeholders included. */
  template: string
  /** What the message quotes as owed. */
  amount: number
  dueDate: string
  /**
   * The payment link, when one is already known. Defaults to a same-length
   * stand-in so the part count is right before the invoice exists.
   */
  paymentUrl?: string
}

/**
 * Fill in the placeholders the send is known to resolve.
 *
 * Anything else the operator types is left standing rather than guessed at:
 * showing an unknown placeholder verbatim tells them it is unknown, where
 * quietly blanking it would read as a message that Field is about to send with
 * a hole in it.
 */
export function renderSmsPreview(input: SmsPreviewInput): string {
  return input.template
    .replaceAll('{amount}', String(input.amount))
    .replaceAll('{dueDate}', input.dueDate.trim())
    .replaceAll('{url}', input.paymentUrl ?? SAMPLE_PAYMENT_URL)
}

/**
 * How many parts AWS will bill this message as.
 *
 * Empty text is one part rather than zero: nothing is sent for free, and a
 * zero here would read as "this costs nothing" at the moment the operator is
 * deciding whether to send.
 */
export function smsPartCount(text: string): number {
  const length = [...text].length
  if (length <= SMS_SINGLE_PART_LIMIT) return 1
  return Math.ceil(length / SMS_MULTI_PART_LIMIT)
}

/** Characters as AWS counts them, so surrogate pairs count once. */
export function smsCharacterCount(text: string): number {
  return [...text].length
}
