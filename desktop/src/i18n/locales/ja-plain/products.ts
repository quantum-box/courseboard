import type { DeepPartial } from '../../types'
import type { products as source } from '../ja/products'

/** See `ja-plain/common.ts` for what this locale is for. */
export const products: DeepPartial<typeof source> = {
  title: 'プレーの料金プラン',
  description: '売るプランの種類と、曜日ごとに予約を受けられる時間の枠を決めます。',
  loadingDescription: 'プランと予約の枠を読み込んでいます。',
  loading: '料金プランを読み込んでいます',
  addService: 'プランを登録する',
  playType: {
    caddie: 'キャディが付く',
    self: 'キャディが付かない',
  },
  confirm: {
    discardOnReload: '保存していない枠があります。捨てて読み込み直しますか。',
    discardOnSave: '保存していない枠があります。保存しないまま進めますか。',
  },
  editor: {
    displayName: 'プランの名前',
    displayNameHint: '予約の画面や枠の一覧に出る名前です。',
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
    description: '行を選ぶと、そのプランの曜日ごとの枠を下で直せます。',
    selected: '選んでいます',
    empty: {
      title: 'プランがまだありません',
      description: 'プランを登録すると、キャディの有無や予約の枠を決められるようになります。',
      action: '最初のプランを登録する',
    },
    table: {
      service: 'プラン',
      playType: 'キャディ',
      duration: 'かかる時間',
      slots: '予約の枠',
      slotCount: '{{n}}枠',
      unsaved: 'まだ保存していません',
      updated: '最後に直した日',
      actions: '操作',
    },
  },
  slots: {
    title: '予約の枠 · {{name}}',
    subtitle: '管理番号: {{serviceId}}',
    description: '0 を入れると「制限なし」になります。曜日と時間が同じ行は、2つ登録できません。',
    add: '枠を増やす',
    save: '枠を保存する',
    saveFailed: '枠を保存できません',
    saved: {
      title: '枠を保存しました',
      body: '{{serviceId}} の枠を {{n}} 件に入れかえました。',
    },
    loadFailed: {
      title: '今の枠を読み込めませんでした',
      description:
        '中身が空のまま保存すると、今ある枠が消えてしまうことがあります。読み込み直してから直してください。',
    },
    empty: {
      title: '枠がまだありません',
      description:
        '曜日と時間を足すか、下の「キャディの人数から枠を作る」で、午前と午後の枠を作ってください。',
    },
    table: {
      start: '始まり',
      end: '終わり',
      maxGroups: '受けられる組数',
      maxPlayers: '受けられる人数',
      delete: '消す',
      deleteAria: '{{day}}曜日 {{time}} の枠を消す',
    },
  },
  capacity: {
    title: 'キャディの人数から枠を作る',
    description:
      '休みの希望を出していないキャディは、出られるものとして数えます。計算した結果は、選んでいるプランの同じ曜日に入ります。',
    badge: '出勤の予定に合わせる',
    date: '数える日',
    calculate: '人数を数える',
    calculating: '数えています',
    failed: '人数を数えられません',
    groups: '{{n}}組',
    limit: '受けられる上限',
    rounds: '回れる回数',
    roundsDetail: '1日2回まわる希望も入れています',
    activeCaddies: '出られるキャディ',
    activeCaddiesValue: '{{available}}人 / {{total}}人',
    assumed: '{{n}}人は休みの希望を出していません',
    allRegistered: '全員が希望を出しています',
    warning: {
      title: '休みの希望を出していない人がいます',
      description:
        '{{n}}人を、出られるものとして数えています。決める前にキャディの名簿で、休みの希望を確かめてください。',
    },
    apply: 'この曜日の枠に入れる',
    applied: {
      title: '枠の数に入れました',
      body: 'まだ保存していません。時間を確かめてから「枠を保存する」を押してください。',
    },
    selfNotice: {
      title: 'キャディが付かないプランです',
      description: 'キャディの人数を数える必要はありません。曜日ごとの組数と人数を、直接入れてください。',
    },
  },
  slotValidation: {
    weekday: '{{row}}行目：曜日を選んでください。',
    time: '{{row}}行目：始まりと終わりの時刻を入れてください。',
    order: '{{row}}行目：終わりは、始まりより後にしてください。',
    maxGroups: '{{row}}行目：受けられる組数は 0 以上で入れてください。',
    maxPlayers: '{{row}}行目：受けられる人数は 0 以上で入れてください。',
    duplicate: '{{row}}行目：同じ曜日・同じ時間の枠がすでにあります。',
  },
  validation: {
    displayNameRequired: 'プランの名前を入れてください。',
    displayNameLength: 'プランの名前は 255 文字までです。',
    serviceIdRequired: 'プランの管理番号を入れてください。',
    serviceIdFormat: '管理番号に使えるのは、英字・数字・ピリオド・ハイフン・アンダースコア・コロンです。',
    holeCount: 'ホールの数は 9 か 18 を選んでください。',
    duration: 'かかる時間は 30〜720 分で入れてください。',
  },
  error: {
    generic: 'うまくいきませんでした。',
  },
}
