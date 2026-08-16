import type { DeepPartial } from '../../types'
import type { settlement as source } from '../ja/settlement'

/** See `ja-plain/common.ts` for what this locale is for. */
export const settlement: DeepPartial<typeof source> = {
  title: '1か月のしめ',
  description:
    '1か月分の予約の売上、キャディの費用、キャンセル料、入ったお金を、しめる前に確かめます。',
  loading: '1か月分を集計しています',
  month: '見たい月',
  badge: '月ごとのしめ',
  exportCsv: '表のファイルで書き出す',
  exporting: '書き出しています…',
  exportFailed: 'ファイルを書き出せませんでした。',
  squareUnmatchedNote:
    '入金の記録と予約を突き合わせる表が、まだ用意されていません。入金・返金・突き合わせ待ちの件数は、目安の数字として見てください。',
  summary: {
    title: 'この月のまとめ',
    description: '{{month}} · 予約 {{n}} 件',
    badge: 'しめる前の確認',
    metrics: {
      revenue: '予約の売上',
      paid: '入ったお金',
      paidDetail: '予約に対して実際に入った金額',
      unpaid: 'まだ入っていないお金',
      unpaidDetail: '売上から、入ったお金を引いた残り',
      refunded: '返したお金',
      refundedDetail: 'この月に返金した分',
      caddieCost: 'キャディの費用',
      caddieCostDetail: '担当 {{n}} 件分',
      unpaidCancellation: 'まだ入っていないキャンセル料',
      squareIn: '決済で入ったお金',
      squareInDetail: '取り込みずみの記録',
      squareRefund: '決済で返したお金',
      squareRefundDetail: '差し引き {{amount}}',
      squareUnmatched: '予約と結びついていない記録',
      squareUnmatchedDetail: 'どの予約の入金か分からない記録',
    },
    warning: '入金の突き合わせで、気をつける点があります',
  },
  reservations: {
    title: 'この月に入っている予約',
    description: 'お客さま、利用した日時、コースを並べて、売上や入ったお金と見比べます。',
    empty: 'この月の予約はありません',
    table: {
      dateTime: '利用した日時',
      customer: 'お客さま',
      course: 'コース',
      number: '予約番号',
    },
    unknown: {
      dateTime: '利用した日時が分かりません',
      customer: 'お客さまの名前が分かりません',
      course: 'コースが分かりません',
      number: '予約番号が分かりません',
    },
    unavailable: {
      title: '予約のくわしい情報を読み込めませんでした',
      description: '月のまとめは見ることができます。もう一度読み込んでから、予約とお金を見比べてください。',
    },
  },
  unpaidCancellations: {
    title: 'お金が入っていないキャンセル',
    description:
      '請求を送るか、入金があったか確かめる必要のある予約です。予約番号・キャンセル料・支払いの状態を出します。',
    numberUnknown: '予約番号が分かりませんでした',
    empty: {
      title: '未入金のキャンセルはありません',
      description: 'この月のキャンセル料は、すべて受け取りずみです。',
    },
  },
  billing: {
    title: 'まだ入っていないキャンセル料',
    description: '同じ予約でもう一度押しても、前に作った請求書をそのまま使います。二重に請求されません。',
    failed: '請求書を作れませんでした',
    reused: '前に作った請求書をそのまま使いました',
    issued: '請求書を作りました',
    openPayment: '支払いの画面を開く',
    paymentUrlNote: '支払いの画面を開けます。',
    invalidUrl: '支払いの画面のリンクが正しくありません。',
    openFailed: '支払いの画面を開けませんでした。',
    issueFailed: '請求書を作れませんでした。',
    empty: {
      title: 'まだ入っていないキャンセル料はありません',
      description: 'この期間に、新しく送る請求はありません。',
    },
    paymentStatusValue: {
      paid: 'お金が入りました',
      pending: 'お金が入るのを待っています',
      unpaid: 'まだお金が入っていません',
      fee_paid: 'キャンセル料が入りました',
      fee_pending: 'キャンセル料が入るのを待っています',
      fee_unpaid: 'キャンセル料がまだ入っていません',
      refunded: 'お金を返しました',
      failed: '支払いがうまくいきませんでした',
      canceled: '取り消しました',
      cancelled: '取り消しました',
      unknown: '分かりません（{{value}}）',
    },
    table: {
      paymentStatus: '支払いの状態',
      invoice: '請求書',
      issued: '作りました',
      notIssued: 'まだ作っていません',
      actions: '操作',
      checking: '確かめています…',
      checkExisting: '前に作った請求書を見る',
      issue: '請求書を作る',
    },
  },
  checklist: {
    title: 'しめる前に見るところ',
    description: 'この画面は、ゴルフ場の仕事のしめです。経理の月次決算とは別に行います。',
    reservation: {
      title: '予約',
      detail: '売上・入ったお金・返したお金の差を見る',
    },
    caddie: {
      title: 'キャディ',
      detail: '担当した件数と、その費用を見る',
    },
    payment: {
      title: 'お金',
      detail: 'まだ入っていない分と、予約と結びついていない記録をなくす',
    },
  },
}
