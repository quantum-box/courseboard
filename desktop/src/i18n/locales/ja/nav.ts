/** Sidebar, workspace bar, command palette, and account menu. */
export const nav = {
  sections: {
    home: 'ホーム',
    courseBooking: '予約とコース',
    caddie: 'キャディ',
    finance: '売上と請求',
    settings: '設定',
    account: 'アカウント',
    tenantMaster: '最初に決める設定',
  },
  items: {
    golf: {
      label: 'ホーム',
      description: '今日の仕事の入口',
    },
    'golf/timeline': {
      label: 'タイムライン',
      description: '今日の予約とキャディを時間順に見る',
    },
    'golf/products': {
      label: 'プレー商品',
      description: 'プレー料金プランと受付できる枠',
    },
    'course-map': {
      label: 'コースマップ',
      description: 'カートが今どこにいるかを見る',
    },
    'golf/caddies': {
      label: 'キャディ名簿',
      description: 'キャディの情報と休みの希望',
    },
    'golf/caddies/dispatch': {
      label: '今日の配置',
      description: 'だれがどの組につくかを決める',
    },
    'golf/caddies/attendance': {
      label: '出勤',
      description: '出勤の打刻と実績の確認',
    },
    'golf/caddies/shifts': {
      label: 'シフト表',
      description: 'ひと月の出勤予定と連続出勤',
    },
    'golf/caddies/payroll': {
      label: '給与',
      description: '1か月分の給与をまとめる',
    },
    'golf/budgets': {
      label: '売上目標',
      description: '日ごとの目標と達成ぐあい',
    },
    'golf/settlement': {
      label: '月次精算',
      description: '1か月の売上と費用をしめる',
    },
    'cancellation-fees': {
      label: 'キャンセル料',
      description: '請求を送って入金を確認する',
    },
    'golf/courses': {
      label: 'コース設定',
      description: 'コースの名前とスタート間隔',
    },
    'golf/policy': {
      label: '予約ルール',
      description: '予約を受ける条件を決める',
    },
    'settings/members': {
      label: 'メンバーと権限',
      description: 'メンバーの招待とロールの管理',
    },
    settings: {
      label: '設定',
      description: '連携と最初に決める設定',
    },
  },
  sidebar: {
    search: '検索',
    pinned: 'よく使う画面',
    expand: 'サイドバーを開く',
    collapse: 'サイドバーを閉じる',
    openMenu: 'メニューを開く',
    closeMenu: 'メニューを閉じる',
    menuLabel: 'ナビゲーションメニュー',
    pin: 'よく使う画面に入れる',
    unpin: 'よく使う画面から外す',
  },
  workspace: {
    openHelp: 'この画面の使い方',
    closeHelp: '使い方を閉じる',
    tenantUnset: '施設が選ばれていません',
    production: '本番',
    sandbox: 'テスト',
  },
  command: {
    title: 'コマンドパレット',
    description: '画面の名前を入力すると、その画面へ移動できます。',
    inputLabel: '画面をさがす',
    placeholder: '画面をさがす…',
    empty: '見つかりませんでした',
  },
  tabs: {
    listLabel: 'Course Board のタブ',
    newTab: '新しいタブ',
    closeTab: '{{title}} を閉じる',
    history: '前後の画面へ移動',
    back: '戻る',
    forward: '進む',
  },
  account: {
    openMenu: 'アカウントメニューを開く',
    switchTenant: '施設を切り替える',
    settings: '設定',
    signOut: 'ログアウト',
    defaultUser: 'Course Board ユーザー',
  },
  notFound: {
    title: '画面が見つかりません',
    description: 'この画面は移動したか、なくなりました。',
  },
  redirect: {
    message: 'ログイン済みの Course Board へ移動しています…',
  },
} as const
