export const home = {
  title: 'ホーム',
  description: '今日の仕事はここから始めます。',
  openTimeline: '今日のタイムラインを開く',
  features: {
    title: 'できること',
  },
  flow: {
    title: '今日の進めかた',
    description: '上から順に進めると、同じ予約データがそのまま次の画面に引き継がれます。',
    steps: {
      timeline: {
        label: 'タイムライン',
        detail: '今日の予約とキャディの割当を確認する',
      },
      dispatch: {
        label: 'キャディの配置',
        detail: '空いている組と重なりを直して担当を決める',
      },
      revenue: {
        label: '売上と請求',
        detail: '目標の達成ぐあいとキャンセル料を確認する',
      },
      settlement: {
        label: '月次精算',
        detail: '1か月の売上と費用をしめる',
      },
    },
  },
} as const
