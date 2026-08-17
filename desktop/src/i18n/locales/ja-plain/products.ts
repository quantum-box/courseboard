import type { DeepPartial } from '../../types'
import type { products as source } from '../ja/products'

/** See `ja-plain/common.ts` for what this locale is for. */
export const products: DeepPartial<typeof source> = {
  loading: '料金プランを読み込んでいます',
  addService: 'プランを登録する',
  playType: {
    caddie: 'キャディが付く',
    self: 'キャディが付かない',
  },
  editor: {
    displayName: 'プランの名前',
    displayNameHint: '予約の画面や枠の一覧に出る名前です。',
    course: 'コース',
    courseHint: 'このプランを売るコースです。同じ中身で売るなら、いくつでも選べます。開いている時間と枠は、選んだコースそれぞれのものを使います。',
    courseUnset: 'コースを選んでください',
    courseNone: 'コースがまだありません。先にコースを作ってください。',
    courseSelectAll: 'ぜんぶ選ぶ / 外す',
    maxPlayers: '1組に入れる人数',
    maxPlayersHint: '1つの組に入れる人数の上限です。空のままなら、予約の決まりに従います。受けられる組の数は、コースの側で決めます。',
    maxPlayersValue: '{{n}}人',
    maxPlayersFromPolicy: '予約の決まりに従う',
    createTitle: 'プランを登録する',
    editTitle: 'プランの内容を直す',
    description: 'プランごとに、キャディが付くかどうか、ホールの数、かかる時間を決めます。',
    serviceId: 'プランの管理番号',
    serviceIdHintNew: 'プランの管理番号を入れてください。',
    serviceIdHintEdit: '一度決めた管理番号は変えられません。',
    playType: 'キャディが付くかどうか',
    holeCount: 'ホールの数',
    duration: '1ラウンドにかかる時間',
    durationHint: '30〜720分の間で入れてください',
    save: 'プランを保存する',
    saveFailed: 'プランを保存できません',
    saved: {
      title: 'プランを保存しました',
      body: '「{{name}}」（管理番号: {{serviceId}}）を保存しました。',
    },
  },
  list: {
    title: '登録したプラン',
    description: '行を選ぶと、そのプランの曜日ごとの枠が開きます。',
    editPlan: 'プランの設定',
    open: '{{name}} の枠を開く',
    empty: {
      title: 'プランがまだありません',
      description: 'プランを登録すると、キャディの有無や予約の枠を決められるようになります。',
      action: '最初のプランを登録する',
    },
    table: {
      service: 'プラン',
      course: 'コース',
      playType: 'キャディ',
      duration: 'かかる時間',
      updated: '最後に直した日',
      actions: '操作',
    },
  },
  detail: {
    back: 'プランの一覧に戻る',
    summary: 'プランの中身',
    notFound: {
      title: 'このプランは見つかりません',
      description: '管理番号 {{serviceId}} のプランがありません。消したか、住所（URL）がちがうのかもしれません。',
    },
  },
  course: {
    unset: 'コースが決まっていません',
    unknown: 'わからないコース',
    backlog: {
      title: 'コースが決まっていないプランが {{n}} 件あります',
      description: 'コースが決まっていないと、開いている時間や組を出す間隔、キャディの取り合いを確かめられません。順に開いて決めてください。',
    },
    required: {
      title: 'このプランはコースが決まっていません',
      description: 'コースを決めると、組を出す間隔からの上限の確認と、同じコースのほかのプランとのキャディの分け合いが動きます。',
    },
  },
  inventory: {
    title: '予約を受ける時間',
    description: '予約を受ける時間は、コースが持ちます。同じコースで売るプランは同じスタート枠を分け合うので、コースの側で決めます。',
    open: '{{course}} の時間を開く',
    needsCourse: {
      title: 'コースを決めると開けます',
      description: 'このプランをどのコースで売るかが、まだ決まっていません。プランの設定でコースを選んでください。',
    },
    legacy: {
      title: 'プランに古い枠が残っています',
      description: 'コースの側に移す前の設定です。ここでは直せません。予約の画面がコースの在庫を見るようになると、なくなります。',
      limits: '{{groups}}組 · {{players}}人',
    },
  },
  /** 残っているのは直せない古い枠の一覧だけ。 */
  slots: {
    week: {
      dayLabel: '{{day}}曜日',
    },
  },
  capacity: {
    title: 'キャディの人数から枠を作る',
    description:
      '休みの希望を出していないキャディは、出られるものとして数えます。計算した結果は、選んでいるプランの同じ曜日に入ります。',
    badge: '出勤の予定に合わせる',
    date: '数える日',
    targetWeekday: 'この日は{{day}}曜日です。結果は{{day}}曜日の枠に入ります。',
    calculate: '人数を数える',
    calculating: '数えています',
    failed: '人数を数えられません',
    groups: '{{n}}組',
    limit: '受けられる上限',
    activeCaddies: '出られるキャディ',
    activeCaddiesValue: '{{available}}人 / {{total}}人',
    assumed: '{{n}}人は休みの希望を出していません',
    allRegistered: '全員が希望を出しています',
    warning: {
      title: '休みの希望を出していない人がいます',
      description:
        '{{n}}人を、出られるものとして数えています。決める前にキャディの名簿で、休みの希望を確かめてください。',
    },
    applyTo: '{{day}}曜日の枠に入れる',
  },
  validation: {
    displayNameRequired: 'プランの名前を入れてください。',
    displayNameLength: 'プランの名前は 255 文字までです。',
    serviceIdRequired: 'プランの管理番号を入れてください。',
    serviceIdFormat: '管理番号に使えるのは、英字・数字・ピリオド・ハイフン・アンダースコア・コロンです。',
    courseRequired: 'コースを選んでください。コースごとに開いている時間もプレーの中身も違います。',
    maxPlayers: '1組に入れる人数は 1〜99 で入れてください。',
    holeCount: 'ホールの数は 9 か 18 を選んでください。',
    duration: 'かかる時間は 30〜720 分で入れてください。',
  },
  error: {
    generic: 'うまくいきませんでした。',
  },
}
