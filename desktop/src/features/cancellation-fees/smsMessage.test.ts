import { describe, expect, it } from 'vitest'
import {
  renderSmsPreview,
  SAMPLE_PAYMENT_URL,
  smsCharacterCount,
  smsPartCount,
  SMS_MULTI_PART_LIMIT,
  SMS_SINGLE_PART_LIMIT,
} from './smsMessage'

/** The template the new-fee form ships with, as `smsBodyDefault` spells it. */
const DEFAULT_TEMPLATE =
  'Course Boardです。\nキャンセル料{amount}円のお支払いをお願いします。\n支払期限:{dueDate}\n{url}'

describe('rendering the preview', () => {
  it('fills in the amount, the due date and the payment link', () => {
    const text = renderSmsPreview({
      template: DEFAULT_TEMPLATE,
      amount: 5000,
      dueDate: '2026-09-25',
    })

    expect(text).toContain('キャンセル料5000円')
    expect(text).toContain('支払期限:2026-09-25')
    expect(text).toContain(SAMPLE_PAYMENT_URL)
    expect(text).not.toContain('{')
  })

  it('uses the real link once the invoice has one', () => {
    const url = 'https://tachyonfield.txcloud.app/p/01m2sg430rac0pssdmapgrtzx7'

    const text = renderSmsPreview({
      template: '{url}',
      amount: 5000,
      dueDate: '2026-09-25',
      paymentUrl: url,
    })

    expect(text).toBe(url)
  })

  it('stands the sample link in at the length of a real one', () => {
    // The part count is the number this preview exists to get right, and a
    // stand-in of the wrong length would misreport it. Taken off a message
    // Field actually delivered, not from the pricing note, which still
    // describes a longer `/pay/inv_…` form.
    const real = 'https://tachyonfield.txcloud.app/p/01m2sg430rac0pssdmapgrtzx7'

    expect(SAMPLE_PAYMENT_URL).toHaveLength(real.length)
    expect(SAMPLE_PAYMENT_URL).toHaveLength(61)
  })

  it('leaves a placeholder it cannot resolve standing', () => {
    // Blanking it would read as a message Field is about to send with a hole
    // in it; left standing, it reads as unknown.
    const text = renderSmsPreview({
      template: '{company}より{amount}円',
      amount: 5000,
      dueDate: '2026-09-25',
    })

    expect(text).toBe('{company}より5000円')
  })

  it('replaces a placeholder used more than once', () => {
    const text = renderSmsPreview({
      template: '{amount}円 / {amount}円',
      amount: 300,
      dueDate: '2026-09-25',
    })

    expect(text).toBe('300円 / 300円')
  })
})

describe('counting what AWS bills', () => {
  it('bills one part up to the single-part limit', () => {
    expect(smsPartCount('あ'.repeat(SMS_SINGLE_PART_LIMIT))).toBe(1)
  })

  it('splits as soon as the message passes it', () => {
    expect(smsPartCount('あ'.repeat(SMS_SINGLE_PART_LIMIT + 1))).toBe(2)
  })

  it('counts a split message against the shorter per-part limit', () => {
    expect(smsPartCount('あ'.repeat(SMS_MULTI_PART_LIMIT * 2))).toBe(2)
    expect(smsPartCount('あ'.repeat(SMS_MULTI_PART_LIMIT * 2 + 1))).toBe(3)
  })

  it('bills an empty message as one part rather than none', () => {
    expect(smsPartCount('')).toBe(1)
  })

  it('counts a character outside the basic plane once', () => {
    expect(smsCharacterCount('𠮟')).toBe(1)
  })

  it('keeps the shipped template inside two parts', () => {
    // A canary on the cost of every send: two parts is what the pricing note
    // is built on, and a third is 50% dearer for text that looks no different.
    const text = renderSmsPreview({
      template: DEFAULT_TEMPLATE,
      amount: 5000,
      dueDate: '2026-09-25',
    })

    expect(smsCharacterCount(text)).toBe(118)
    expect(smsPartCount(text)).toBe(2)
  })

  it('still fits two parts at a fee wide enough to be real', () => {
    // Digits alone no longer tip it: the shipped wording leaves enough room
    // that even a seven-figure fee stays at two parts.
    const text = renderSmsPreview({
      template: DEFAULT_TEMPLATE,
      amount: 1000000,
      dueDate: '2026-09-25',
    })

    expect(smsPartCount(text)).toBe(2)
  })

  it('tips into a third part once the wording eats the headroom', () => {
    // 118 characters against a 134-character ceiling: seventeen added
    // characters are what it costs, which is one short phrase.
    const text = renderSmsPreview({
      template: `${DEFAULT_TEMPLATE}\nご不明な点はフロントまでお問い合わせください`,
      amount: 5000,
      dueDate: '2026-09-25',
    })

    expect(smsPartCount(text)).toBe(3)
  })
})
