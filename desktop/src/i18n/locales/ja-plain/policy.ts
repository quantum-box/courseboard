import type { DeepPartial } from '../../types'
import type { policy as source } from '../ja/policy'

/** See `ja-plain/common.ts` for what this locale is for. */
export const policy: DeepPartial<typeof source> = {
  title: '予約の決まりごと',
  description:
    'どんな予約を受けるかを決めます。最初に一度決めておく設定なので、ふだんは開きません。',
  loading: '決まりごとを読み込んでいます',
  save: '決まりごとを保存する',
  status: {
    configured: '決めてあります',
    missing: 'まだ決めていません',
  },
  unset: {
    title: '予約の決まりごとは、まだ保存されていません',
    description:
      '保存するまでは、セルフで受けない時間や、1人あたりの金額のチェックは効きません。予約はそのまま入ります。下の最初の値を見て、保存してください。',
  },
  saved: {
    title: '決まりごとを保存しました',
    description: 'これから入る予約は、この内容で判断します。',
  },
  invalid: {
    title: '保存する前に、入力した内容を見直してください',
  },
  saveFailed: '決まりごとを保存できませんでした。',
  basics: {
    title: '予約の基本',
    description: '新しく作るスタート時刻と、料金プランで共通して使う数字です。',
    reservationTypeId: '予約の種類のID',
    reservationTypeIdHint: '空のままなら、今の設定をそのまま使います',
    defaultHoles: 'ふつうのホールの数',
    maxPlayers: '1つの スタート枠に 入れる人数',
    cart: 'カートの使い方',
    cutoff: '予約を受け付ける期限',
    cutoffHint: 'スタート時刻の何時間前まで受け付けるか',
    bookingHorizon: '何日先まで予約を受けるか',
    bookingHorizonHint: '今日から数えた日数です。この間のスタート枠だけが作られて、予約を受けられます。',
    bookingHorizonThrough: '今は {{date}} まで予約を受けられます。変えると、ぜんぶのコースの枠を作りなおします。',
    bookingHorizonMode: 'どこまで予約を受けるか',
    bookingHorizonModeDays: '今日から 日数で決める',
    bookingHorizonModeThrough: '日づけで決める（シーズンの さいごの日など）',
    bookingHorizonThroughLabel: '予約を受ける さいごの日',
    bookingHorizonThroughHint: 'この日までの スタート枠だけを作ります。日がたっても さいごの日は動きません。今日から 399日先まで えらべます。',
    bookingHorizonClosed: 'この さいごの日は もう すぎています。新しいスタート枠は 作られません。つぎのシーズンを受けるときは 日づけを 先にのばしてください。',
  },
  cartOption: {
    optional: '使っても使わなくてもよい',
    required: '必ず使う',
    unavailable: '使えない',
  },
  deposit: {
    title: '予約時の前払い',
    description: '予約のときに先に払ってもらう割合を、会員とそれ以外の人に分けて決めます。',
    member: '会員が先に払う割合',
    guest: '会員以外が先に払う割合',
    hint: '0〜100% の間で入れてください',
  },
  selfLock: {
    title: 'キャディが必ず付く時間帯',
    description:
      '混みやすい時間帯を、キャディが付く予約だけにします。この時間帯は、キャディなしの予約を受けません。',
    enabled: 'この決まりを使う',
    slotWeekdays: '{{n}}つめの時間帯の曜日',
    allDays: '選ばないと毎日になります',
    start: '始まり',
    end: '終わり',
    addSlot: '時間帯を増やす',
    selectDay: '{{day}}曜日を選ぶ',
    unselectDay: '{{day}}曜日を外す',
  },
  spend: {
    title: '1人あたりの金額の確認',
    description:
      '決めた金額より安い予約が入ったときに、担当者の確認待ちにするか、受け付けないようにします。',
    enabled: 'この決まりを使う',
    threshold: '1人あたりの最低金額',
    thresholdHint: '空のままなら、その日の売上目標に合わせます',
    thresholdPlaceholder: '売上目標に合わせる',
    belowAction: '金額が足りないときの扱い',
    review: '担当者が確認するまで待つ',
    reject: 'その予約を受け付けない',
  },
  summary: {
    maxPlayers: '1枠 最大{{n}}人',
    cutoff: '{{n}}時間前で受け付け終了',
  },
  validation: {
    slotTimes: '{{n}}つめの時間帯：始まりと終わりを入れてください。',
    slotOrder: '{{n}}つめの時間帯：終わりは、始まりより後にしてください。',
    overlapAllDays: '{{a}}つめと{{b}}つめの時間帯が、毎日重なっています。',
    overlapOnDay: '{{a}}つめと{{b}}つめの時間帯が、{{day}}曜日に重なっています。',
    holes: 'ホールの数は 9 か 18 にしてください。',
    maxPlayers: '1つの スタート枠の人数は 1〜4 人で入れてください。',
    memberDeposit: '会員が先に払う割合は 0〜100% で入れてください。',
    guestDeposit: '会員以外が先に払う割合は 0〜100% で入れてください。',
    cutoff: '受け付ける期限は 0 以上の数で入れてください。',
    bookingHorizon: '何日先まで予約を受けるかは 1〜399 日で入れてください。',
    bookingHorizonThrough: '予約を受ける さいごの日は、今日から 399日先までの 日づけで入れてください。',
    spendThreshold: '1人あたりの最低金額は 0 円以上で入れてください。',
  },
}
