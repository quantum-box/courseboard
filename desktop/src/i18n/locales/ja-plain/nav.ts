import type { DeepPartial } from '../../types'
import type { nav as source } from '../ja/nav'

/** See `ja-plain/common.ts` for what this locale is for. */
export const nav: DeepPartial<typeof source> = {
  sections: {
    home: '最初の画面',
    courseBooking: '予約とコース',
    caddie: 'キャディ',
    company: '会社',
    finance: '売上とお金',
    dataIntegration: 'データ連携',
    tenantMaster: '最初に決めておく設定',
  },
  items: {
    golf: {
      label: '最初の画面',
      description: '今日の仕事はここから始めます',
    },
    'golf/ledger': {
      label: 'よやく台帳',
      description: 'スタートの 時こくごとの あきと 組を 見る',
    },
    'golf/customers': {
      label: 'お客さま台帳',
      description: '会員と ビジターの きろく',
    },
    'golf/reservation-report-import': {
      label: '予約表を読み込む',
      description: 'CSV・Excel・PDFの日ごとの数を確かめて保存します',
    },
    'golf/timeline': {
      label: '今日の予定表',
      description: '今日の予約と担当を、時間の順に並べて見ます',
    },
    'golf/products': {
      label: 'プレーの料金プラン',
      description: '売るプランと、予約を受けられる時間の枠',
    },
    'course-map': {
      label: 'コースの地図',
      description: 'カートが今どこにいるかを見ます',
    },
    'golf/caddies': {
      label: 'キャディの名簿',
      description: 'キャディ一人ひとりの情報と、休みの希望',
    },
    'golf/caddies/dispatch': {
      label: 'キャディの担当決め',
      description: 'だれがどの組につくかを決めます',
    },
    'golf/caddies/attendance': {
      label: '出勤の記録',
      description: '出勤・退勤の記録と、その日の実績',
    },
    'golf/caddies/shifts': {
      label: 'シフト表',
      description: 'ひと月の出勤の予定と、休みなしの続きぐあい',
    },
    'golf/caddies/payroll': {
      label: '給料の集計',
      description: '1か月分の働いた時間と費用をまとめます',
    },
    'golf/budgets': {
      label: '売上の目標',
      description: '日ごとの目標と、今どこまで届いているか',
    },
    'golf/simulator': {
      label: 'ねだんの計算',
      description: 'プレー料金と税、売上のめやすを計算します',
    },
    'golf/settlement': {
      label: '1か月のしめ',
      description: '1か月の売上と費用を合わせて確かめます',
    },
    'cancellation-fees': {
      label: 'キャンセル料',
      description: '請求を送って、入金があったか確かめます',
    },
    staff: {
      label: '社員の名簿',
      description: 'ゴルフ場で働く人の名簿',
    },
    'golf/courses': {
      label: 'コース',
      description: 'コースの予約を受ける時間と、スタート枠',
    },
    'golf/policy': {
      label: '予約の決まりごと',
      description: 'どんな予約を受けるかを決めます',
    },
    'settings/members': {
      label: 'メンバーと権限',
      description: 'メンバーを招待して、できることを決めます',
    },
    settings: {
      label: '設定',
      description: '最初に決めておく設定と、他のサービスとのつなぎ',
    },
  },
  sidebar: {
    search: '画面をさがす',
    pinned: 'よく使う画面',
    expand: '左のメニューを出す',
    collapse: '左のメニューを隠す',
    menuLabel: '画面を選ぶメニュー',
    pin: 'よく使う画面に入れる',
    unpin: 'よく使う画面から外す',
    resize: '左のメニューの幅を変える',
  },
  workspace: {
    openHelp: 'この画面の使い方を見る',
    closeHelp: '使い方を閉じる',
    tenantUnset: 'ゴルフ場が選ばれていません',
    production: '本番',
    sandbox: '練習用',
  },
  command: {
    title: '画面をさがす窓',
    description: '行きたい画面の名前を入れると、その画面に移れます。',
    inputLabel: '画面の名前を入れてさがす',
    placeholder: '画面の名前を入れてさがす…',
  },
  tabs: {
    listLabel: '開いている画面',
    newTab: '画面を新しく開く',
    history: '前の画面・次の画面へ',
  },
  account: {
    openMenu: '自分の設定を開く',
    switchTenant: '別のゴルフ場に切り替える',
    defaultUser: 'Course Board を使う人',
  },
  notFound: {
    description: 'この画面は場所が変わったか、なくなりました。',
  },
  redirect: {
    message: 'ログイン済みの Course Board に移動しています…',
  },
}
