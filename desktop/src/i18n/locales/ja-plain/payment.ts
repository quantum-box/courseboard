import type { DeepPartial } from '../../types'
import type { payment as source } from '../ja/payment'

/**
 * Shown to guests paying a cancellation fee, so it avoids both IT jargon and
 * internal course vocabulary. See `ja-plain/common.ts` for the wider policy.
 */
export const payment: DeepPartial<typeof source> = {
  unavailable: 'この支払いの画面は、今はご利用いただけません。お手数ですが、ゴルフ場にお問い合わせください。',
  loadFailed: '内容を読み込めませんでした',
  formFailed: '支払いの入力欄を用意できませんでした',
  cannotOpen: 'この画面は開けません',
  loading: '開いています…',
  paid: {
    title: 'お支払いは済んでいます',
    description: 'キャンセル料のお支払いを確認しました。ありがとうございました。',
  },
  field: {
    client: 'お名前',
    reference: '対象の予約',
    due: 'お支払いの期限',
  },
  form: {
    unavailableTitle: '支払いの入力欄を用意できません',
    preparing: '支払いの入力欄を用意しています…',
    initFailed: '支払いの入力欄を開けませんでした',
    initFailedTitle: '支払いの入力欄を開けません',
    loading: '支払いの入力欄を読み込んでいます…',
    loadFailed: '支払いの入力欄を読み込めませんでした',
    amount: 'お支払いいただく金額',
    submit: 'この内容で支払う',
    submitting: '手続きをしています…',
    failed: 'お支払いができませんでした',
    succeeded: 'お支払いを確認しました',
    processing: 'お支払いを受け付けました。確認できるまで少しお待ちください。',
  },
  pdf: {
    due: 'お支払いの期限  {{date}}',
    columns: {
      item: '内容',
      quantity: '数',
      unitPrice: '1つあたり',
      amount: '金額',
    },
    notes: 'ひとこと',
    paymentLink: 'お支払いの画面',
  },
}
