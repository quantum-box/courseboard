import type { DeepPartial } from '../../types'
import type { settings as source } from '../ja/settings'

/** See `ja-plain/common.ts` for what this locale is for. */
export const settings: DeepPartial<typeof source> = {
  description: '最初に決めておく設定と、ほかのサービスとのつなぎをまとめています。',
  tenantMaster: {
    title: '最初に決めておく設定',
    description: '最初に一度そろえておけば、ふだんは開きません。',
  },
  extension: {
    loading: 'ゴルフ用の機能を確かめています',
    missing: {
      title: 'ゴルフ用の機能が見つかりません',
      description: 'ゴルフ用の機能が使える状態になっているか、担当の人に確かめてください。',
    },
    title: 'ゴルフ用の機能の設定',
    description:
      'このゴルフ場ぜんたいで使う、お金の単位と時刻の基準です。最初に一度決めれば、ふだんは変えません。',
    enabled: '使えます',
    disabled: '止まっています',
    invalid: '設定に問題があります',
    valid: '確かめました',
    unsaved: 'まだ保存していません',
    reload: '読み直す',
    save: '設定を保存する',
    loadingConfig: '設定を読み込んでいます',
    statusUnavailable: {
      title: '今の状態を受け取れません',
      description: '機能が使える状態かどうかが分かりませんでした。保存する前に、担当の人に確かめてください。',
    },
    invalidConfig: {
      title: '今の設定に問題があります',
    },
    currency: 'お金の単位',
    currencyHint: '最後に直した日 {{updated}}',
    timezone: '時刻の基準（タイムゾーン）',
    timezoneHint: '日本のゴルフ場なら Asia/Tokyo です',
    saveFailed: '設定を保存できません',
    saved: {
      title: '設定を保存しました',
      description: 'お金の単位と時刻の基準を新しくしました。',
    },
    validation: {
      currencyRequired: 'お金の単位を選んでください。',
      currencyFormat: 'お金の単位は、JPY のような3文字で入れてください。',
      timezoneRequired: '時刻の基準を入れてください。',
    },
    error: {
      generic: 'うまくいきませんでした。',
    },
  },
  advanced: {
    title: 'システムどうしのつなぎの詳細',
    description: 'ゴルフ機能が動いているかどうかと、ほかのシステムとつなぐための設定です。ふだんの仕事では開きません。',
    linkLabel: 'システムどうしのつなぎの詳細',
    linkDescription: '機能が動いているかと、つなぐための設定',
  },
  summary: {
    title: 'ゴルフ機能が動いているか',
    description: 'このゴルフ場の今の設定',
    tenantStatus: 'ゴルフ場の状態',
    registry: '機能の登録',
    validation: '設定の確かめ',
    ready: '使えます',
    configVersion: '設定の版',
    defaultVersion: '最初のまま',
    invalid: {
      title: '設定を直してください',
    },
    valid: '設定に問題はありません。',
  },
  metadata: {
    title: 'ほかのシステムとつなぐための設定',
    description:
      '予約をほかのシステムに送るときに使う設定です。ふだんの受付では触りません。',
    unsaved: 'まだ保存していません',
    reload: '読み直す',
    save: '保存する',
    loading: '設定を読み込んでいます',
    policyMissing: {
      title: '予約の決まりごとが、まだありません',
      description: '先に「予約の決まりごと」を保存してから、ここに追加してください。',
    },
    when: {
      title: 'どんなときに使うか',
      description:
        '予約を別の予約システムや会員システムに送るとき、ゴルフ場のコードなどをここに入れます。ふだんの受付では使いません。空のままで問題ありません。',
    },
    fieldLabel: 'ほかのシステムに渡す情報（JSON）',
    fieldHint: 'JSON という形式で、{ } で囲んで書きます。空のままでもかまいません。',
    examplesTitle: '使いかたの例',
    example1: '別のシステムのゴルフ場コードと結びつける',
    example2: '予約サイトごとに、送る・送らないを切り替える',
    example3: '予約番号を相手のシステムに返すかどうか',
    invalidJson: '書き方を見直してください',
    saveFailed: '保存できませんでした',
    saved: {
      title: '設定を保存しました',
      description: 'これから入る予約から、この設定が使われます。',
    },
    validation: {
      object: '{ } で囲んだ形で入れてください。',
      syntax: '書き方に間違いがあります。かっこやカンマを確かめてください。',
      failed: '設定を保存できませんでした。',
    },
  },
  validation: {
    duration: 'ふつうのかかる時間は 30〜720 分で入れてください。',
    holes: 'ふつうのホールの数は 9 か 18 を選んでください。',
    maxPlayers: '1つの枠の人数は 1〜4 人で入れてください。',
    memberDeposit: '会員が先に払う割合は 0〜100% で入れてください。',
    guestDeposit: '会員以外が先に払う割合は 0〜100% で入れてください。',
  },
}
